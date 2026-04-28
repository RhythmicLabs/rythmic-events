import { createClient } from 'redis';
import type { RedisClient } from '@/cache/redis-storage';
import type { EventStorage } from '@/cache/storage';
import { EventRegistry } from '@/domain-events/event-registry';
import type { EventBus } from '@/pubsub/index';
import type { PubSubProvider } from '@/pubsub/provider';
import type { SuspensionManager } from '@/suspension/index';
import type { ReminderManager } from '@/reminder/index';

/**
 * Test setup utilities for isolated test environments
 */
export class TestSetup {
  /**
   * Create a Redis client for testing
   * Uses different database for isolation
   */
  static createRedisClient(dbIndex: number = 0): RedisClient {
    const client = createClient({
      socket: {
        host: process.env.REDIS_HOST || 'localhost',
        port: parseInt(process.env.REDIS_PORT || '6380'),
      },
      password: process.env.REDIS_PASSWORD || 'testpass',
      database: dbIndex,
    });

    // Connect and verify
    if (process.env.NODE_ENV !== 'test') {
      client.on('error', (err) => {
        console.error('Redis connection error:', err);
      });
    }

    return client as unknown as RedisClient;
  }

  /**
   * Create Redis storage for testing
   */
  static async createRedisStorage(
    dbIndex: number = 0,
    registry?: EventRegistry
  ): Promise<EventStorage> {
    const { RedisEventStorage } = await import('../../cache/redis-storage');
    const redisClient = this.createRedisClient(dbIndex);

    if (redisClient.connect) {
      await redisClient.connect();
    }

    return new RedisEventStorage(
      {
        redis: redisClient,
        keyPrefix: `test:${dbIndex}:events:`,
        eventTTL: 300, // 5 minutes for tests
        enableIndexes: true,
      },
      registry
    );
  }

  /**
   * Create an EventBus for testing
   */
  static async createEventBus(
    options: {
      withCache?: boolean;
      withRedis?: boolean;
      cacheSize?: number;
      dbIndex?: number;
    } = {}
  ): Promise<EventBus> {
    const { EventBus } = await import('../../pubsub/index');

    const eventBusOptions: any = {
      enableCache: options.withCache !== false,
      cacheSize: options.cacheSize ?? 100,
      cacheTTL: 60000, // 1 minute for tests
    };

    // Add Redis storage if requested
    if (options.withRedis) {
      const registry = this.createEventRegistry();
      const redisStorage = await this.createRedisStorage(
        options.dbIndex ?? 0,
        registry
      );
      eventBusOptions.storage = redisStorage;
      eventBusOptions.mode = 'write_through';
    }

    // Use LocalPubSubProvider
    const { LocalPubSubProvider } = await import('../../pubsub/local-provider');
    const provider = new LocalPubSubProvider();
    eventBusOptions.provider = provider;

    return new EventBus(eventBusOptions);
  }

  /**
   * Create isolated EventRegistry instance
   */
  static createEventRegistry(): EventRegistry {
    // Reset singleton for test isolation
    (EventRegistry.getInstance() as any).instance = undefined;
    return EventRegistry.getInstance();
  }

  /**
   * Create SuspensionManager for testing
   */
  static async createSuspensionManager(
    provider?: PubSubProvider
  ): Promise<SuspensionManager> {
    const { SuspensionManager } = await import('../../suspension/index');

    if (provider) {
      return new SuspensionManager(provider);
    }

    // Use LocalPubSubProvider as default
    const { LocalPubSubProvider } = await import('../../pubsub/local-provider');
    const localProvider = new LocalPubSubProvider();
    return new SuspensionManager(localProvider);
  }

  /**
   * Create ReminderManager for testing
   */
  static async createReminderManager(
    options: {
      withRedis?: boolean;
      dbIndex?: number;
    } = {}
  ): Promise<ReminderManager> {
    const { ReminderManager } = await import('../../reminder/index');

    const eventBus = await this.createEventBus({
      withCache: true,
      withRedis: options.withRedis,
      dbIndex: options.dbIndex ?? 0,
    });

    // ReminderManager needs a provider
    const { LocalPubSubProvider } = await import('../../pubsub/local-provider');
    const provider = new LocalPubSubProvider();

    return new ReminderManager(eventBus, provider);
  }

