import type { RedisClient, RedisPipeline } from '@/cache/redis-storage';

/**
 * Mock Redis client for unit testing
 * Simulates Redis behavior without actual Redis connection
 */
export class MockRedisClient implements RedisClient {
  private data = new Map<string, Map<string, string>>();
  private sets = new Map<string, Set<string>>();
  private expirations = new Map<string, number>();
  private connected: boolean = false;
  private latency: number = 0;

  constructor(options: { latency?: number; connected?: boolean } = {}) {
    this.latency = options.latency ?? 0;
    this.connected = options.connected ?? true;
  }

  async connect(): Promise<void> {
    this.connected = true;
  }

  async disconnect(): Promise<void> {
    this.connected = false;
  }

  isConnected(): boolean {
    return this.connected;
  }

  async healthCheck(): Promise<boolean> {
    return this.connected;
  }

  async ping(): Promise<string> {
    if (!this.connected) throw new Error('Redis not connected');
    return 'PONG';
  }

  async hSet(key: string, field: string, value: string): Promise<number> {
    if (!this.connected) throw new Error('Redis not connected');

    await this.simulateLatency();

    if (!this.data.has(key)) {
      this.data.set(key, new Map());
    }
    this.data.get(key)!.set(field, value);
    return 1;
  }

  async hGet(key: string, field: string): Promise<string | null> {
    if (!this.connected) throw new Error('Redis not connected');

    await this.simulateLatency();

    if (this.isExpired(key)) {
      this.deleteKey(key);
      return null;
    }

    return this.data.get(key)?.get(field) ?? null;
  }

  async hGetAll(key: string): Promise<Record<string, string>> {
    if (!this.connected) throw new Error('Redis not connected');

    await this.simulateLatency();

    if (this.isExpired(key)) {
      this.deleteKey(key);
      return {};
    }

    const keyData = this.data.get(key);
    const result: Record<string, string> = {};

    if (keyData) {
      keyData.forEach((value, field) => {
        result[field] = value;
      });
    }

    return result;
  }

  async hDel(key: string, field: string): Promise<number> {
    if (!this.connected) throw new Error('Redis not connected');

    await this.simulateLatency();

    const keyData = this.data.get(key);
    if (!keyData || !keyData.has(field)) {
      return 0;
    }

    keyData.delete(field);
    if (keyData.size === 0) {
      this.data.delete(key);
    }

    return 1;
  }

  async del(key: string): Promise<number> {
    if (!this.connected) throw new Error('Redis not connected');

    await this.simulateLatency();

    return this.deleteKey(key);
  }

  async sAdd(key: string, member: string): Promise<number> {
    if (!this.connected) throw new Error('Redis not connected');

    await this.simulateLatency();

    if (!this.sets.has(key)) {
      this.sets.set(key, new Set());
    }

    const set = this.sets.get(key)!;
    const existed = set.has(member);
    set.add(member);

    return existed ? 0 : 1;
  }

  async sRem(key: string, member: string): Promise<number> {
    if (!this.connected) throw new Error('Redis not connected');

    await this.simulateLatency();

    const set = this.sets.get(key);
    if (!set || !set.has(member)) {
      return 0;
    }

    set.delete(member);
    if (set.size === 0) {
      this.sets.delete(key);
    }

    return 1;
  }

  async sMembers(key: string): Promise<string[]> {
    if (!this.connected) throw new Error('Redis not connected');

    await this.simulateLatency();

    if (this.isExpired(key)) {
      this.deleteKey(key);
      return [];
    }

    const set = this.sets.get(key);
    return set ? Array.from(set.values()) : [];
  }

  async keys(pattern: string): Promise<string[]> {
    if (!this.connected) throw new Error('Redis not connected');

    await this.simulateLatency();

    const regex = new RegExp(pattern.replace(/\*/g, '.*'));
    const allKeys: string[] = [];

    // Add hash keys
    for (const key of this.data.keys()) {
      if (!this.isExpired(key) && regex.test(key)) {
        allKeys.push(key);
      }
    }

    // Add set keys
    for (const key of this.sets.keys()) {
      if (!this.isExpired(key) && regex.test(key)) {
        allKeys.push(key);
      }
    }

    return allKeys;
  }

