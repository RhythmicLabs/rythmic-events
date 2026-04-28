# CLAUDE.md — @rhythmiclabs/rhythmic-events

## Project

**Package:** `@rhythmiclabs/rhythmic-events`
**License:** Apache-2.0
**Type:** ESM-only TypeScript library (`"type": "module"`)
**Runtime:** Node.js / Bun
**Entry point:** `dist/index.js` (compiled from `src/index.ts`)

A layered pub/sub event library for event-driven TypeScript applications. Provides typed event emitters, DDD domain events, pub/sub with pluggable providers, caching, request/response suspension, reminder workflows, cron scheduling, and an in-memory graph store with vector search.

---

## Commands

```bash
bun run build          # tsc — compiles src/ → dist/
bun run type-check     # tsc --noEmit (no emit, just type errors)
bun run test           # Jest with ESM flag
bun run test:coverage  # Jest with coverage report
bun run lint           # ESLint on src/ (excludes __tests__)
bun run lint:fix       # ESLint autofix
bun run format         # Prettier write
bun run format:check   # Prettier check (used in CI)
bun run check-all      # type-check + lint + format:check + test:ci
```

Tests must be run with `NODE_OPTIONS=--experimental-vm-modules` (already set in the npm scripts via Jest config). Run tests directly with:

```bash
NODE_OPTIONS=--experimental-vm-modules npx jest [pattern] --no-coverage
```

---

## Architecture (bottom → top)

| Layer | Module | Purpose |
|---|---|---|
| Primitive | `src/event-emitter/` | `TypedEventEmitter<T>` wrapping `eventemitter3`; async-safe, errors swallowed |
| Domain | `src/domain-events/` | `DomainEvent<T>` abstract base, `DomainEventDispatcher`, `EventRegistry` singleton |
| Transport | `src/pubsub/` | `EventBus` orchestrator; `PubSubProvider` interface; `LocalPubSubProvider`, `RedisProvider` |
| Storage | `src/cache/` | `EventCache` (LRU + TTL); `EventStorage` interface; `RedisEventStorage` |
| Async patterns | `src/suspension/` | `SuspensionManager` — pub/sub → request/response with timeout |
| Workflows | `src/reminder/` | `ReminderManager` — composes `EventBus` + `SuspensionManager` for prompt/response |
| Scheduling | `src/scheduler/` | `ScheduledEventManager` — cron-driven event publishing via `croner` |
| Graph store | `src/graph-store/` | `InMemoryGraphStore<TGraph, TMS>` — LRU + secondary indexes + cosine vector search |

---

## Module Map

```
src/
  index.ts                        ← all public exports
  event-emitter/index.ts          ← TypedEventEmitter, createTypedEventEmitter
  domain-events/
    index.ts                      ← DomainEvent, DomainEventDispatcher
    event-registry.ts             ← EventRegistry singleton
    system-reminder-event.ts      ← SystemReminderEvent (registers itself)
    system-reminder-response-event.ts
  pubsub/
    index.ts                      ← EventBus
    provider.ts                   ← PubSubProvider interface
    local-provider.ts             ← LocalPubSubProvider (in-process)
    redis-provider.ts             ← RedisProvider (optional dep: redis)
  cache/
    index.ts                      ← EventCache, StorageMode enum
    storage.ts                    ← EventStorage interface
    redis-storage.ts              ← RedisEventStorage (optional dep: redis)
  suspension/
    index.ts                      ← SuspensionManager
    suspension-types.ts           ← SuspensionOptions, SuspensionResult, etc.
  reminder/
    index.ts                      ← barrel
    reminder-manager.ts           ← ReminderManager
  scheduler/
    index.ts                      ← barrel
    scheduler-types.ts            ← ScheduleDescriptor, ScheduleEntry, ScheduledTick
    scheduled-event.ts            ← ScheduledEvent<TPayload> (registers itself)
    scheduled-event-manager.ts    ← ScheduledEventManager
  graph-store/
    index.ts                      ← InMemoryGraphStore, cosineSimilarity, searchTopK
    graph-storage.ts              ← GraphStorage interface
    vector-search.ts              ← cosineSimilarity, searchTopK utilities
```

---

## Key Conventions

### Defining a new DomainEvent

```typescript
// 1. Extend DomainEvent<TData>
export class MyEvent extends DomainEvent<MyEventData> {
  static readonly EVENT_TYPE = 'my.event' as const;

  constructor(data: MyEventData) {
    super(MyEvent.EVENT_TYPE, randomUUID(), data, data.aggregateId);
  }

  // 2. Expose convenience getters
  get myField() { return this.data.myField; }

  // 3. Implement fromJSON for deserialization
  static fromJSON(json: DomainEventJSON): MyEvent {
    return new MyEvent(json.data as MyEventData);
  }
}

// 4. Register at module load time (side effect)
EventRegistry.getInstance().register(MyEvent.EVENT_TYPE, MyEvent.fromJSON);
```

### Error swallowing

All event dispatch errors are caught and silently dropped — same pattern used in `DomainEventDispatcher.dispatch()` and `ScheduledEventManager` tick handlers. Do not let handler errors propagate to callers.

### Test isolation for EventRegistry

After tests that import domain event modules, the module-level `register()` side effect only runs once (ES module caching). Reset and re-register manually:

```typescript
beforeEach(() => {
  EventRegistry.resetInstance();
  EventRegistry.getInstance().register(MyEvent.EVENT_TYPE, MyEvent.fromJSON);
});
afterEach(() => EventRegistry.resetInstance());
```

### ESM module mocking in tests

Use `jest.unstable_mockModule()` before any dynamic imports of the module under test:

```typescript
jest.unstable_mockModule('croner', () => ({ Cron: jest.fn(...) }));
const { ScheduledEventManager } = await import('../scheduler/scheduled-event-manager');
```

---

## Optional Dependencies

| Dep | Used by | Install |
|---|---|---|
| `redis` | `RedisProvider`, `RedisEventStorage` | `npm install redis` |
| `croner` | `ScheduledEventManager` | `npm install croner` |

Both are declared as optional peer deps in `package.json`. Their consuming classes use lazy dynamic imports and throw a readable error if the dep is missing at runtime.

---

## Testing

- **Framework:** Jest 29 + ts-jest, ESM mode
- **Test root:** `src/__tests__/` and `src/graph-store/__tests__/`
- **Unit tests:** `src/__tests__/unit/<module>/`
- **Test helpers:** `src/__tests__/utils/setup-helpers.ts` — `TestSetup` class with factory methods for `EventBus`, `SuspensionManager`, `ReminderManager`, `ScheduledEventManager`
- **Fixtures:** `src/__tests__/fixtures/`

Run a single test file:
```bash
NODE_OPTIONS=--experimental-vm-modules npx jest src/__tests__/unit/scheduler --no-coverage
```

---

## Known Issues

**TS6059 error on `type-check`:** The `events/` subdirectory contains a mirror copy of the package and its `src/index.ts` falls outside the `rootDir`. This is a pre-existing issue unrelated to library source code — ignore it. All type errors in `src/` are genuine.
