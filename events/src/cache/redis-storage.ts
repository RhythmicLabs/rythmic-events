import type { DomainEvent, DomainEventJSON } from '../domain-events/index';
import type { EventStorage, QueryCriteria } from './storage';
import { EventRegistry } from '../domain-events/event-registry';

export interface RedisClient {
  hSet(key: string, field: string, value: string): Promise<number>;
  hGet(key: string, field: string): Promise<string | null>;
  hGetAll(key: string): Promise<Record<string, string>>;
  hDel(key: string, field: string): Promise<number>;
  del(key: string): Promise<number>;
  sAdd(key: string, member: string): Promise<number>;
  sRem(key: string, member: string): Promise<number>;
  sMembers(key: string): Promise<string[]>;
  keys(pattern: string): Promise<string[]>;
  expire(key: string, seconds: number): Promise<boolean>;
  pipeline(): RedisPipeline;
  ping(): Promise<string>;
  connect?(): Promise<void>;
  disconnect?(): Promise<void>;
  flushDb?(): Promise<void>;
}

export interface RedisPipeline {
  hSet(key: string, field: string, value: string): RedisPipeline;
  sAdd(key: string, member: string): RedisPipeline;
  sRem(key: string, member: string): RedisPipeline;
  del(key: string): RedisPipeline;
  expire(key: string, seconds: number): RedisPipeline;
  exec(): Promise<unknown[]>;
}

export interface RedisStorageOptions {
  redis: RedisClient;
  keyPrefix?: string;
  eventTTL?: number;
  enableIndexes?: boolean;
}

export interface RedisStorageStats {
  totalEvents: number;
  typeCounts: Record<string, number>;
  connected: boolean;
}

export class RedisEventStorage implements EventStorage {
  private readonly redis: RedisClient;
  private readonly keyPrefix: string;
  private readonly eventTTL: number;
  private readonly enableIndexes: boolean;
  private readonly registry: EventRegistry;
  private connected: boolean = false;

  constructor(options: RedisStorageOptions, registry?: EventRegistry) {
    this.redis = options.redis;
    this.keyPrefix = options.keyPrefix ?? 'events:';
    this.eventTTL = options.eventTTL ?? 86400; // 24 hours default
    this.enableIndexes = options.enableIndexes ?? true;
    this.registry = registry ?? EventRegistry.getInstance();
  }

  async connect(): Promise<void> {
    try {
      if (this.redis.connect) {
        await this.redis.connect();
      }
      await this.redis.ping();
      this.connected = true;
    } catch (error) {
      this.connected = false;
      throw new Error(`Failed to connect to Redis: ${error}`);
    }
  }

  async disconnect(): Promise<void> {
    if (this.redis.disconnect) {
      await this.redis.disconnect();
    }
    this.connected = false;
  }

  isConnected(): boolean {
    return this.connected;
  }

  async healthCheck(): Promise<boolean> {
    try {
      await this.redis.ping();
      return true;
    } catch {
      return false;
    }
  }

  async save(event: DomainEvent): Promise<void> {
    if (!this.connected) {
      await this.connect();
    }

    const eventKey = this.getEventKey(event.id);
    const eventJSON = event.toJSON();
    const eventString = JSON.stringify(eventJSON);

    const pipeline = this.redis.pipeline();

    // Store event data
    pipeline.hSet(eventKey, 'data', eventString);

    // Set TTL
    if (this.eventTTL > 0) {
      pipeline.expire(eventKey, this.eventTTL);
    }

    // Update indexes if enabled
    if (this.enableIndexes) {
      this.updateIndexes(pipeline, event);
    }

    await pipeline.exec();
  }

  async load(eventId: string): Promise<DomainEvent | null> {
    if (!this.connected) {
      await this.connect();
    }

    const eventKey = this.getEventKey(eventId);
    const eventString = await this.redis.hGet(eventKey, 'data');

    if (!eventString) {
      return null;
    }

    try {
      const eventJSON: DomainEventJSON = JSON.parse(eventString);
      return this.registry.deserialize(eventJSON);
    } catch (error) {
      throw new Error(`Failed to deserialize event ${eventId}: ${error}`);
    }
  }

  async delete(eventId: string): Promise<boolean> {
    if (!this.connected) {
      await this.connect();
    }

    const eventKey = this.getEventKey(eventId);
    const event = await this.load(eventId);

    if (!event) {
      return false;
    }

    const pipeline = this.redis.pipeline();

    // Delete event data
    pipeline.del(eventKey);

    // Remove from indexes if enabled
    if (this.enableIndexes) {
      this.removeIndexes(pipeline, event);
    }

    await pipeline.exec();
    return true;
  }

