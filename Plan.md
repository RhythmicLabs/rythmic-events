# Implementation Plan: @rhythmiclabs/rhythmic-events

## Context

The `src/` directory is empty -- all code exists only as pre-compiled JavaScript in `dist/` serving as a reference spec. That reference has several bugs: malformed class bodies in pubsub, variable shadowing in `sendReminder`, broken `DomainEvent.fromJSON()` on abstract class, `RedisEventStorage.load()` that throws unconditionally, and missing method signatures in `.d.ts` files. We need to write all TypeScript source from scratch, fixing these issues and implementing the framework properly.

---

## File Structure

```
src/
  index.ts                                    # Barrel re-exports
  event-emitter/
    index.ts                                  # TypedEventEmitter, createTypedEventEmitter
  domain-events/
    index.ts                                  # DomainEvent, DomainEventDispatcher, types
    event-registry.ts                         # EventRegistry (solves deserialization)
    system-reminder-event.ts                  # SystemReminderEvent
    system-reminder-response-event.ts         # SystemReminderResponseEvent
  cache/
    index.ts                                  # EventCache, StorageMode, CacheOptions
    storage.ts                                # EventStorage interface, QueryCriteria
    redis-storage.ts                          # RedisEventStorage
  pubsub/
    index.ts                                  # EventBus (composition, not inheritance)
    provider.ts                               # PubSubProvider interface
    local-provider.ts                         # LocalPubSubProvider (default, wraps eventemitter3)
  suspension/
    index.ts                                  # SuspensionManager
    suspension-types.ts                       # SuspensionRequest, SuspensionResult, etc.
  reminder/
    index.ts                                  # Re-exports
    reminder-manager.ts                       # ReminderManager (wraps SuspensionManager)
  __tests__/
    event-emitter.test.ts
    domain-events.test.ts
    event-registry.test.ts
    event-cache.test.ts
    event-bus.test.ts
    local-provider.test.ts
    suspension.test.ts
    reminder-manager.test.ts
    redis-storage.test.ts                     # Conditional on Redis availability
    integration.test.ts
```

---

## Implementation Phases

### Phase 1: Event Emitter (`src/event-emitter/index.ts`)

Zero dependencies. Foundational primitive.

- `TypedEventMap` interface: `{ [key: string]: unknown }`
- `TypedEventEmitter<T extends TypedEventMap>` class wrapping `eventemitter3`
  - `protected` emitter field (not private, for extensibility)
  - Methods: `on`, `once`, `off`, `emit`, `removeAllListeners`, `listenerCount`, `eventNames`
  - All methods are generic over `K extends string & keyof T`
- `createTypedEventEmitter<T>()` factory function
- Tests: listener lifecycle, emit returns, removeAll, listenerCount, eventNames

### Phase 2: Domain Events (`src/domain-events/index.ts`)

Depends on: `node:crypto`

- `DomainEventJSON` interface
- `DomainEvent` abstract class
  - Properties: `id` (UUID), `type`, `occurredOn` (Date), `aggregateId?`, `version` (default 1), `metadata?`
  - `toJSON()` method -- no static `fromJSON` on abstract class (moved to EventRegistry)
- `DomainEventHandler<T>` type alias
- `DomainEventDispatcher` class
  - `register`, `unregister`, `dispatch` (Promise.all), `dispatchMultiple`, `clear`, `hasHandlers`, `getHandlerCount`
- Tests: construction, UUID generation, toJSON round-trip, dispatcher register/dispatch/clear

### Phase 3: Event Registry (`src/domain-events/event-registry.ts`) -- NEW

Solves the deserialization problem that made `RedisEventStorage.load()` broken.

- `EventDeserializer<T>` type: `(json: DomainEventJSON) => T`
- `EventRegistry` class (singleton + injectable)
  - `register(eventType, deserializer)` -- register a concrete class deserializer
  - `deserialize(json)` -- look up type, call deserializer, throw if unregistered
  - `has(eventType)`, `clear()`
  - Static `getInstance()` for singleton access
