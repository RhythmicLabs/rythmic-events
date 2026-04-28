import type { DomainEvent } from '../domain-events/index';
import type { EventStorage, QueryCriteria } from '../cache/storage';
import { EventCache, type CacheOptions, StorageMode } from '../cache/index';
import type { PubSubProvider } from './provider';
import { LocalPubSubProvider } from './local-provider';
import {
  RedisProvider,
  type RedisPubSubOptions,
  type PublishOptions,
  type SubscribeOptions,
  type SerializeType,
} from './redis-provider';

export { LocalPubSubProvider, RedisProvider };
export type { PubSubProvider };
export type {
  RedisPubSubOptions,
  PublishOptions,
  SubscribeOptions,
  SerializeType,
};

export interface PubSubOptions extends CacheOptions {
  enableCache?: boolean;
  cacheSize?: number;
  cacheTTL?: number;
  storageMode?: StorageMode;
  storage?: EventStorage;
  cacheFallbackToStorage?: boolean;
  provider?: PubSubProvider;
}

export interface Subscription {
  id: string;
  event: string;
  handler: (event: unknown) => void | Promise<void>;
  once: boolean;
}

export class EventBus {
  private provider: PubSubProvider;
  private cache?: EventCache;
  private subscriptions: Map<string, Subscription> = new Map();
  private eventSubscriptions: Map<string, Set<string>> = new Map();
  private unsubscribeFunctions: Map<string, () => void> = new Map();
  private nextId: number = 1;

  constructor(options: PubSubOptions = {}) {
    this.provider = options.provider ?? new LocalPubSubProvider();

    if (options.enableCache !== false) {
      this.cache = new EventCache({
        maxSize: options.cacheSize,
        ttl: options.cacheTTL,
        mode: options.storageMode,
        storage: options.storage,
        fallbackToCache: options.cacheFallbackToStorage,
        ...options,
      });
    }
  }

  async publish(event: DomainEvent): Promise<void> {
    // Cache the event if caching is enabled
    if (this.cache) {
      await this.cache.add(event);
    }

    // Publish through the provider
    await this.provider.publish(event.type, event);
  }

  async publishBatch(events: DomainEvent[]): Promise<void> {
    // Cache all events if caching is enabled
    if (this.cache) {
      for (const event of events) {
        await this.cache.add(event);
      }
    }

    // Publish each event through the provider
    for (const event of events) {
      await this.provider.publish(event.type, event);
    }
  }

  subscribe(
    eventType: string,
    handler: (event: unknown) => void | Promise<void>,
    options: { once?: boolean } = {}
  ): string {
    const subscriptionId = this.generateId();
    const subscription: Subscription = {
      id: subscriptionId,
      event: eventType,
      handler,
      once: options.once ?? false,
    };

    this.subscriptions.set(subscriptionId, subscription);

    if (!this.eventSubscriptions.has(eventType)) {
      this.eventSubscriptions.set(eventType, new Set());
    }
    this.eventSubscriptions.get(eventType)!.add(subscriptionId);

    const unsubscribeFn = options.once
      ? this.provider.subscribeOnce(eventType, handler)
      : this.provider.subscribe(eventType, handler);

    this.unsubscribeFunctions.set(subscriptionId, unsubscribeFn);

    return subscriptionId;
  }

  subscribeOnce(
    eventType: string,
    handler: (event: unknown) => void | Promise<void>
  ): string {
    return this.subscribe(eventType, handler, { once: true });
  }

  unsubscribe(subscriptionId: string): boolean {
    const subscription = this.subscriptions.get(subscriptionId);
    if (!subscription) {
      return false;
    }

    // Call the provider's unsubscribe function
    const unsubscribeFn = this.unsubscribeFunctions.get(subscriptionId);
    if (unsubscribeFn) {
      unsubscribeFn();
      this.unsubscribeFunctions.delete(subscriptionId);
    }

    // Remove from tracking maps
    this.subscriptions.delete(subscriptionId);
    const eventSubs = this.eventSubscriptions.get(subscription.event);
    if (eventSubs) {
      eventSubs.delete(subscriptionId);
      if (eventSubs.size === 0) {
        this.eventSubscriptions.delete(subscription.event);
      }
    }

    return true;
  }

  unsubscribeByEvent(eventType: string): number {
    const subscriptionIds = this.eventSubscriptions.get(eventType);
    if (!subscriptionIds) {
      return 0;
    }

    const count = subscriptionIds.size;
    for (const subscriptionId of subscriptionIds) {
      this.unsubscribe(subscriptionId);
    }

    return count;
  }

  unsubscribeAll(): number {
    const count = this.subscriptions.size;
    for (const subscriptionId of this.subscriptions.keys()) {
      this.unsubscribe(subscriptionId);
    }
    return count;
  }

  getSubscriptions(eventType?: string): Subscription[] {
    if (eventType) {
      const subscriptionIds =
        this.eventSubscriptions.get(eventType) ?? new Set();
      return Array.from(subscriptionIds)
        .map((id) => this.subscriptions.get(id))
        .filter((sub): sub is Subscription => sub !== undefined);
    }

    return Array.from(this.subscriptions.values());
  }

  getSubscriptionCount(eventType?: string): number {
    if (eventType) {
      return this.eventSubscriptions.get(eventType)?.size ?? 0;
    }

    return this.subscriptions.size;
  }

  async getEventHistory(
    eventType?: string,
    limit?: number,
    before?: Date
  ): Promise<DomainEvent[]> {
    if (!this.cache) {
      return [];
    }

    const criteria: QueryCriteria = {};
    if (eventType) {
      criteria.eventType = eventType;
    }
    if (limit) {
      criteria.limit = limit;
    }
    if (before) {
      criteria.before = before;
    }

    return await this.cache.getEvents(criteria);
  }

  async clearCache(): Promise<void> {
    if (this.cache) {
      await this.cache.clear();
    }
  }

  getCacheStats() {
    return this.cache?.getStats() ?? null;
  }

  private generateId(): string {
    return `sub_${this.nextId++}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }
}
