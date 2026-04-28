# @rhythmiclabs/rhythmic-events

A comprehensive TypeScript event library providing typed event emitters, domain events, pub/sub messaging, event suspension, caching, and reminder workflows.

## Overview

This library offers a complete event-driven architecture solution with TypeScript support, combining multiple event patterns in a single, cohesive package:

- 🚀 **Typed Event Emitter**: Type-safe event emission and handling
- 🏗️ **Domain Events**: Domain-Driven Design (DDD) event patterns with serialization
- 📡 **Pub/Sub System**: Async publish/subscribe messaging with subscription management
- 💾 **Event Caching**: Performance-optimized event storage with Redis support
- ⏸️ **Event Suspension**: Request-response patterns with timeout handling
- 🔔 **Reminder Manager**: Automated reminder workflows with response handling
- ⏰ **Cron Scheduler**: Declarative cron-based event scheduling with `ScheduledEventManager`
- 📊 ****: In-memory graph storage with vector similarity search for RAG
- 🔧 **Production Ready**: Full TypeScript support, comprehensive testing, and type safety

## Features

- **Type Safety**: Full TypeScript support with generic types
- **Event Registry**: Centralized event registration and deserialization
- **Event Caching**: Configurable TTL, size limits, and Redis persistence
- **Subscription Management**: Advanced subscription control with once/off/unsubscribe
- **Domain Events**: DDD-compliant event patterns with metadata
- **Async Support**: Promise-based event handling
- **Event Suspension**: Request-response correlation with timeout management
- **Reminder Workflows**: Automated reminder and response handling
- **Cron Scheduling**: Schedule events on cron expressions with `croner`; supports `tickFactory` for custom domain events, `maxTicks`, pause/resume/unschedule, and `startImmediately`
- **In-Memory Graph Store**: Graph and microservice CRUD with LRU eviction and cosine vector search
- **Vector Similarity Search**: Built-in cosine similarity and topK search for RAG embeddings
- **Redis Integration**: Production-grade storage with indexing and TTL
- **Custom Providers**: Extensible pub/sub provider architecture
- **Performance Optimized**: Built on eventemitter3 for maximum performance
- **Comprehensive Testing**: 95%+ test coverage

## Installation

```bash
npm install @rhythmiclabs/rhythmic-events
```

For Redis support (optional):

```bash
npm install redis
```

For cron scheduling support (optional):

```bash
npm install croner
```

## Quick Start

### Basic Typed Event Emitter

```typescript
import {
  TypedEventEmitter,
  createTypedEventEmitter,
} from '@rhythmiclabs/rhythmic-events';

interface AppEvents {
  'user:created': { id: string; name: string };
  'user:deleted': { id: string };
  'notification:sent': { message: string; userId: string };
}

const emitter = createTypedEventEmitter<AppEvents>();

// Listen for events
emitter.on('user:created', (data) => {
  console.log(`User created: ${data.name} (${data.id})`);
});

// Emit events
emitter.emit('user:created', { id: '123', name: 'John Doe' });
emitter.emit('notification:sent', { message: 'Welcome!', userId: '123' });
```

### Domain Events with Registry

```typescript
import {
  DomainEvent,
  DomainEventDispatcher,
  EventRegistry,
} from '@rhythmiclabs/rhythmic-events';

// Define domain events
class UserCreatedEvent extends DomainEvent {
  constructor(
    public readonly userId: string,
    public readonly name: string,
    aggregateId?: string
  ) {
    super('user.created', aggregateId);
  }
}

// Register with event registry for deserialization
EventRegistry.getInstance().register(
  'user.created',
  (json) =>
    new UserCreatedEvent(
      json.metadata?.userId as string,
      json.metadata?.name as string,
      json.aggregateId
    )
);

// Create event dispatcher
const dispatcher = new DomainEventDispatcher();

// Register handlers
dispatcher.register('user.created', async (event: UserCreatedEvent) => {
  console.log(`Processing user creation: ${event.name}`);
});

// Dispatch events
const event = new UserCreatedEvent('123', 'John Doe', 'user-123');
await dispatcher.dispatch(event);
```

### EventBus with Caching

```typescript
import { EventBus } from '@rhythmiclabs/rhythmic-events';

// Create event bus with caching
const eventBus = new EventBus({
  enableCache: true,
  cacheSize: 1000,
  cacheTTL: 300000, // 5 minutes
});

// Subscribe to events
const subscriptionId = eventBus.subscribe('user.created', async (event) => {
  console.log('User created:', event);
});

// Publish events
await eventBus.publish(event);

// Get event history
const history = await eventBus.getEventHistory('user.created', 10);
console.log('Recent events:', history);
```

### Event Suspension (Request-Response)

