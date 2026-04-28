# Caching Architecture

## Overview

The `@rhythmiclabs/rhythmic-events` library provides a flexible caching system that supports multiple storage modes, including memory-only caching, write-through caching with persistent storage, and storage-only access. The architecture is designed to be extensible, allowing users to implement custom storage backends while maintaining backward compatibility with existing memory-only caching.

## Architecture

```
┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
│   EventBus      │───▶│   EventCache    │───▶│  EventStorage   │
│                 │    │                 │    │                 │
│  - publish()    │    │  - Memory Cache │    │  - Generic Impl │
│  - subscribe()  │    │  - LRU + TTL    │    │  - Redis Impl   │
│  - getHistory() │    │  - Write-Thru   │    │  - User Impl    │
└─────────────────┘    └─────────────────┘    └─────────────────┘
```

## Storage Modes

### 1. Memory Mode (`StorageMode.MEMORY`)

The default mode that provides in-memory caching with LRU eviction and TTL support.

- **Performance**: Fastest (O(1) operations)
- **Persistence**: None (data lost on restart)
- **Use Case**: Short-lived applications, development, testing

### 2. Write-Through Mode (`StorageMode.WRITE_THROUGH`)

Combines in-memory caching with persistent storage for both performance and durability.

- **Performance**: Fast reads (cache-first), writes (async)
- **Persistence**: Yes (via storage backend)
- **Use Case**: Production applications requiring durability

**Write Flow:**

1. Cache receives event
2. Store in memory cache immediately
3. Persist to storage backend
4. Return success (cache operation continues even if storage fails with fallback)

**Read Flow:**

1. Check memory cache first
2. If miss, query storage backend
3. Populate cache with loaded data
4. Return event

### 3. Storage-Only Mode (`StorageMode.STORAGE_ONLY`)

Bypasses memory cache and uses storage backend directly.

- **Performance**: Dependent on storage backend
- **Persistence**: Yes (via storage backend)
- **Use Case**: Applications with shared storage, memory constraints

## Core Interfaces

### EventStorage Interface

Generic interface that all storage implementations must follow:

```typescript
export interface EventStorage {
  // Core CRUD operations
  save(event: DomainEvent): Promise<void>;
  load(eventId: string): Promise<DomainEvent | null>;
  delete(eventId: string): Promise<boolean>;

  // Query operations
  query(criteria: QueryCriteria): Promise<DomainEvent[]>;

  // Lifecycle management
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  isConnected(): boolean;
  healthCheck(): Promise<boolean>;
}
```

### QueryCriteria Interface

Flexible query interface for retrieving events:

```typescript
export interface QueryCriteria {
  eventType?: string; // Filter by event type
  limit?: number; // Maximum results to return
  before?: Date; // Events before this date
  after?: Date; // Events after this date
  aggregateId?: string; // Events for this aggregate
}
```

## Redis Implementation

The library includes a comprehensive Redis implementation (`RedisEventStorage`) that provides:

### Features

- **Event Persistence**: Stores events as Redis hashes with metadata
- **Secondary Indexes**: Type, aggregate, and date-based indexes for efficient queries
- **TTL Support**: Automatic expiration of old events (default: 7 days)
- **Health Monitoring**: Connection health checks and automatic reconnection
- **Error Handling**: Graceful degradation and detailed error reporting

### Redis Data Structure

```
events:{eventId}              # Hash containing event data
  - data: {serialized event}
  - type: "user.created"
  - occurredOn: "2024-01-01T00:00:00.000Z"
  - aggregateId: "user-123"
  - version: "1"

events:types:{eventType}      # Set of event IDs by type
events:aggregates:{id}        # Set of event IDs by aggregate
events:dates:{yyyy-mm-dd}     # Set of event IDs by date
```

### Configuration Options

```typescript
export interface RedisStorageOptions {
  redis: RedisClientOptions; // Redis client configuration
  keyPrefix?: string; // Key prefix (default: "events")
  eventTTL?: number; // TTL in seconds (default: 604800 = 7 days)
  enableIndexes?: boolean; // Enable secondary indexes (default: true)
}
```

## Usage Examples