- Tests: register/deserialize, unknown type throws, has/clear, singleton behavior

### Phase 4: Reminder Events (separate files)

- `src/domain-events/system-reminder-event.ts`: `SystemReminderEvent extends DomainEvent`
  - Type: `'system.reminder'`, aggregateId = reminderId
  - Properties: reminderId, prompt, context?, source, priority, timeout, expectedResponseType?, userId?, sessionId?
  - Override `toJSON()` to serialize reminder-specific props into metadata
- `src/domain-events/system-reminder-response-event.ts`: `SystemReminderResponseEvent extends DomainEvent`
  - Type: `'system.reminder.response'`
  - Properties: reminderId, response, status, processingTime?, error?, partialData?, confidence?
- Register both with `EventRegistry` in their respective files
- Tests: construction with defaults, toJSON serialization, fromJSON via registry

### Phase 5: Cache Storage Interface (`src/cache/storage.ts`)

Interfaces only (no runtime code).

- `EventStorage` interface: save, load, delete, query, connect, disconnect, isConnected, healthCheck
- `QueryCriteria` interface: eventType?, limit?, before?, after?, aggregateId?
- `StorageOptions` interface: autoConnect?, retry?

### Phase 6: Event Cache (`src/cache/index.ts`)

Depends on: domain-events, storage interface

- `StorageMode` enum: `MEMORY`, `STORAGE_ONLY`, `WRITE_THROUGH`
- `CacheOptions` interface: maxSize, ttl, mode?, storage?, fallbackToCache?
- `CachedEvent` interface: { event, timestamp }
- `EventCache` class
  - Memory: `Map<string, CachedEvent>` with LRU eviction + TTL lazy cleanup
  - Write-through: memory-first reads, storage persist on writes, fallback behavior
  - Storage-only: direct pass-through to storage
  - Methods: add, get, getEvents, remove, clear, getStats
  - Constructor throws if non-memory mode without storage
- Tests: LRU eviction, TTL expiry, write-through with mock storage, fallback on/off, storage-only delegation

### Phase 7: Redis Storage (`src/cache/redis-storage.ts`)

Depends on: domain-events, storage interface, event-registry, `redis` (peer dep)

- `RedisStorageOptions` interface: redis, keyPrefix?, eventTTL?, enableIndexes?
- `RedisEventStorage implements EventStorage`
  - Redis hashes for event data, sets for secondary indexes (type, aggregate, date)
  - `save()`: pipeline with hSet + index sAdd + TTL
  - `load()`: uses `EventRegistry.getInstance().deserialize()` (fixes the reference bug)
  - Accepts optional `registry` constructor param for DI
  - `query()`: index-based lookup with batch loading
  - `clear()`: pattern-based key deletion
  - `getStats()`: totalEvents, typeCounts, connected
- Tests: conditional on Redis availability, mock-based for unit tests

### Phase 8: PubSub Provider Abstraction -- NEW

- `src/pubsub/provider.ts`: `PubSubProvider` interface
  - `publish(eventType, event)`: Promise<void>
  - `subscribe(eventType, handler)`: returns `() => void` (unsubscribe fn)
  - `subscribeOnce(eventType, handler)`: returns `() => void`
  - Optional: `connect()`, `disconnect()`
- `src/pubsub/local-provider.ts`: `LocalPubSubProvider implements PubSubProvider`
  - Wraps a `TypedEventEmitter` internally
  - Default provider when no external transport configured
- Tests: publish/subscribe flow, subscribeOnce fires once, unsubscribe works

### Phase 9: EventBus (`src/pubsub/index.ts`)

Depends on: provider, cache, domain-events. **Uses composition, not inheritance.**