  async query(criteria: QueryCriteria): Promise<DomainEvent[]> {
    if (!this.connected) {
      await this.connect();
    }

    let eventIds: string[] = [];

    // Use indexes if available and criteria matches
    if (this.enableIndexes && criteria.eventType) {
      const typeIndexKey = this.getTypeIndexKey(criteria.eventType);
      eventIds = await this.redis.sMembers(typeIndexKey);
    } else if (this.enableIndexes && criteria.aggregateId) {
      const aggregateIndexKey = this.getAggregateIndexKey(criteria.aggregateId);
      eventIds = await this.redis.sMembers(aggregateIndexKey);
    } else {
      // Fallback to scanning all event keys
      const pattern = this.keyPrefix + '*';
      const keys = await this.redis.keys(pattern);
      eventIds = keys.map((key) => key.slice(this.keyPrefix.length));
    }

    // Load events
    const events: DomainEvent[] = [];
    for (const eventId of eventIds) {
      const event = await this.load(eventId);
      if (event) {
        events.push(event);
      }
    }

    // Apply additional filters
    let filteredEvents = events;

    if (criteria.eventType) {
      filteredEvents = filteredEvents.filter(
        (e) => e.type === criteria.eventType
      );
    }

    if (criteria.aggregateId) {
      filteredEvents = filteredEvents.filter(
        (e) => e.aggregateId === criteria.aggregateId
      );
    }

    if (criteria.before) {
      filteredEvents = filteredEvents.filter(
        (e) => e.occurredOn <= criteria.before!
      );
    }

    if (criteria.after) {
      filteredEvents = filteredEvents.filter(
        (e) => e.occurredOn >= criteria.after!
      );
    }

    // Sort by occurredOn descending (newest first)
    filteredEvents.sort(
      (a, b) => b.occurredOn.getTime() - a.occurredOn.getTime()
    );

    // Apply limit
    if (criteria.limit) {
      filteredEvents = filteredEvents.slice(0, criteria.limit);
    }

    return filteredEvents;
  }

  async getStats(): Promise<RedisStorageStats> {
    if (!this.connected) {
      await this.connect();
    }

    const pattern = this.keyPrefix + '*';
    const keys = await this.redis.keys(pattern);

    const typeCounts: Record<string, number> = {};
    let totalEvents = 0;

    for (const key of keys) {
      if (key.includes(':type:')) {
        // This is a type index, extract the event type
        const eventType = key.split(':type:')[1];
        if (eventType) {
          const members = await this.redis.sMembers(key);
          typeCounts[eventType] = members.length;
          totalEvents += members.length;
        }
      }
    }

    // If no indexes are enabled, count events directly
    if (Object.keys(typeCounts).length === 0) {
      const eventKeys = keys.filter((key) => !key.includes(':'));
      totalEvents = eventKeys.length;
    }

    return {
      totalEvents,
      typeCounts,
      connected: this.connected,
    };
  }

  async clear(): Promise<void> {
    try {
      if (!this.connected) {
        await this.connect();
      }

      const pattern = this.keyPrefix + '*';
      const keys = await this.redis.keys(pattern);

      if (keys.length > 0) {
        const pipeline = this.redis.pipeline();
        for (const key of keys) {
          pipeline.del(key);
        }
        await pipeline.exec();
      }
    } catch {
      // Swallow errors to prevent crashes
    }
  }

  private getEventKey(eventId: string): string {
    return `${this.keyPrefix}${eventId}`;
  }

  private getTypeIndexKey(eventType: string): string {
    return `${this.keyPrefix}type:${eventType}`;
  }

  private getAggregateIndexKey(aggregateId: string): string {
    return `${this.keyPrefix}aggregate:${aggregateId}`;
  }

  private getDateIndexKey(date: Date): string {
    const dateStr = date.toISOString().split('T')[0]; // YYYY-MM-DD
    return `${this.keyPrefix}date:${dateStr}`;
  }

  private updateIndexes(pipeline: RedisPipeline, event: DomainEvent): void {
    // Type index
    pipeline.sAdd(this.getTypeIndexKey(event.type), event.id);

    // Aggregate index
    if (event.aggregateId) {
      pipeline.sAdd(this.getAggregateIndexKey(event.aggregateId), event.id);
    }

    // Date index
    pipeline.sAdd(this.getDateIndexKey(event.occurredOn), event.id);
  }

  private removeIndexes(pipeline: RedisPipeline, event: DomainEvent): void {
    // Type index
    pipeline.sRem(this.getTypeIndexKey(event.type), event.id);

    // Aggregate index
    if (event.aggregateId) {
      pipeline.sRem(this.getAggregateIndexKey(event.aggregateId), event.id);
    }

    // Date index
    pipeline.sRem(this.getDateIndexKey(event.occurredOn), event.id);
  }
}