```typescript
import {
  SuspensionManager,
  LocalPubSubProvider,
} from '@rhythmiclabs/rhythmic-events';

const provider = new LocalPubSubProvider();
const suspensionManager = new SuspensionManager(provider);

// Create request and response events
class DataRequestEvent extends DomainEvent {
  constructor(
    public readonly query: string,
    correlationId?: string
  ) {
    super('data.request', correlationId);
  }
}

class DataResponseEvent extends DomainEvent {
  constructor(
    public readonly data: any,
    correlationId?: string
  ) {
    super('data.response', correlationId);
  }
}

// Request data with timeout
const requestEvent = new DataRequestEvent('SELECT * FROM users');
try {
  const result = await suspensionManager.suspendForResponse(
    requestEvent,
    'data.response',
    requestEvent.id, // Use event ID as correlation
    { timeout: 5000 }
  );
  console.log('Response received:', result.response);
} catch (error) {
  console.log('Request timed out:', error.message);
}
```

### Reminder Manager Workflow

```typescript
import {
  ReminderManager,
  EventBus,
  LocalPubSubProvider,
} from '@rhythmiclabs/rhythmic-events';

const eventBus = new EventBus();
const reminderManager = new ReminderManager(eventBus);

// Set up automatic reminder handler
reminderManager.onReminder(
  async (reminderEvent) => {
    console.log(`Processing reminder: ${reminderEvent.prompt}`);
    // Handle reminder logic
  },
  {
    // Filter reminders by priority
    filter: (event) => event.priority === 'high',
    // Auto-respond with generated response
    autoRespond: true,
    responseGenerator: (event) => ({
      status: 'completed',
      timestamp: new Date().toISOString(),
    }),
  }
);

// Send a reminder prompt
const result = await reminderManager.sendPrompt(
  'Please process monthly report',
  { month: 'January', year: 2024 },
  {
    priority: 'high',
    timeout: 60000,
    source: 'Accounting System',
  }
);

console.log(
  'Reminder completed:',
  result.response,
  'in',
  result.waitTime,
  'ms'
);
```

### Cron Scheduler

```typescript
import {
  EventBus,
  ScheduledEventManager,
  ScheduledEvent,
} from '@rhythmiclabs/rhythmic-events';

const bus = new EventBus();
const scheduler = new ScheduledEventManager(bus);

// Built-in ScheduledEvent — fires every minute with a typed payload
const id = await scheduler.schedule({
  cronExpression: '* * * * *',
  payload: { task: 'heartbeat', source: 'monitor' },
});

bus.subscribe(ScheduledEvent.EVENT_TYPE, (event) => {
  const e = event as ScheduledEvent<{ task: string }>;
  console.log(`Tick #${e.tickNumber} for schedule ${e.scheduleId}`);
  console.log('Payload:', e.payload);
});

// Custom domain event via tickFactory
await scheduler.schedule({
  cronExpression: '0 9 * * 1', // every Monday at 9am
  tickFactory: (tick) =>
    new WeeklyReportEvent({ scheduleId: tick.scheduleId }),
});

// Auto-stop after N ticks
await scheduler.schedule({
  cronExpression: '*/5 * * * *',
  maxTicks: 12,                  // runs 12 times then exhausts
  payload: { batch: 'hourly' },
});

// Pause, resume, and remove
scheduler.stop(id);              // pause — ticks are ignored
scheduler.start(id);             // resume
scheduler.unschedule(id);        // permanent removal

// Introspection
const entry = scheduler.getSchedule(id);  // { tickCount, status, lastFiredAt, ... }
const active = scheduler.getActiveCount();

// Teardown
scheduler.cleanup();             // stops all, clears map (idempotent)

## Advanced Usage

### Redis Storage Integration

```typescript
import {
  EventBus,
  RedisEventStorage,
  StorageMode,
} from '@rhythmiclabs/rhythmic-events';
import { createClient } from 'redis';

// Configure Redis client
const redisClient = createClient({
  url: 'redis://localhost:6379',
});
await redisClient.connect();

// Create Redis storage
const redisStorage = new RedisEventStorage({
  redis: redisClient,
  keyPrefix: 'myapp:events:',
  eventTTL: 86400, // 24 hours
  enableIndexes: true,
});

// Create event bus with Redis persistence
const eventBus = new EventBus({
  enableCache: true,
  mode: StorageMode.WRITE_THROUGH,
  storage: redisStorage,
  cacheSize: 5000,
  cacheTTL: 300000,
});

// Get Redis storage statistics
const stats = await redisStorage.getStats();
console.log('Redis stats:', {
  totalEvents: stats.totalEvents,
  typeCounts: stats.typeCounts,
  connected: stats.connected,
});
```

### Custom PubSub Provider