### Basic Memory-Only Caching (Default)

```typescript
import { EventBus } from '@rhythmiclabs/rhythmic-events';

const eventBus = new EventBus({
  enableCache: true,
  cacheSize: 1000,
  cacheTTL: 300000, // 5 minutes
});

await eventBus.publish(someEvent);
const history = await eventBus.getEventHistory('user.created', 10);
```

### Write-Through Caching with Redis

```typescript
import {
  EventBus,
  RedisEventStorage,
  StorageMode,
} from '@rhythmiclabs/rhythmic-events';

const redisStorage = new RedisEventStorage({
  redis: {
    url: 'redis://localhost:6379',
  },
  keyPrefix: 'myapp:events',
  eventTTL: 30 * 24 * 60 * 60, // 30 days
  enableIndexes: true,
});

await redisStorage.connect();

const eventBus = new EventBus({
  enableCache: true,
  storageMode: StorageMode.WRITE_THROUGH,
  storage: redisStorage,
  cacheSize: 1000,
  cacheTTL: 300000,
  cacheFallbackToStorage: true, // Continue with cache if storage fails
});
```

### Storage-Only Mode

```typescript
const eventBus = new EventBus({
  enableCache: true,
  storageMode: StorageMode.STORAGE_ONLY,
  storage: redisStorage,
  cacheTTL: 0, // No memory caching
});
```

### Custom Storage Implementation

```typescript
class MyDatabaseStorage implements EventStorage {
  async connect(): Promise<void> {
    // Connect to your database
  }

  async save(event: DomainEvent): Promise<void> {
    // Save to your database
    await db.events.insert(event.toJSON());
  }

  async load(eventId: string): Promise<DomainEvent | null> {
    // Load from your database
    const data = await db.events.findOne({ id: eventId });
    return data ? DomainEvent.fromJSON(data) : null;
  }

  // ... implement other methods
}

const customStorage = new MyDatabaseStorage();
await customStorage.connect();

const eventBus = new EventBus({
  enableCache: true,
  storageMode: StorageMode.WRITE_THROUGH,
  storage: customStorage,
});
```

## Performance Characteristics

### Memory Operations

- **Add**: O(1) with LRU eviction when full
- **Get**: O(1)
- **Query**: O(n) where n is cache size
- **T Cleanup**: O(n) on each operation (lazy cleanup)

### Redis Operations

- **Add**: O(log k) where k is number of indexes
- **Get**: O(1)
- **Query**: O(m + log m) where m is result set size
- **Memory Usage**: O(n) where n is number of stored events

### Network Considerations

- **Latency**: Each Redis operation adds ~1-10ms network latency
- **Connection Pooling**: Single connection reused for all operations
- **Timeouts**: Configurable with default 30-second timeout

## Configuration Reference

### EventBus Options

```typescript
export interface PubSubOptions {
  enableCache?: boolean; // Enable event caching
  cacheSize?: number; // Memory cache size (default: 1000)
  cacheTTL?: number; // Memory cache TTL in ms (default: 300000)
  storageMode?: StorageMode; // Storage mode
  storage?: EventStorage; // Storage implementation
  cacheFallbackToStorage?: boolean; // Fallback behavior (default: true)
}
```

### EventCache Options

```typescript
export interface CacheOptions {
  maxSize: number; // Maximum cache size
  ttl: number; // TTL in milliseconds
  mode?: StorageMode; // Storage mode
  storage?: EventStorage; // Storage implementation
  fallbackToCache?: boolean; // Cache fallback on storage errors
}
```

### Redis Options

```typescript
export interface RedisStorageOptions {
  redis: RedisClientOptions; // Redis client configuration
  keyPrefix?: string; // Key namespace prefix
  eventTTL?: number; // Event TTL in seconds
  enableIndexes?: boolean; // Enable secondary indexes
}
```

## Migration Guide

### From Memory-Only to Write-Through

1. **Add Redis Dependency**:

   ```bash
   npm install redis
   ```