  /**
   * Clean up test database
   */
  static async cleanupRedisDatabase(dbIndex: number = 0): Promise<void> {
    const redisClient = this.createRedisClient(dbIndex);

    try {
      if (redisClient.connect) {
        await redisClient.connect();
      }
      if (redisClient.flushDb) {
        await redisClient.flushDb();
      }
    } catch (error) {
      console.warn(`Failed to cleanup Redis DB ${dbIndex}:`, error);
    } finally {
      if (redisClient.disconnect) {
        await redisClient.disconnect();
      }
    }
  }

  /**
   * Setup test environment before each test
   */
  static async setupTest(
    options: {
      withRedis?: boolean;
      dbIndex?: number;
    } = {}
  ): Promise<{
    redisClient?: RedisClient;
    storage?: EventStorage;
    eventBus?: EventBus;
    registry: EventRegistry;
  }> {
    // Always create isolated registry
    const registry = this.createEventRegistry();

    let redisClient: RedisClient | undefined;
    let storage: EventStorage | undefined;
    let eventBus: EventBus | undefined;

    if (options.withRedis) {
      redisClient = this.createRedisClient(options.dbIndex ?? 0);
      if (redisClient.connect) {
        await redisClient.connect();
      }

      storage = await this.createRedisStorage(options.dbIndex ?? 0, registry);
      eventBus = await this.createEventBus({
        withCache: true,
        withRedis: true,
        dbIndex: options.dbIndex ?? 0,
      });
    } else {
      eventBus = await this.createEventBus({
        withCache: true,
        withRedis: false,
      });
    }

    return {
      redisClient,
      storage,
      eventBus,
      registry,
    };
  }

  /**
   * Teardown test environment after each test
   */
  static async teardownTest(env: {
    redisClient?: RedisClient;
    storage?: any;
    eventBus?: any;
  }): Promise<void> {
    try {
      // Disconnect Redis if used
      if (env.redisClient) {
        if (env.redisClient.disconnect) {
          await env.redisClient.disconnect();
        }
      }

      // Cleanup storage if it has clear method
      if (env.storage && typeof env.storage.clear === 'function') {
        await env.storage.clear();
      }

      // Cleanup event bus if it has clear cache method
      if (env.eventBus && typeof env.eventBus.clearCache === 'function') {
        await env.eventBus.clearCache();
      }
    } catch (error) {
      console.warn('Error during test teardown:', error);
    }
  }

  /**
   * Wait for async operations to complete
   */
  static async waitForAsync(ms: number = 10): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Create test timeout promise
   */
  static createTimeoutPromise<T>(
    ms: number,
    message: string = 'Operation timed out'
  ): Promise<T> {
    return new Promise((_, reject) => {
      setTimeout(() => reject(new Error(message)), ms);
    });
  }

  /**
   * Assert Redis is healthy
   */
  static async assertRedisHealthy(redisClient: RedisClient): Promise<void> {
    if (redisClient.ping) {
      const ping = await redisClient.ping();
      if (ping !== 'PONG') {
        throw new Error('Redis is not healthy');
      }
    }
  }
}

/**
 * Environment detection utilities
 */
export class TestEnvironment {
  /**
   * Check if running in CI environment
   */
  static isCI(): boolean {
    return (
      process.env.CI === 'true' ||
      process.env.GITHUB_ACTIONS === 'true' ||
      process.env.JENKINS_URL !== undefined
    );
  }

  /**
   * Check if Redis is available
   */
  static async isRedisAvailable(): Promise<boolean> {
    try {
      const client = createClient({
        socket: {
          host: process.env.REDIS_HOST || 'localhost',
          port: parseInt(process.env.REDIS_PORT || '6380'),
        },
        password: process.env.REDIS_PASSWORD || 'testpass',
      });

      await client.connect();
      const pong = await client.ping();
      await client.disconnect();

      return pong === 'PONG';
    } catch {
      return false;
    }
  }

  /**
   * Get test database index based on test name
   */
  static getTestDbIndex(testName: string): number {
    // Use hash of test name to get consistent DB index
    const hash = testName
      .split('')
      .reduce((acc, char) => acc + char.charCodeAt(0), 0);
    return (Math.abs(hash) % 10) + 1; // Use databases 1-10 for tests
  }
}