```typescript
import { PubSubProvider, EventBus } from '@rhythmiclabs/rhythmic-events';

// Custom provider for external message queue
class MessageQueueProvider implements PubSubProvider {
  private handlers = new Map<string, Set<Function>>();

  async publish(eventType: string, event: unknown): Promise<void> {
    // Publish to external message queue
    await this.sendToQueue('events', {
      type: eventType,
      data: event,
      timestamp: new Date().toISOString(),
    });
  }

  subscribe(eventType: string, handler: (event: unknown) => void): () => void {
    if (!this.handlers.has(eventType)) {
      this.handlers.set(eventType, new Set());
      // Subscribe to external message queue
      this.subscribeToQueue(eventType, (message) => {
        const handlers = this.handlers.get(eventType);
        if (handlers) {
          handlers.forEach((h) => h(message.data));
        }
      });
    }

    this.handlers.get(eventType)!.add(handler);

    return () => {
      const handlers = this.handlers.get(eventType);
      if (handlers) {
        handlers.delete(handler);
        if (handlers.size === 0) {
          this.handlers.delete(eventType);
          // Unsubscribe from queue
          this.unsubscribeFromQueue(eventType);
        }
      }
    };
  }

  subscribeOnce(
    eventType: string,
    handler: (event: unknown) => void
  ): () => void {
    let unsubscribe: (() => void) | null = null;
    const wrappedHandler = (event: unknown) => {
      handler(event);
      if (unsubscribe) {
        unsubscribe();
      }
    };

    unsubscribe = this.subscribe(eventType, wrappedHandler);
    return unsubscribe!;
  }

  private async sendToQueue(queue: string, message: any) {
    // Implementation for sending to message queue
  }

  private subscribeToQueue(eventType: string, handler: Function) {
    // Implementation for queue subscription
  }

  private unsubscribeFromQueue(eventType: string) {
    // Implementation for queue unsubscription
  }
}

// Use custom provider
const customProvider = new MessageQueueProvider();
const eventBus = new EventBus({
  provider: customProvider,
  enableCache: true,
});
```

### System Reminder Events

```typescript
import {
  SystemReminderEvent,
  SystemReminderResponseEvent,
  EventBus,
  ReminderManager,
} from '@rhythmiclabs/rhythmic-events';

const eventBus = new EventBus();
const reminderManager = new ReminderManager(eventBus);

// Create custom system reminder
const reminderEvent = new SystemReminderEvent({
  reminderId: 'daily-backup-reminder',
  prompt: 'Start daily backup process',
  context: {
    type: 'backup',
    priority: 'scheduled',
    targetTime: '02:00 UTC',
  },
  source: 'SystemMonitor',
  priority: 'high',
  timeout: 300000, // 5 minutes
  expectedResponseType: 'backup.started',
  userId: 'system-admin',
});

// Handle system reminders
eventBus.subscribe('system.reminder', async (event: SystemReminderEvent) => {
  console.log(`System reminder: ${event.prompt}`);
  console.log(`Context:`, event.context);
  console.log(`Priority: ${event.priority}`);

  // Process reminder
  await startBackupProcess();

  // Send response
  const responseEvent = new SystemReminderResponseEvent({
    reminderId: event.reminderId,
    response: { status: 'started', backupId: generateBackupId() },
    status: 'success',
    processingTime: 1500,
    confidence: 0.95,
  });

  await eventBus.publish(responseEvent);
});
```

### Event Filtering and Advanced Queries

```typescript
import {
  QueryCriteria,
  EventCache,
  StorageMode,
} from '@rhythmiclabs/rhythmic-events';

// Query events from cache
const cache = new EventCache({
  maxSize: 10000,
  ttl: 3600000, // 1 hour
  mode: StorageMode.MEMORY,
});

// Add events to cache
await cache.add(userCreatedEvent);
await cache.add(userDeletedEvent);
await cache.add(orderPlacedEvent);

// Query with complex criteria
const criteria: QueryCriteria = {
  eventType: 'user.created',
  limit: 50,
  before: new Date(),
  after: new Date(Date.now() - 86400000), // Last 24 hours
  aggregateId: 'user-123',
};

const recentUserEvents = await cache.getEvents(criteria);

// Time-based queries
const yesterdayEvents = await cache.getEvents({
  before: new Date(),
  after: new Date(Date.now() - 86400000),
});

// Event type filtering
const userEvents = await cache.getEvents({
  eventType: 'user.created',
});
```

### Production Setup

```typescript
import {
  EventBus,
  RedisEventStorage,
  StorageMode,
  LocalPubSubProvider,
} from '@rhythmiclabs/rhythmic-events';
import { createClient } from 'redis';

async function createProductionEventBus() {
  // Redis configuration with connection pooling
  const redisClient = createClient({
    socket: {
      host: process.env.REDIS_HOST || 'localhost',
      port: parseInt(process.env.REDIS_PORT || '6379'),
    },
    password: process.env.REDIS_PASSWORD,
    database: parseInt(process.env.REDIS_DB || '0'),
  });

  await redisClient.connect();

  // Redis storage with production settings
  const redisStorage = new RedisEventStorage({
    redis: redisClient,
    keyPrefix: `${process.env.APP_NAME || 'app'}:events:`,
    eventTTL: 604800, // 7 days
    enableIndexes: true,
  });

  // Production event bus
  const eventBus = new EventBus({
    enableCache: true,
    mode: StorageMode.WRITE_THROUGH,
    storage: redisStorage,
    cacheSize: parseInt(process.env.CACHE_SIZE || '10000'),
    cacheTTL: parseInt(process.env.CACHE_TTL || '300000'),
    fallbackToCache: true,
  });

  // Health check
  await redisStorage.connect();
  const isHealthy = await redisStorage.healthCheck();
  if (!isHealthy) {
    throw new Error('Redis storage is not healthy');
  }

  console.log('Production event bus initialized');
  return eventBus;
}

// Usage
const eventBus = await createProductionEventBus();

// Graceful shutdown
process.on('SIGTERM', async () => {
  console.log('Shutting down event bus...');
  // Cleanup would happen here
  process.exit(0);
});
```