- `PubSubOptions` interface: enableCache?, cacheSize?, cacheTTL?, storageMode?, storage?, cacheFallbackToStorage?, **provider?**
- `Subscription` interface: id, event, handler, once?
- `EventBus` class
  - Composes `PubSubProvider` (defaults to `LocalPubSubProvider`)
  - Composes optional `EventCache`
  - Subscription tracking: `Map<id, Subscription>`, `Map<event, Set<id>>`, `Map<id, unsubscribeFn>`
  - `publish(event)`: cache if enabled, then provider.publish
  - `publishBatch(events)`: cache all, then publish each
  - `subscribe(event, handler, options?)`: returns subscriptionId
  - `unsubscribe(id)`, `unsubscribeByEvent(event)`, `unsubscribeAll()`
  - `getSubscriptions(event?)`, `getSubscriptionCount(event?)`
  - `getEventHistory(event?, limit?, before?)`, `clearCache()`, `getCacheStats()`
- Tests: publish/subscribe lifecycle, batch operations, cache integration, custom provider

### Phase 10: Event Suspension -- NEW

- `src/suspension/suspension-types.ts`: interfaces
  - `SuspensionRequest<TReq, TResp>`: correlationId, requestEvent, responseEventType, correlationExtractor, timeout
  - `SuspensionOptions`: timeout?, correlationExtractor?
  - `SuspensionResult<TResp>`: response, waitTime
  - `SuspensionStatus`: 'pending' | 'resolved' | 'timeout' | 'cancelled'
- `src/suspension/index.ts`: `SuspensionManager`
  - `suspendForResponse(requestEvent, responseEventType, correlationId, options)` -> Promise<SuspensionResult>
    - Sets up response listener BEFORE publishing (prevents race condition)
    - Timeout rejects the promise and cleans up
    - Correlation matching via user-provided extractor (default: `event.aggregateId`)
  - `resolve(correlationId, responseEvent)`: manual resolution
  - `cancel(correlationId)`: cancellation
  - `cancelAll()`, `getPendingCount()`, `isPending(correlationId)`
- Tests: resolve on response, timeout rejection, cancel, manual resolve, custom extractor

### Phase 11: Reminder Manager (`src/reminder/`)

Thin wrapper over SuspensionManager for the SystemReminder use case.

- `ReminderManager` class
  - Composes `SuspensionManager` + `EventBus`
  - `sendPrompt(prompt, context?, options?)`: creates SystemReminderEvent, uses suspendForResponse with correlationId=reminderId
  - `onReminder(handler, options?)`: subscribe to 'system.reminder', auto-respond
  - `completeReminder(reminderId, response)`: publish SystemReminderResponseEvent
  - `cleanup()`: unsubscribe all + cancelAll suspensions
- Tests: send/receive cycle, timeout handling, filter in onReminder, cleanup

### Phase 12: Barrel Export (`src/index.ts`)

Re-exports all public types and classes using `export` for values and `export type` for types (required by `verbatimModuleSyntax`).

### Phase 13: Package.json Update

- Move `redis` from `dependencies` to `peerDependencies` with `peerDependenciesMeta` marking it optional

---

## Key Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| EventBus inheritance vs composition | **Composition with PubSubProvider** | Avoids dual API (on/off/emit vs subscribe/publish), enables pluggable backends |
| Event suspension scope | **Generic SuspensionManager** | Works with any event pair, ReminderManager is a thin wrapper |
| DomainEvent.fromJSON | **Removed; replaced by EventRegistry** | Abstract class can't be instantiated; registry solves RedisEventStorage.load() |
| Redis dependency | **peerDependency** | Users who only need in-memory don't install redis |
| File organization | **Separate files for reminder events** | Prevents the code interleaving bugs from the reference |

---

## Verification Plan

1. **Type checking**: `npm run type-check` passes with zero errors
2. **Unit tests**: `npm test` -- all tests pass
3. **Build**: `npm run build` produces `dist/` matching the module structure
4. **Lint + format**: `npm run check-all` passes
5. **Manual smoke test**: Create a simple script that:
   - Creates an EventBus with in-memory cache
   - Publishes a domain event, retrieves from history
   - Uses SuspensionManager: publish request, respond from another subscriber, verify resolution
   - Uses ReminderManager: sendPrompt + onReminder round-trip
6. **Coverage**: `npm run test:coverage` -- target 95%+
