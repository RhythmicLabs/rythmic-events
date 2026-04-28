import type { DomainEvent } from '../domain-events/index';
import type { EventStorage, QueryCriteria } from './storage';

export enum StorageMode {
  MEMORY = 'memory',
  STORAGE_ONLY = 'storage_only',
  WRITE_THROUGH = 'write_through',
}

export interface CacheOptions {
  maxSize?: number;
  ttl?: number;
  mode?: StorageMode;
  storage?: EventStorage;
  fallbackToCache?: boolean;
}

export interface CachedEvent {
  event: DomainEvent;
  timestamp: number;
}

export interface CacheStats {
  size: number;
  hits: number;
  misses: number;
  evictions: number;
}

export class EventCache {
  private cache: Map<string, CachedEvent> = new Map();
  private accessOrder: string[] = [];
  private stats: CacheStats = {
    size: 0,
    hits: 0,
    misses: 0,
    evictions: 0,
  };

  private readonly maxSize: number;
  private readonly ttl: number;
  private readonly mode: StorageMode;
  private readonly storage?: EventStorage;
  private readonly fallbackToCache: boolean;

  constructor(options: CacheOptions = {}) {
    this.maxSize = options.maxSize ?? 1000;
    this.ttl = options.ttl ?? 300000; // 5 minutes default
    this.mode = options.mode ?? StorageMode.MEMORY;
    this.storage = options.storage;
    this.fallbackToCache = options.fallbackToCache ?? true;

    if (
      (this.mode === StorageMode.STORAGE_ONLY ||
        this.mode === StorageMode.WRITE_THROUGH) &&
      !this.storage
    ) {
      throw new Error(
        `Storage mode ${this.mode} requires a storage implementation`
      );
    }
  }

  async add(event: DomainEvent): Promise<void> {
    if (this.mode === StorageMode.STORAGE_ONLY) {
      if (!this.storage) {
        throw new Error('Storage required for STORAGE_ONLY mode');
      }
      await this.storage.save(event);
      return;
    }

    // Add to memory cache
    const cachedEvent: CachedEvent = {
      event,
      timestamp: Date.now(),
    };

    // Evict if necessary
    if (this.cache.size >= this.maxSize) {
      this.evictLRU();
    }

    this.cache.set(event.id, cachedEvent);
    this.updateAccessOrder(event.id);
    this.stats.size = this.cache.size;

    // Persist to storage if in write-through mode
    if (this.mode === StorageMode.WRITE_THROUGH && this.storage) {
      try {
        await this.storage.save(event);
      } catch {
        // In write-through mode, we don't throw on storage errors
        // The event is still cached in memory
      }
    }
  }

  async get(eventId: string): Promise<DomainEvent | null> {
    // Storage-only mode bypasses cache entirely
    if (this.mode === StorageMode.STORAGE_ONLY) {
      if (!this.storage) {
        throw new Error('Storage required for STORAGE_ONLY mode');
      }
      return await this.storage.load(eventId);
    }

    // Check memory cache first
    const cached = this.cache.get(eventId);
    if (cached) {
      // Check TTL
      if (Date.now() - cached.timestamp > this.ttl) {
        this.cache.delete(eventId);
        this.removeFromAccessOrder(eventId);
        this.stats.size = this.cache.size;
      } else {
        this.updateAccessOrder(eventId);
        this.stats.hits++;
        return cached.event;
      }
    }

    // Try storage if available and fallback is enabled
    if (this.storage && this.fallbackToCache) {
      try {
        const event = await this.storage.load(eventId);
        if (event) {
          // Cache the retrieved event
          await this.add(event);
          this.stats.hits++;
          return event;
        }
      } catch {
        // Storage errors are ignored if fallback is enabled
      }
    }

    this.stats.misses++;
    return null;
  }

  async getEvents(criteria?: QueryCriteria): Promise<DomainEvent[]> {
    if (this.mode === StorageMode.STORAGE_ONLY) {
      if (!this.storage) {
        throw new Error('Storage required for STORAGE_ONLY mode');
      }
      return await this.storage.query(criteria ?? {});
    }

    const events: DomainEvent[] = [];
    const now = Date.now();

    for (const cached of this.cache.values()) {
      // Check TTL
      if (now - cached.timestamp > this.ttl) {
        continue;
      }

      // Apply criteria filters
      if (criteria) {
        if (criteria.eventType && cached.event.type !== criteria.eventType) {
          continue;
        }
        if (
          criteria.aggregateId &&
          cached.event.aggregateId !== criteria.aggregateId
        ) {
          continue;
        }
        if (criteria.before && cached.event.occurredOn > criteria.before) {
          continue;
        }
        if (criteria.after && cached.event.occurredOn < criteria.after) {
          continue;
        }
      }

      events.push(cached.event);
    }

    // Sort by occurredOn descending (newest first)
    events.sort((a, b) => b.occurredOn.getTime() - a.occurredOn.getTime());

    // Apply limit
    if (criteria?.limit) {
      events.splice(criteria.limit);
    }

    return events;
  }

  async remove(eventId: string): Promise<boolean> {
    if (this.mode === StorageMode.STORAGE_ONLY) {
      if (!this.storage) {
        throw new Error('Storage required for STORAGE_ONLY mode');
      }
      return await this.storage.delete(eventId);
    }

    const existed = this.cache.has(eventId);
    this.cache.delete(eventId);
    this.removeFromAccessOrder(eventId);
    this.stats.size = this.cache.size;

    // Also remove from storage if available
    if (this.storage) {
      try {
        await this.storage.delete(eventId);
      } catch {
        // Ignore storage errors
      }
    }

    return existed;
  }

  async clear(): Promise<void> {
    this.cache.clear();
    this.accessOrder = [];
    this.stats.size = 0;

    if (this.storage) {
      try {
        // Clear storage if it has a clear method (implementation dependent)
        await this.storage.query({}).then((events) => {
          return Promise.all(
            events.map((event) =>
              event.id ? this.storage?.delete(event.id) : Promise.resolve(false)
            )
          );
        });
      } catch {
        // Ignore storage errors
      }
    }
  }

  getStats(): CacheStats {
    return { ...this.stats };
  }

  private evictLRU(): void {
    if (this.accessOrder.length === 0) return;

    const lruKey = this.accessOrder[0];
    if (lruKey) {
      this.cache.delete(lruKey);
    }
    this.accessOrder.shift();
    this.stats.evictions++;
  }

  private updateAccessOrder(eventId: string): void {
    this.removeFromAccessOrder(eventId);
    this.accessOrder.push(eventId);
  }

  private removeFromAccessOrder(eventId: string): void {
    const index = this.accessOrder.indexOf(eventId);
    if (index > -1) {
      this.accessOrder.splice(index, 1);
    }
  }
}