## API Reference

### Core Classes

#### TypedEventEmitter<T>

Type-safe event emitter with full TypeScript support.

```typescript
interface TypedEventMap {
  [key: string]: unknown;
}

class TypedEventEmitter<T extends TypedEventMap> {
  on<K extends string & keyof T>(event: K, listener: (arg: T[K]) => void): this;
  once<K extends string & keyof T>(
    event: K,
    listener: (arg: T[K]) => void
  ): this;
  off<K extends string & keyof T>(
    event: K,
    listener: (arg: T[K]) => void
  ): this;
  emit<K extends string & keyof T>(event: K, arg: T[K]): boolean;
  removeAllListeners<K extends string & keyof T>(event?: K): this;
  listenerCount<K extends string & keyof T>(event: K): number;
  eventNames(): Array<string & keyof T>;
}
```

#### DomainEvent

Base class for domain events with DDD patterns.

```typescript
abstract class DomainEvent {
  readonly id: string;
  readonly type: string;
  readonly occurredOn: Date;
  readonly aggregateId?: string;
  readonly version: number;
  readonly metadata?: Record<string, unknown>;

  constructor(
    type: string,
    aggregateId?: string,
    metadata?: Record<string, unknown>
  );
  toJSON(): DomainEventJSON;
}
```

#### EventBus

Central event bus with pub/sub capabilities and caching.

```typescript
interface PubSubOptions {
  enableCache?: boolean;
  cacheSize?: number;
  cacheTTL?: number;
  storageMode?: StorageMode;
  storage?: EventStorage;
  cacheFallbackToStorage?: boolean;
  provider?: PubSubProvider;
}

class EventBus {
  constructor(options?: PubSubOptions);
  async publish(event: DomainEvent): Promise<void>;
  async publishBatch(events: DomainEvent[]): Promise<void>;
  subscribe(
    eventType: string,
    handler: Function,
    options?: { once?: boolean }
  ): string;
  subscribeOnce(eventType: string, handler: Function): string;
  unsubscribe(subscriptionId: string): boolean;
  unsubscribeByEvent(eventType: string): number;
  unsubscribeAll(): number;
  getSubscriptions(eventType?: string): Subscription[];
  getSubscriptionCount(eventType?: string): number;
  async getEventHistory(
    eventType?: string,
    limit?: number,
    before?: Date
  ): Promise<DomainEvent[]>;
  async clearCache(): Promise<void>;
  getCacheStats(): CacheStats | null;
}
```

#### EventCache

High-performance caching system with TTL and LRU eviction.

```typescript
interface CacheOptions {
  maxSize?: number;
  ttl?: number;
  mode?: StorageMode;
  storage?: EventStorage;
  fallbackToCache?: boolean;
}

enum StorageMode {
  MEMORY = 'memory',
  STORAGE_ONLY = 'storage_only',
  WRITE_THROUGH = 'write_through',
}

class EventCache {
  constructor(options?: CacheOptions);
  async add(event: DomainEvent): Promise<void>;
  async get(eventId: string): Promise<DomainEvent | null>;
  async getEvents(criteria?: QueryCriteria): Promise<DomainEvent[]>;
  async remove(eventId: string): Promise<boolean>;
  async clear(): Promise<void>;
  getStats(): CacheStats;
}
```

#### RedisEventStorage

Redis-based persistent storage with indexing.

```typescript
interface RedisStorageOptions {
  redis: RedisClient;
  keyPrefix?: string;
  eventTTL?: number;
  enableIndexes?: boolean;
}

class RedisEventStorage implements EventStorage {
  constructor(options: RedisStorageOptions, registry?: EventRegistry);
  async connect(): Promise<void>;
  async disconnect(): Promise<void>;
  isConnected(): boolean;
  async healthCheck(): Promise<boolean>;
  async save(event: DomainEvent): Promise<void>;
  async load(eventId: string): Promise<DomainEvent | null>;
  async delete(eventId: string): Promise<boolean>;
  async query(criteria: QueryCriteria): Promise<DomainEvent[]>;
  async getStats(): Promise<RedisStorageStats>;
  async clear(): Promise<void>;
}
```

#### SuspensionManager

Request-response pattern with timeout handling.