2. **Update Configuration**:

   ```typescript
   // Before
   const eventBus = new EventBus({
     enableCache: true,
     cacheSize: 1000,
     cacheTTL: 300000,
   });

   // After
   const redisStorage = new RedisEventStorage({
     redis: { url: 'redis://localhost:6379' },
   });

   const eventBus = new EventBus({
     enableCache: true,
     storageMode: StorageMode.WRITE_THROUGH,
     storage: redisStorage,
     cacheSize: 1000,
     cacheTTL: 300000,
   });
   ```

3. **Gradual Migration**:
   - Deploy with `fallbackToCache: true` to ensure availability
   - Monitor Redis connection and performance
   - Switch to `fallbackToCache: false` for stricter durability

### Backward Compatibility

All existing code continues to work unchanged:

```typescript
// This continues to work exactly as before
const eventBus = new EventBus({
  enableCache: true,
  cacheSize: 1000,
});
```

## Error Handling and Resilience

### Write-Through Failures

When storage fails in write-through mode:

1. **With Fallback** (`fallbackToCache: true`):
   - Event remains in memory cache
   - Warning is logged
   - Operation continues

2. **Without Fallback** (`fallbackToCache: false`):
   - Exception is thrown
   - Operation fails
   - Application can handle error appropriately

### Connection Management

- **Auto-Reconnection**: Redis client automatically reconnects on connection loss
- **Health Checks**: Periodic health checks validate storage connectivity
- **Graceful Degradation**: Cache continues operating during storage outages

### Monitoring

Redis storage provides statistics for monitoring:

```typescript
const stats = await redisStorage.getStats();
console.log('Total events:', stats.totalEvents);
console.log('Type distribution:', stats.typeCounts);
console.log('Connected:', stats.connected);
```

## Best Practices

### Memory Management

1. **Set Appropriate Cache Size**: Balance memory usage and hit rate
2. **Configure TTL**: Ensure old events don't consume memory indefinitely
3. **Monitor Memory Usage**: Watch for memory leaks in long-running processes

### Redis Configuration

1. **Configure Persistence**: Enable AOF or RDB for durability
2. **Set Memory Limits**: Configure `maxmemory` and eviction policies
3. **Monitor Connections**: Use connection pooling and timeouts
4. **Enable Indexes**: Use `enableIndexes: true` for better query performance

### Error Handling

1. **Use Fallback**: Enable `fallbackToCache: true` for high availability
2. **Log Errors**: Monitor storage failures for early detection
3. **Circuit Breakers**: Implement circuit breakers for storage dependencies
4. **Health Checks**: Regularly validate storage connectivity

### Performance Optimization

1. **Batch Operations**: Use `publishBatch()` for multiple events
2. **Query Optimization**: Use specific criteria to reduce result sets
3. **Connection Reuse**: Share storage instances across application components
4. **Async Patterns**: Leverage async/await for non-blocking operations

## Troubleshooting

### Common Issues

1. **Redis Connection Errors**:
   - Check Redis server is running
   - Verify connection URL and credentials
   - Check network connectivity and firewalls

2. **Memory Issues**:
   - Reduce cache size or TTL
   - Monitor memory usage trends
   - Consider storage-only mode for large datasets

3. **Performance Issues**:
   - Enable Redis indexes for better query performance
   - Check Redis server configuration
   - Monitor network latency

4. **Event Not Found**:
   - Check if event has expired (TTL)
   - Verify storage connectivity
   - Check query criteria and filters

### Debugging

Enable debug logging for detailed troubleshooting:

```typescript
// Add console listener for Redis events
redisStorage.getClient().on('error', (err) => {
  console.error('Redis Error:', err);
});

// Check cache statistics
console.log('Cache stats:', await eventBus.getCacheStats());

// Check storage health
console.log('Storage healthy:', await redisStorage.healthCheck());
```

## API Reference

For detailed API documentation, see the TypeScript definitions and inline documentation in the source code.

- `EventCache` class and methods
- `EventStorage` interface
- `RedisEventStorage` implementation
- `EventBus` integration methods
- `StorageMode` enum and options

## Support

For issues, questions, or contributions:

- **GitHub Issues**: [kubegram/events](https://github.com/kubegram/kubegram)
- **Documentation**: See inline TypeScript documentation
- **Examples**: Check the test files for comprehensive usage examples
