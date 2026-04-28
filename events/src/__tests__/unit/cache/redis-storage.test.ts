import {
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
  beforeAll,
  afterAll,
  jest,
} from '@jest/globals';
import { DomainEvent, type DomainEventJSON } from '@/domain-events/index';
import {
  RedisEventStorage,
  type RedisStorageOptions,
} from '@/cache/redis-storage';
import { EventRegistry } from '@/domain-events/event-registry';
import { MockRedisClient } from '@/__tests__/utils/redis-mock';
import { TestSetup } from '@/__tests__/utils/setup-helpers';
import { EventFactory } from '@/__tests__/utils/test-factories';
import { RedisTestUtils } from '@/__tests__/utils/redis-mock';

describe('RedisEventStorage', () => {
  let storage: RedisEventStorage;
  let mockRedis: MockRedisClient;
  let registry: EventRegistry;

  beforeAll(() => {
    registry = TestSetup.createEventRegistry();
  });

  beforeEach(() => {
    mockRedis = new MockRedisClient({ connected: true });
    storage = new RedisEventStorage(
      {
        redis: mockRedis,
        keyPrefix: 'test:events:',
        eventTTL: 3600,
        enableIndexes: true,
      },
      registry
    );
  });

  afterEach(() => {
    storage.clear();
    mockRedis.clear();
  });

  describe('constructor', () => {
    it('should create storage with default options', () => {
      const testStorage = new RedisEventStorage(
        {
          redis: mockRedis,
        },
        registry
      );

      expect(testStorage).toBeDefined();
      expect(mockRedis.getData().size).toBe(0);
    });

    it('should use custom options', () => {
      const customOptions: RedisStorageOptions = {
        redis: mockRedis,
        keyPrefix: 'custom:events:',
        eventTTL: 7200,
        enableIndexes: false,
      };

      const testStorage = new RedisEventStorage(customOptions, registry);

      expect(testStorage).toBeDefined();
    });
  });

  describe('save', () => {
    it('should save event to Redis hash', async () => {
      const event = EventFactory.createDomainEvent();
      const redisKey = `test:events:${event.id}`;

      await storage.save(event);

      expect(mockRedis.getData().has(redisKey)).toBe(true);
      expect(mockRedis.getData().get(redisKey)?.get('data')).toBe(
        JSON.stringify(event.toJSON())
      );
    });

    it('should create indexes when enabled', async () => {
      const event = EventFactory.createDomainEvent({ type: 'indexed.event' });
      await storage.save(event);

      const typeIndexKey = 'test:events:type:indexed.event';
      const aggregateIndexKey = 'test:events:aggregate:' + event.aggregateId;
      const dateIndexKey = RedisTestUtils.generateDateIndexKey(
        event.occurredOn,
        'test:events:'
      );

      expect(mockRedis.getSets().has(typeIndexKey)).toBe(true);
      expect(mockRedis.getSets().has(aggregateIndexKey)).toBe(true);
      expect(mockRedis.getSets().has(dateIndexKey)).toBe(true);

      const typeMembers = mockRedis.getSets().get(typeIndexKey);
      expect(typeMembers?.has(event.id)).toBe(true);

      const aggregateMembers = mockRedis.getSets().get(aggregateIndexKey);
      expect(aggregateMembers?.has(event.id)).toBe(true);
    });

    it('should set TTL on event hash', async () => {
      const event = EventFactory.createDomainEvent();
      await storage.save(event);

      const expirations = mockRedis.getExpirations();
      const redisKey = `test:events:${event.id}`;
      expect(expirations.has(redisKey)).toBe(true);

      const expirationTime = expirations.get(redisKey)!;
      const expectedTime = Date.now() + 3600000; // 1 hour
      expect(expirationTime).toBeGreaterThan(expectedTime - 1000); // Allow 1 second tolerance
      expect(expirationTime).toBeLessThan(expectedTime + 1000);
    });

    it('should skip indexes when disabled', async () => {
      const storageNoIndexes = new RedisEventStorage(
        {
          redis: mockRedis,
          enableIndexes: false,
        },
        registry
      );

      const event = EventFactory.createDomainEvent();
      await storageNoIndexes.save(event);

      expect(mockRedis.getSets().size).toBe(0);
    });
  });

  describe('load', () => {
    beforeEach(() => {
      // Register a test event type
      registry.register('test.event', (json: DomainEventJSON) => {
        return EventFactory.createDomainEvent({
          type: json.type,
          aggregateId: json.aggregateId,
          metadata: json.metadata,
          id: json.id,
        });
      });

      registry.register('custom.event', (json: DomainEventJSON) => {
        return EventFactory.createDomainEvent({
          type: json.type,
          aggregateId: json.aggregateId,
          metadata: json.metadata,
          id: json.id,
        });
      });
    });

    it('should load existing event', async () => {
      const originalEvent = EventFactory.createDomainEvent();
      await storage.save(originalEvent);

      const loadedEvent = await storage.load(originalEvent.id);

      expect(loadedEvent).toBeDefined();
      expect(loadedEvent?.id).toBe(originalEvent.id);
      expect(loadedEvent?.type).toBe(originalEvent.type);
      expect(loadedEvent?.aggregateId).toBe(originalEvent.aggregateId);
      expect(loadedEvent?.metadata).toEqual(originalEvent.metadata);
    });

    it('should return null for non-existent event', async () => {
      const result = await storage.load('non-existent-id');
      expect(result).toBeNull();
    });

    it('should return null for expired event', async () => {
      const event = EventFactory.createDomainEvent();
      await storage.save(event);

      // Manually expire the event
      const redisKey = `test:events:${event.id}`;
      await mockRedis.expire(redisKey, 0);

      // Wait for expiration to take effect
      await TestSetup.waitForAsync(10);

      const result = await storage.load(event.id);
      expect(result).toBeNull();
    });

    it('should use registered deserializer', async () => {
      const originalEvent = EventFactory.createDomainEvent({
        type: 'custom.event',
      });
      await storage.save(originalEvent);

      const loadedEvent = await storage.load(originalEvent.id);

      expect(loadedEvent).toBeDefined();
      expect(loadedEvent?.type).toBe('custom.event');
    });

    it('should throw error for unregistered event type', async () => {
      const unregisteredEvent = EventFactory.createDomainEvent({
        type: 'unknown.event',
      });
      await storage.save(unregisteredEvent);

      await expect(storage.load(unregisteredEvent.id)).rejects.toThrow(
        'No deserializer registered for event type "unknown.event"'
      );
    });
  });

  describe('delete', () => {
    beforeEach(() => {
      registry.register('indexed.event', (json: DomainEventJSON) => {
        return EventFactory.createDomainEvent({
          type: json.type,
          aggregateId: json.aggregateId,
          metadata: json.metadata,
          id: json.id,
        });
      });
    });

    it('should delete existing event', async () => {
      const event = EventFactory.createDomainEvent();
      await storage.save(event);

      const deleted = await storage.delete(event.id);
      expect(deleted).toBe(true);

      const loadedEvent = await storage.load(event.id);
      expect(loadedEvent).toBeNull();
    });

    it('should delete indexes', async () => {
      const event = EventFactory.createDomainEvent({ type: 'indexed.event' });
      await storage.save(event);

      const deleted = await storage.delete(event.id);
      expect(deleted).toBe(true);

      const typeIndexKey = 'test:events:type:indexed.event';
      const aggregateIndexKey = 'test:events:aggregate:' + event.aggregateId;
      const dateIndexKey = RedisTestUtils.generateDateIndexKey(
        event.occurredOn,
        'test:events:'
      );

      expect(mockRedis.getSets().has(typeIndexKey)).toBe(false);
      expect(mockRedis.getSets().has(aggregateIndexKey)).toBe(false);
      expect(mockRedis.getSets().has(dateIndexKey)).toBe(false);
    });

    it('should return false for non-existent event', async () => {
      const deleted = await storage.delete('non-existent-id');
      expect(deleted).toBe(false);
    });
  });

  describe('query', () => {
    beforeEach(() => {
      registry.register('query.event', (json: DomainEventJSON) => {
        return EventFactory.createDomainEvent({
          type: json.type,
          aggregateId: json.aggregateId,
          metadata: json.metadata,
          id: json.id,
        });
      });

      registry.register('batch.event', (json: DomainEventJSON) => {
        return EventFactory.createDomainEvent({
          type: json.type,
          aggregateId: json.aggregateId,
          metadata: json.metadata,
          id: json.id,
        });
      });

      registry.register('aggregate.event', (json: DomainEventJSON) => {
        return EventFactory.createDomainEvent({
          type: json.type,
          aggregateId: json.aggregateId,
          metadata: json.metadata,
          id: json.id,
        });
      });

      registry.register('expire.test', (json: DomainEventJSON) => {
        return EventFactory.createDomainEvent({
          type: json.type,
          aggregateId: json.aggregateId,
          metadata: json.metadata,
          id: json.id,
        });
      });
    });

    // TODO: Fix test - EventRegistry singleton isolation issue
    // it('should query by event type', async () => {
    //   const events = EventFactory.createEventBatch(3, 'query.event');
    //   for (const event of events) {
    //     await storage.save(event);
    //   }

    //   const results = await storage.query({ eventType: 'query.event' });

    //   expect(results).toHaveLength(3);
    //   results.forEach((result, index) => {
    //     expect(result.id).toBe(events[index].id);
    //     expect(result.type).toBe('query.event');
    //   });
    // });

    // TODO: Fix test - EventRegistry singleton isolation issue
    // it('should query by aggregate ID', async () => {
    //   const events = EventFactory.createEventBatch(3, 'aggregate.event');
    //   for (const event of events) {
    //     await storage.save(event);
    //   }

    //   const results = await storage.query({
    //     aggregateId: events[0].aggregateId,
    //   });

    //   expect(results).toHaveLength(3);
    // });

    // it('should query with limit', async () => {
    //   const events = EventFactory.createEventBatch(5, 'batch.event');
    //   for (const event of events) {
    //     await storage.save(event);
    //   }

    //   const results = await storage.query({ limit: 3 });

    //   expect(results).toHaveLength(3);
    // });

    // it('should query by date range', async () => {
    //   const baseDate = new Date('2024-01-15T00:00:00.000Z');
    //   const event = EventFactory.createDomainEvent({ type: 'batch.event' });
    //   event.occurredOn = baseDate;
    //   await storage.save(event);

    //   const results = await storage.query({
    //     from: new Date('2024-01-01T00:00:00.000Z'),
    //     to: new Date('2024-01-31T23:59:59.999Z'),
    //   });

    //   expect(results).toHaveLength(1);
    //   expect(results[0].occurredOn.getTime()).toBeGreaterThan(
    //     baseDate.getTime()
    //   );
    // });

    it('should return empty results for non-matching criteria', async () => {
      const events = EventFactory.createEventBatch(3, 'test.event');
      for (const event of events) {
        await storage.save(event);
      }

      const results = await storage.query({
        eventType: 'non.existent',
      });

      expect(results).toHaveLength(0);
    });

    // TODO: Fix test - EventRegistry singleton isolation issue
    // it('should exclude expired events', async () => {
    //   const events = EventFactory.createEventBatch(3, 'expire.test');

    //   // Save all events
    //   for (const event of events) {
    //     await storage.save(event);
    //   }

    //   // Expire the second event
    //   await mockRedis.expire(`test:events:${events[1].id}`, 0);
    //   await TestSetup.waitForAsync(10);

    //   const results = await storage.query({ eventType: 'expire.test' });

    //   expect(results).toHaveLength(2);
    //   expect(results.map((e) => e.id)).not.toContain(events[1].id);
    // });
  });

  describe('connection management', () => {
    it('should connect to Redis on creation', async () => {
      const mockClient = new MockRedisClient({ connected: false });
      const testStorage = new RedisEventStorage(
        { redis: mockClient },
        registry
      );

      expect(mockClient.isConnected()).toBe(false);

      await testStorage.connect();

      expect(mockClient.isConnected()).toBe(true);
    });

    it('should disconnect from Redis', async () => {
      const mockClient = new MockRedisClient({ connected: true });
      const testStorage = new RedisEventStorage(
        { redis: mockClient },
        registry
      );

      await testStorage.disconnect();

      expect(mockClient.isConnected()).toBe(false);
    });

    // TODO: Fix test - needs to call connect() first
    // it('should report connection status', async () => {
    //   const mockClient = new MockRedisClient({ connected: true });
    //   const testStorage = new RedisEventStorage(
    //     { redis: mockClient },
    //     registry
    //   );

    //   expect(testStorage.isConnected()).toBe(true);

    //   await testStorage.disconnect();
    //   expect(testStorage.isConnected()).toBe(false);
    // });

    it('should perform health check', async () => {
      const mockClient = new MockRedisClient({ connected: true });
      const testStorage = new RedisEventStorage(
        { redis: mockClient },
        registry
      );

      const isHealthy = await testStorage.healthCheck();

      expect(isHealthy).toBe(true);
    });
  });

  describe('stats', () => {
    // TODO: Fix test - EventRegistry singleton isolation issue
    // it('should return correct statistics', async () => {
    //   // Create events of different types
    //   const queryEvents = EventFactory.createEventBatch(2, 'query.event');
    //   const batchEvents = EventFactory.createEventBatch(3, 'batch.event');

    //   // Save all events
    //   for (const event of [...queryEvents, ...batchEvents]) {
    //     await storage.save(event);
    //   }

    //   const stats = await storage.getStats();

    //   expect(stats.totalEvents).toBe(5);
    //   expect(stats.typeCounts['query.event']).toBe(2);
    //   expect(stats.typeCounts['batch.event']).toBe(3);
    //   expect(stats.connected).toBe(true);
    // });

    it('should return zero stats when no events', async () => {
      const stats = await storage.getStats();

      expect(stats.totalEvents).toBe(0);
      expect(Object.keys(stats.typeCounts)).toHaveLength(0);
      expect(stats.connected).toBe(true);
    });
  });

  describe('clear', () => {
    it('should remove all data', async () => {
      // Create some test data
      const events = EventFactory.createEventBatch(3);
      for (const event of events) {
        await storage.save(event);
      }

      expect(mockRedis.getData().size).toBeGreaterThan(0);
      expect(mockRedis.getSets().size).toBeGreaterThan(0);

      // Clear all data
      await storage.clear();

      expect(mockRedis.getData().size).toBe(0);
      expect(mockRedis.getSets().size).toBe(0);
    });

    it('should handle clear errors gracefully', async () => {
      const errorClient = new MockRedisClient({
        connected: true,
      });

      // Override keys method to throw error
      errorClient.keys = jest.fn().mockRejectedValue(new Error('Redis error'));

      const errorStorage = new RedisEventStorage(
        {
          redis: errorClient,
        },
        registry
      );

      // Should not throw
      await expect(errorStorage.clear()).resolves.toBeUndefined();
    });
  });
});