```typescript
interface SuspensionOptions {
  timeout?: number;
  correlationExtractor?: <TResp extends DomainEvent>(event: TResp) => string;
}

class SuspensionManager {
  constructor(provider: PubSubProvider, defaultTimeout?: number);
  async suspendForResponse<TReq, TResp>(
    requestEvent: TReq,
    responseEventType: string,
    correlationId: string,
    options?: SuspensionOptions
  ): Promise<SuspensionResult<TResp>>;
  resolve<TResp>(correlationId: string, responseEvent: TResp): boolean;
  cancel(correlationId: string): boolean;
  cancelAll(): number;
  getPendingCount(): number;
  isPending(correlationId: string): boolean;
  getPendingCorrelationIds(): string[];
}
```

#### ReminderManager

Automated reminder workflows with response handling.

```typescript
interface ReminderOptions {
  timeout?: number;
  priority?: 'low' | 'medium' | 'high';
  source?: string;
  userId?: string;
  sessionId?: string;
  expectedResponseType?: string;
}

interface ReminderHandlerOptions {
  filter?: (event: SystemReminderEvent) => boolean;
  autoRespond?: boolean;
  responseGenerator?: (event: SystemReminderEvent) => unknown;
}

class ReminderManager {
  constructor(eventBus: EventBus, provider?: PubSubProvider);
  async sendPrompt(
    prompt: string,
    context?: Record<string, unknown>,
    options?: ReminderOptions
  ): Promise<{ reminderId: string; response: unknown; waitTime: number }>;
  onReminder(
    handler: (event: SystemReminderEvent) => void | Promise<void>,
    options?: ReminderHandlerOptions
  ): string;
  async completeReminder(
    reminderId: string,
    response: unknown,
    status?: 'success' | 'error' | 'partial',
    options?: { processingTime?: number; error?: string }
  ): Promise<void>;
  async cancelReminder(reminderId: string): Promise<boolean>;
  async cancelAllReminders(): Promise<number>;
  getPendingReminderCount(): number;
  isPending(reminderId: string): boolean;
  getPendingReminderIds(): string[];
  async cleanup(): Promise<void>;
}
```

#### ScheduledEventManager