  async expire(key: string, seconds: number): Promise<boolean> {
    if (!this.connected) throw new Error('Redis not connected');

    await this.simulateLatency();

    if (!this.data.has(key) && !this.sets.has(key)) {
      return false;
    }

    this.expirations.set(key, Date.now() + seconds * 1000);
    return true;
  }

  pipeline(): RedisPipeline {
    return new MockRedisPipeline(this);
  }

  // Test helper methods
  getData(): Map<string, Map<string, string>> {
    return new Map(this.data);
  }

  getSets(): Map<string, Set<string>> {
    return new Map(this.sets);
  }

  getExpirations(): Map<string, number> {
    return new Map(this.expirations);
  }

  clear(): void {
    this.data.clear();
    this.sets.clear();
    this.expirations.clear();
  }

  setConnected(connected: boolean): void {
    this.connected = connected;
  }

  setLatency(latency: number): void {
    this.latency = latency;
  }

  // Private helper methods
  private deleteKey(key: string): number {
    let deleted = 0;

    if (this.data.has(key)) {
      this.data.delete(key);
      deleted++;
    }

    if (this.sets.has(key)) {
      this.sets.delete(key);
      deleted++;
    }

    this.expirations.delete(key);
    return deleted;
  }

  private isExpired(key: string): boolean {
    const expiration = this.expirations.get(key);
    return expiration ? Date.now() > expiration : false;
  }

  private async simulateLatency(): Promise<void> {
    if (this.latency > 0) {
      await new Promise((resolve) => setTimeout(resolve, this.latency));
    }
  }
}

/**
 * Mock Redis Pipeline for testing
 */
export class MockRedisPipeline implements RedisPipeline {
  private operations: Array<() => Promise<any>> = [];
  private mockClient: MockRedisClient;

  constructor(mockClient: MockRedisClient) {
    this.mockClient = mockClient;
  }

  hSet(key: string, field: string, value: string): RedisPipeline {
    this.operations.push(() => this.mockClient.hSet(key, field, value));
    return this;
  }

  sAdd(key: string, member: string): RedisPipeline {
    this.operations.push(() => this.mockClient.sAdd(key, member));
    return this;
  }

  sRem(key: string, member: string): RedisPipeline {
    this.operations.push(() => this.mockClient.sRem(key, member));
    return this;
  }

  del(key: string): RedisPipeline {
    this.operations.push(() => this.mockClient.del(key));
    return this;
  }

  expire(key: string, seconds: number): RedisPipeline {
    this.operations.push(() => this.mockClient.expire(key, seconds));
    return this;
  }

  async exec(): Promise<any[]> {
    const results = await Promise.all(
      this.operations.map((op) => op().catch((err) => err))
    );
    this.operations = [];
    return results;
  }
}

/**
 * Create a mock Redis client with specific configuration
 */
export function createMockRedisClient(
  options: {
    latency?: number;
    connected?: boolean;
    initialData?: Record<string, Record<string, string>>;
  } = {}
): MockRedisClient {
  const client = new MockRedisClient(options);

  // Initialize with test data if provided
  if (options.initialData) {
    for (const [key, fields] of Object.entries(options.initialData)) {
      for (const [field, value] of Object.entries(fields)) {
        client.hSet(key, field, value);
      }
    }
  }

  return client;
}

/**
 * Test utilities for Redis operations
 */
export class RedisTestUtils {
  /**
   * Generate test Redis keys following the library's pattern
   */
  static generateRedisKey(eventId: string, prefix: string = 'events:'): string {
    return `${prefix}${eventId}`;
  }

  static generateTypeIndexKey(
    eventType: string,
    prefix: string = 'events:'
  ): string {
    return `${prefix}type:${eventType}`;
  }

  static generateAggregateIndexKey(
    aggregateId: string,
    prefix: string = 'events:'
  ): string {
    return `${prefix}aggregate:${aggregateId}`;
  }

  static generateDateIndexKey(date: Date, prefix: string = 'events:'): string {
    const dateStr = date.toISOString().split('T')[0]; // YYYY-MM-DD
    return `${prefix}date:${dateStr}`;
  }
}