Publishes events on cron expressions via [croner](https://github.com/Hexagon/croner) (optional peer dep).

```typescript
// ScheduledEvent — the built-in event type
class ScheduledEvent<TPayload = unknown> extends DomainEvent<ScheduledEventData<TPayload>> {
  static readonly EVENT_TYPE = 'scheduler.tick';
  readonly scheduleId: string;
  readonly cronExpression: string;
  readonly tickNumber: number;
  readonly scheduledAt: Date;
  readonly payload: TPayload | undefined;

  static fromJSON(json: DomainEventJSON): ScheduledEvent;
}

// Descriptor passed to schedule()
interface ScheduleDescriptor<TData = unknown> {
  cronExpression: string;
  scheduleId?: string;          // auto-generated UUID if omitted
  name?: string;
  payload?: TData;              // used when tickFactory is absent
  tickFactory?: (tick: ScheduledTick) => DomainEvent;
  timezone?: string;
  startImmediately?: boolean;   // fire one tick immediately on schedule()
  maxTicks?: number;            // auto-unschedule after N ticks
  metadata?: Record<string, unknown>;
}

// Entry returned by getSchedule() / listSchedules()
interface ScheduleEntry {
  scheduleId: string;
  descriptor: Readonly<ScheduleDescriptor>;
  status: 'active' | 'stopped' | 'exhausted';
  tickCount: number;
  createdAt: Date;
  lastFiredAt?: Date;
}

class ScheduledEventManager {
  constructor(bus: EventBus);

  // Returns the scheduleId (async — lazily imports croner)
  async schedule<TData = unknown>(descriptor: ScheduleDescriptor<TData>): Promise<string>;

  stop(scheduleId: string): boolean;        // pause without removing
  start(scheduleId: string): boolean;       // resume a stopped schedule
  unschedule(scheduleId: string): boolean;  // permanent stop + remove

  getSchedule(scheduleId: string): ScheduleEntry | undefined;
  listSchedules(): ScheduleEntry[];
  getActiveCount(): number;
  cleanup(): void;                          // stop all, clear map (idempotent)
}
```

#### InMemoryGraphStore<TGraph, TMicroservice>

In-memory graph storage with secondary indexes, LRU eviction, and cosine vector search.

```typescript
interface InMemoryGraphStoreOptions {
  maxGraphs?: number;          // Default: 10000
  maxMicroservices?: number;   // Default: 10000
  idGenerator?: () => string;  // Default: crypto.randomUUID
  embeddingField?: string;     // Default: 'contextEmbedding'
  companyIdField?: string;     // Default: 'companyId'
  userIdField?: string;        // Default: 'userId'
  nameField?: string;          // Default: 'name'
}

interface GraphStoreStats {
  totalGraphs: number;
  totalMicroservices: number;
  connected: boolean;
}

class InMemoryGraphStore<TGraph, TMicroservice> implements GraphStorage<TGraph, TMicroservice> {
  constructor(options?: InMemoryGraphStoreOptions);

  // Graph CRUD
  async createGraph(graph: Omit<TGraph, 'id'>): Promise<string>;
  async getGraph(id: string, companyId?: string, userId?: string): Promise<TGraph | null>;
  async getGraphs(companyId: string, userId?: string, limit?: number): Promise<TGraph[]>;
  async getGraphByName(name: string, companyId: string, userId?: string): Promise<TGraph | null>;
  async updateGraph(id: string, updates: Partial<TGraph>): Promise<TGraph | null>;
  async deleteGraph(id: string): Promise<boolean>;
  async upsertGraph(graph: Omit<TGraph, 'id'>, identifier: { name?: string; id?: string }): Promise<string>;

  // Microservice CRUD
  async createMicroservice(microservice: Omit<TMicroservice, 'id'>): Promise<string>;
  async getMicroservice(id: string): Promise<TMicroservice | null>;
  async getMicroservices(companyId: string, limit?: number): Promise<TMicroservice[]>;
  async updateMicroservice(id: string, updates: Partial<TMicroservice>): Promise<TMicroservice | null>;
  async deleteMicroservice(id: string): Promise<boolean>;

  // Vector search
  async searchSimilarGraphsByEmbedding(embedding: number[], topK?: number, companyId?: string): Promise<TGraph[]>;

  // Lifecycle
  async connect(): Promise<void>;
  async disconnect(): Promise<void>;
  isConnected(): boolean;
  async clear(): Promise<void>;
  getStats(): GraphStoreStats;
}
```

#### Vector Search Utilities

Standalone functions for cosine similarity and topK search.

```typescript
function cosineSimilarity(a: number[], b: number[]): number;

interface SimilarityResult<T> {
  item: T;
  similarity: number;
}

function searchTopK<T>(
  items: T[],
  queryEmbedding: number[],
  getEmbedding: (item: T) => number[] | undefined,
  topK: number,
): SimilarityResult<T>[];
```

## Error Handling Patterns

### Event Processing with Error Recovery

```typescript
import { EventBus, DomainEvent } from '@rhythmiclabs/rhythmic-events';

class RobustEventProcessor {
  constructor(private eventBus: EventBus) {
    this.setupErrorHandling();
  }

  private setupErrorHandling() {
    this.eventBus.subscribe('order.placed', async (event) => {
      try {
        await this.processOrder(event);
      } catch (error) {
        console.error('Order processing failed:', error);

        // Retry logic
        if (this.shouldRetry(error)) {
          await this.scheduleRetry(event);
        } else {
          await this.handleFailure(event, error);
        }
      }
    });

    // Dead letter queue for failed events
    this.eventBus.subscribe('order.failed', async (event) => {
      await this.logToDeadLetterQueue(event);
    });
  }

  private async processOrder(event: DomainEvent) {
    // Order processing logic
  }

  private shouldRetry(error: Error): boolean {
    return error.name === 'TransientError';
  }

  private async scheduleRetry(event: DomainEvent) {
    // Schedule retry with exponential backoff
  }

  private async handleFailure(event: DomainEvent, error: Error) {
    const failureEvent = new DomainEvent('order.failed', event.aggregateId, {
      originalEvent: event,
      error: error.message,
      timestamp: new Date().toISOString(),
    });

    await this.eventBus.publish(failureEvent);
  }
}
```

### Redis Connection Error Handling

```typescript
import {
  RedisEventStorage,
  EventBus,
  StorageMode,
} from '@rhythmiclabs/rhythmic-events';
import { createClient } from 'redis';

class ResilientRedisStorage extends RedisEventStorage {
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 5;
  private reconnectDelay = 1000;

  constructor(options: any) {
    super(options);
    this.setupReconnectHandling();
  }

  private setupReconnectHandling() {
    const originalConnect = this.connect.bind(this);

    this.connect = async () => {
      try {
        await originalConnect();
        this.reconnectAttempts = 0;
        console.log('Redis connection restored');
      } catch (error) {
        this.reconnectAttempts++;

        if (this.reconnectAttempts < this.maxReconnectAttempts) {
          console.log(
            `Redis connection failed, retrying in ${this.reconnectDelay}ms...`
          );
          setTimeout(
            () => this.connect(),
            this.reconnectDelay * this.reconnectAttempts
          );
        } else {
          console.error('Max reconnection attempts reached');
          throw error;
        }
      }
    };
  }
}
```

## Performance Optimization

### High-Throughput Configuration

```typescript
import {
  EventBus,
  RedisEventStorage,
  StorageMode,
} from '@rhythmiclabs/rhythmic-events';

const eventBus = new EventBus({
  enableCache: true,
  mode: StorageMode.WRITE_THROUGH,
  cacheSize: 50000, // Large cache for high throughput
  cacheTTL: 60000, // Short TTL (1 minute) for freshness
  storage: redisStorage, // Redis for persistence
});

// Batch processing for performance
async function processEventBatch(events: DomainEvent[]) {
  const batchSize = 100;
  for (let i = 0; i < events.length; i += batchSize) {
    const batch = events.slice(i, i + batchSize);
    await eventBus.publishBatch(batch);

    // Add small delay to prevent overwhelming the system
    if (i + batchSize < events.length) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  }
}

// Memory monitoring
setInterval(async () => {
  const stats = eventBus.getCacheStats();
  if (stats && stats.size > stats.hits * 0.8) {
    console.warn('Cache hit rate low, consider increasing cache size');
  }
}, 60000); // Check every minute
```

### Connection Pooling and Multiplexing

```typescript
import { RedisEventStorage } from '@rhythmiclabs/rhythmic-events';
import { createCluster } from 'redis';

// Redis cluster for scaling
const redisCluster = createCluster({
  rootNodes: [
    { url: 'redis://redis-01:6379' },
    { url: 'redis://redis-02:6379' },
    { url: 'redis://redis-03:6379' },
  ],
  useReplicas: true,
  maxRedirections: 16,
});

await redisCluster.connect();

const redisStorage = new RedisEventStorage({
  redis: redisCluster,
  keyPrefix: 'cluster:events:',
  eventTTL: 86400,
  enableIndexes: true,
});
```

## Testing

### Unit Testing Event Handlers

```typescript
import { EventBus, DomainEvent } from '@rhythmiclabs/rhythmic-events';

describe('Order Processing', () => {
  let eventBus: EventBus;
  let processedEvents: DomainEvent[] = [];

  beforeEach(() => {
    eventBus = new EventBus({ enableCache: false });
    processedEvents = [];

    eventBus.subscribe('order.processed', (event) => {
      processedEvents.push(event);
    });
  });

  it('should process order successfully', async () => {
    const orderEvent = new DomainEvent('order.placed', 'order-123', {
      items: ['item1', 'item2'],
      total: 100,
    });

    await eventBus.publish(orderEvent);

    // Simulate order processing
    const processedEvent = new DomainEvent('order.processed', 'order-123', {
      status: 'completed',
      processedAt: new Date(),
    });

    await eventBus.publish(processedEvent);

    expect(processedEvents).toHaveLength(1);
    expect(processedEvents[0].type).toBe('order.processed');
  });
});
```

### Integration Testing with Redis

```typescript
import {
  RedisEventStorage,
  EventBus,
  StorageMode,
} from '@rhythmiclabs/rhythmic-events';
import { createClient } from 'redis';

describe('Redis Integration', () => {
  let redis: RedisClient;
  let storage: RedisEventStorage;
  let eventBus: EventBus;

  beforeAll(async () => {
    redis = createClient({ url: 'redis://localhost:6379/15' }); // Test DB
    await redis.connect();

    storage = new RedisEventStorage({ redis });
    eventBus = new EventBus({
      storage,
      mode: StorageMode.STORAGE_ONLY,
    });
  });

  afterAll(async () => {
    await storage.clear();
    await redis.disconnect();
  });

  it('should persist and retrieve events from Redis', async () => {
    const event = new DomainEvent('test.event', 'test-123', { data: 'test' });

    await eventBus.publish(event);

    const retrievedEvent = await storage.load(event.id);

    expect(retrievedEvent).not.toBeNull();
    expect(retrievedEvent?.id).toBe(event.id);
    expect(retrievedEvent?.type).toBe('test.event');
  });
});
```

## Migration Guide

### From EventEmitter3

```typescript
// Before (EventEmitter3)
import EventEmitter from 'eventemitter3';

const emitter = new EventEmitter();
emitter.on('data', (data) => console.log(data));
emitter.emit('data', { message: 'hello' });

// After (@rhythmiclabs/rhythmic-events)
import { createTypedEventEmitter } from '@rhythmiclabs/rhythmic-events';

interface Events {
  data: { message: string };
}

const emitter = createTypedEventEmitter<Events>();
emitter.on('data', (data) => console.log(data.message));
emitter.emit('data', { message: 'hello' });
```

### From Other Event Libraries

```typescript
// Generic migration pattern
import { EventBus, DomainEvent } from '@rhythmiclabs/rhythmic-events';

class MigratedEventBus {
  private eventBus: EventBus;

  constructor() {
    this.eventBus = new EventBus({
      enableCache: true,
      cacheSize: 1000,
    });
  }

  // Adapter method for existing code
  emit(eventName: string, data: any) {
    const event = new DomainEvent(eventName, undefined, data);
    return this.eventBus.publish(event);
  }

  on(eventName: string, handler: Function) {
    return this.eventBus.subscribe(eventName, handler);
  }

  once(eventName: string, handler: Function) {
    return this.eventBus.subscribeOnce(eventName, handler);
  }
}
```

## Development

### Building

```bash
npm run build
```

### Testing

```bash
# Unit tests
npm test

# Coverage report
npm run test:coverage

# CI testing
npm run test:ci
```

### Code Quality

```bash
# Type checking
npm run type-check

# Linting
npm run lint
npm run lint:fix

# Formatting
npm run format
npm run format:check

# Run all checks
npm run check-all
```

## Architecture

```
┌─────────────────────────────────────────────────────────────────────────────────────┐
│                           @rhythmiclabs/rhythmic-events                            │
├─────────────────────────────────────────────────────────────────────────────────────┤
│  ┌─────────────────────────────────┐  ┌─────────────────────────────────────┐  │
│  │      TypedEventEmitter          │  │       EventRegistry                │  │
│  │   + Type-safe events            │  │   + Event registration           │  │
│  │   + Generic support            │  │   + Deserialization             │  │
│  │   + Performance optimized      │  │   + Singleton pattern           │  │
│  └─────────────────────────────────┘  └─────────────────────────────────────┘  │
├─────────────────────────────────────────────────────────────────────────────────────┤
│  ┌─────────────────────────────────┐  ┌─────────────────────────────────────┐  │
│  │      DomainEvent               │  │      PubSubProvider               │  │
│  │   + DDD patterns               │  │   + Pluggable architecture       │  │
│  │   + Metadata support           │  │   + Local & remote options      │  │
│  │   + JSON serialization         │  │   + Async messaging             │  │
│  └─────────────────────────────────┘  └─────────────────────────────────────┘  │
├─────────────────────────────────────────────────────────────────────────────────────┤
│  ┌─────────────────────────────────┐  ┌─────────────────────────────────────┐  │
│  │        EventBus               │  │      SuspensionManager             │  │
│  │   + Pub/Sub messaging          │  │   + Request-response pattern     │  │
│  │   + Subscription management    │  │   + Timeout handling            │  │
│  │   + Async support            │  │   + Correlation management      │  │
│  └─────────────────────────────────┘  └─────────────────────────────────────┘  │
├─────────────────────────────────────────────────────────────────────────────────────┤
│  ┌─────────────────────────────────┐  ┌─────────────────────────────────────┐  │
│  │       EventCache              │  │      ReminderManager              │  │
│  │   + TTL management            │  │   + Automated workflows         │  │
│  │   + Size limits              │  │   + Response handling           │  │
│  │   + Redis persistence        │  │   + Timeout management         │  │
│  └─────────────────────────────────┘  └─────────────────────────────────────┘  │
├─────────────────────────────────────────────────────────────────────────────────────┤
│  ┌─────────────────────────────────┐  ┌─────────────────────────────────────┐  │
│  │    InMemoryGraphStore         │  │      Vector Search               │  │
│  │   + Graph/Microservice CRUD   │  │   + Cosine similarity           │  │
│  │   + Secondary indexes        │  │   + TopK search                 │  │
│  │   + LRU eviction             │  │   + RAG embedding support       │  │
│  └─────────────────────────────────┘  └─────────────────────────────────────┘  │
├─────────────────────────────────────────────────────────────────────────────────────┤
│  ┌─────────────────────────────────┐  ┌─────────────────────────────────────┐  │
│  │    ScheduledEventManager      │  │      ScheduledEvent              │  │
│  │   + Cron expression support   │  │   + scheduler.tick event type   │  │
│  │   + pause/resume/maxTicks     │  │   + EventRegistry registered    │  │
│  │   + tickFactory override      │  │   + Generic TPayload support    │  │
│  └─────────────────────────────────┘  └─────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────────────────────┘
```

## Contributing

1. Fork the repository
2. Create a feature branch: `git checkout -b feature/amazing-feature`
3. Make your changes with comprehensive tests
4. Ensure all tests pass: `npm test`
5. Run type checking: `npm run type-check`
6. Run linting: `npm run lint`
7. Submit a pull request with detailed description

### Development Guidelines

- **Type Safety**: All new code must have proper TypeScript types
- **Tests**: Maintain 95%+ test coverage
- **Documentation**: Update README and API docs for new features
- **Performance**: Consider performance implications for high-throughput scenarios
- **Backwards Compatibility**: Avoid breaking changes in minor versions

## License

Apache-2.0 License - see LICENSE file for details.

## Changelog

### v1.0.1

- ✨ `ScheduledEventManager`: cron-based event scheduling via `croner`
- ✨ `ScheduledEvent<TPayload>`: built-in `scheduler.tick` domain event, registered in `EventRegistry`
- ✨ `ScheduleDescriptor`: declarative schedule config (`cronExpression`, `payload`, `tickFactory`, `maxTicks`, `timezone`, `startImmediately`)
- ✨ `croner` added as optional peer dependency

### v1.0.0

- 🎉 Initial release
- ✨ Typed Event Emitter with TypeScript support
- ✨ Domain Events with DDD patterns
- ✨ Event Registry with deserialization
- ✨ EventBus with Pub/Sub messaging
- ✨ EventCache with TTL and size management
- ✨ RedisEventStorage with indexing and persistence
- ✨ SuspensionManager for request-response patterns
- ✨ ReminderManager for automated workflows
- ✨ SystemReminderEvent and SystemReminderResponseEvent
- ✨ PubSubProvider abstraction
- ✨ LocalPubSubProvider implementation
- ✨ InMemoryGraphStore with graph/microservice CRUD and LRU eviction
- ✨ GraphStorage interface for pluggable graph backends
- ✨ Vector similarity search (cosine similarity + topK)
