# Events Package — Code Paths

A TypeScript pub/sub library (`@rhythmiclabs/rhythmic-events`) that layers several abstractions on top of each other: a type-safe event emitter → domain events → a pub/sub bus with pluggable providers and optional persistent caching → higher-level async patterns (suspension, reminders) → a generic in-memory graph store with vector search.

---

## 1. Package Overview & Dependency Map

```mermaid
flowchart TD
    subgraph "Higher-level patterns"
        REMINDER["ReminderManager\nreminder/"]
        SUSPENSION["SuspensionManager\nsuspension/"]
    end

    subgraph "Pub/Sub layer"
        BUS["EventBus\npubsub/index.ts"]
        PROVIDER["PubSubProvider (interface)\npubsub/provider.ts"]
        LOCAL["LocalPubSubProvider\npubsub/local-provider.ts"]
        REDIS_PS["RedisProvider\npubsub/redis-provider.ts"]
    end

    subgraph "Cache & Storage layer"
        CACHE["EventCache\ncache/index.ts"]
        STORAGE["EventStorage (interface)\ncache/storage.ts"]
        REDIS_ST["RedisEventStorage\ncache/redis-storage.ts"]
    end

    subgraph "Domain Events layer"
        DE["DomainEvent<T> (abstract)\ndomain-events/index.ts"]
        DISPATCHER["DomainEventDispatcher\ndomain-events/index.ts"]
        REGISTRY["EventRegistry (singleton)\ndomain-events/event-registry.ts"]
        REMINDER_EV["SystemReminderEvent\nSystemReminderResponseEvent"]
    end

    subgraph "Primitives"
        EMITTER["TypedEventEmitter<T>\nevent-emitter/index.ts"]
        GRAPH["InMemoryGraphStore<TG, TM>\ngraph-store/index.ts"]
        VECTOR["cosineSimilarity + searchTopK\ngraph-store/vector-search.ts"]
    end

    REMINDER --> BUS
    REMINDER --> SUSPENSION
    SUSPENSION --> PROVIDER

    BUS --> PROVIDER
    BUS --> CACHE
    PROVIDER --> LOCAL & REDIS_PS
    LOCAL --> EMITTER

    CACHE --> STORAGE
    STORAGE --> REDIS_ST

    DISPATCHER --> DE
    REGISTRY --> DE
    REMINDER_EV --> DE
    REMINDER_EV --> REGISTRY

    GRAPH --> VECTOR
```

---

## 2. EventBus — Pub/Sub Orchestrator

`EventBus` is the main integration point. It combines a `PubSubProvider` (transport) with an optional `EventCache` (history).

```mermaid
flowchart TD
    CTOR["new EventBus(options)\n• provider (default: LocalPubSubProvider)\n• enableCache, cacheSize, cacheTTL\n• storageMode, storage\n• cacheFallbackToStorage"]

    CTOR --> BUS_STATE["Internal state\nsubscriptions: Map<id, Subscription>\neventSubscriptions: Map<eventType, Set<id>>\nunsubscribeFunctions: Map<id, () => void>"]

    PUBLISH["bus.publish(event)"] --> CACHE_ADD["cache.add(event)\n(if cache enabled)"]
    CACHE_ADD --> PROV_PUB["provider.publish(event.type, event)"]

    SUBSCRIBE["bus.subscribe(eventType, handler, opts)"] --> GEN_ID["generate subscriptionId"]
    GEN_ID --> PROV_SUB["provider.subscribe(eventType, wrappedHandler)"]
    PROV_SUB --> STORE_SUB["store Subscription\nstore unsubscribe fn"]
    STORE_SUB --> RETURN_ID["return subscriptionId"]

    UNSUB["bus.unsubscribe(subscriptionId)"] --> CALL_UNSUB["call provider's unsubscribe fn"]
    CALL_UNSUB --> REMOVE["remove from subscriptions\n+ eventSubscriptions maps"]

    HISTORY["bus.getEventHistory(eventType?, limit?, before?)"] --> CACHE_QUERY["cache.getEvents(criteria)\n(if cache enabled)"]
    CACHE_QUERY --> RETURN_EVTS["return DomainEvent[]"]
```

---

## 3. PubSubProvider — Transport Implementations

```mermaid
flowchart LR
    subgraph "PubSubProvider interface"
        I_PUB["publish(eventType, event): Promise&lt;void&gt;"]
        I_SUB["subscribe(eventType, handler): () => void"]
        I_ONCE["subscribeOnce(eventType, handler): () => void"]
        I_CONN["connect?() / disconnect?() / isConnected?()"]
    end

    subgraph "LocalPubSubProvider\npubsub/local-provider.ts"
        L_EMITTER["TypedEventEmitter&lt;T&gt;\n(in-memory)"]
        L_PUB["publish → emitter.emit(eventType, event)"]
        L_SUB["subscribe → emitter.on(eventType, handler)\nreturns () => emitter.off(...)"]
    end

    subgraph "RedisProvider\npubsub/redis-provider.ts"
        R_CLIENT["Redis client\n(passed in or created from url)"]
        R_CHAN["channel = channelPrefix + eventType"]
        R_PUB["publish → redis.publish(channel, serialize(event))"]
        R_MSG["client.on('message', ...)\n→ deserialize → dispatch to handlers"]
        R_SUB["subscribe → redis.subscribe(channel)\nregister handler in subscriptions Map"]
        R_SUBS["subscriptions: Map&lt;channel, Set&lt;handler&gt;&gt;"]
    end

    I_PUB -.->|"implemented by"| L_PUB & R_PUB
    I_SUB -.->|"implemented by"| L_SUB & R_SUB
    L_PUB --> L_EMITTER
    R_PUB --> R_CLIENT
    R_MSG --> R_SUBS
```

---

## 4. EventCache — Storage Modes & LRU Eviction

```mermaid
flowchart TD
    subgraph "StorageMode"
        MEM["MEMORY\nIn-memory only\nLRU eviction"]
        WT["WRITE_THROUGH\nMemory + async persist\nto EventStorage"]
        SO["STORAGE_ONLY\nBypass memory\nalways use storage backend"]
    end

    ADD["cache.add(event)"] --> MODE{StorageMode?}
    MODE -->|"MEMORY"| MEM_ADD["cache.set(event.id, event)\ncheck maxSize → evictLRU()"]
    MODE -->|"WRITE_THROUGH"| WT_ADD["cache.set(event.id, event)\n+ storage.save(event) async\n(errors ignored)"]
    MODE -->|"STORAGE_ONLY"| ST_ADD["storage.save(event)"]

    GET["cache.get(eventId)"] --> TTL_CHECK["expired? (Date.now - timestamp > ttl)"]
    TTL_CHECK -->|"valid"| UPDATE_LRU["updateAccessOrder(id)\nreturn event"]
    TTL_CHECK -->|"expired / miss"| FALLBACK{"fallbackToCache\n+ storage available?"}
    FALLBACK -->|"yes"| ST_LOAD["storage.load(eventId)"]
    FALLBACK -->|"no"| NULL["return null"]

    subgraph "LRU Eviction"
        LRU_EVICT["evictLRU()\nremove accessOrder[0]\ndelete from cache Map\nstats.evictions++"]
        UPD_ACCESS["updateAccessOrder(id)\nremove id from array\nre-append to end (MRU)"]
    end

    MEM_ADD -->|"size >= maxSize"| LRU_EVICT
    UPDATE_LRU --> UPD_ACCESS
```

---

## 5. EventStorage — RedisEventStorage Schema

```mermaid
flowchart TD
    SAVE["storage.save(event)"] --> PIPELINE["Redis pipeline"]
    PIPELINE --> HASH["HSET events:{eventId} data JSON.stringify(event)"]
    PIPELINE --> TTL_SET["EXPIRE events:{eventId} eventTTL (default 24h)"]
    PIPELINE --> IDX_TYPE["SADD events:type:{eventType} {eventId}"]
    PIPELINE --> IDX_AGG["SADD events:aggregate:{aggregateId} {eventId}\n(if aggregateId present)"]
    PIPELINE --> IDX_DATE["SADD events:date:{YYYY-MM-DD} {eventId}"]
    PIPELINE --> EXEC["pipeline.exec()"]

    LOAD["storage.load(eventId)"] --> HGET["HGET events:{eventId} data"]
    HGET --> DESERIALIZE["EventRegistry.deserialize(JSON.parse(data))"]
    DESERIALIZE --> TYPED_EVENT["typed DomainEvent instance"]

    QUERY["storage.query(criteria)"] --> IDX_LOOKUP["SMEMBERS events:type:{eventType}\nor KEYS events:* (no type filter)"]
    IDX_LOOKUP --> LOAD_ALL["load each event"]
    LOAD_ALL --> FILTER["filter by aggregateId, before, after dates"]
    FILTER --> SORT["sort by occurredOn DESC"]
    SORT --> LIMIT["apply limit"]

    DELETE["storage.delete(eventId)"] --> DEL["DEL events:{eventId}"]
    DEL --> REM_INDEXES["SREM from type / aggregate / date indexes"]
```

---

## 6. DomainEvent Class Hierarchy & Dispatcher

```mermaid
classDiagram
    class DomainEvent~T~ {
        +id: string
        +type: string
        +occurredOn: Date
        +aggregateId?: string
        +version: number
        +metadata?: Record
        +data: T
        +toJSON() DomainEventJSON~T~
    }

    class SystemReminderEvent {
        +type = "system.reminder"
        +reminderId: string
        +prompt: string
        +context?: Record
        +priority?: low|medium|high
        +static fromJSON(json) SystemReminderEvent
    }

    class SystemReminderResponseEvent {
        +type = "system.reminder.response"
        +reminderId: string
        +response: unknown
        +status: success|error|partial
        +processingTime?: number
        +static fromJSON(json) SystemReminderResponseEvent
    }

    class DomainEventDispatcher {
        -handlers: Map~string, Handler[]~
        +register(eventType, handler) void
        +unregister(eventType, handler) void
        +dispatch(event) Promise~void~
        +dispatchMultiple(events) Promise~void~
        +hasHandlers(eventType) boolean
        +getHandlerCount(eventType) number
        +clear() void
    }

    class EventRegistry {
        -instance: EventRegistry
        -deserializers: Map~string, Deserializer~
        +getInstance() EventRegistry
        +register(eventType, deserializer) void
        +deserialize(json) DomainEvent
        +has(eventType) boolean
        +clear() void
    }

    DomainEvent~T~ <|-- SystemReminderEvent
    DomainEvent~T~ <|-- SystemReminderResponseEvent
    DomainEventDispatcher --> DomainEvent : dispatches
    EventRegistry --> DomainEvent : deserializes JSON to
    SystemReminderEvent --> EventRegistry : registers on module load
    SystemReminderResponseEvent --> EventRegistry : registers on module load
```

---

## 7. SuspensionManager — Request/Response Over Events

Turns fire-and-forget pub/sub into an async request/response with a configurable timeout.

```mermaid
sequenceDiagram
    participant Caller
    participant SM as SuspensionManager
    participant Provider as PubSubProvider
    participant Responder

    Caller->>SM: suspendForResponse(requestEvent, responseType,\ncorrelationId, { timeout, correlationExtractor })

    SM->>SM: set timeout (reject if exceeded)
    SM->>Provider: subscribeOnce(responseType, matchHandler)
    SM->>SM: store PendingSuspension{ resolve, reject,\ntimeout, startTime, unsubscribe }

    note over Caller,SM: Caller continues or awaits the Promise

    Responder->>Provider: publish(responseType, responseEvent)
    Provider->>SM: matchHandler(responseEvent)

    SM->>SM: extract correlationId from event\n(default: aggregateId ?? id)

    alt ID matches
        SM->>SM: clearTimeout
        SM->>SM: unsubscribe()
        SM->>SM: delete from pendingSuspensions
        SM->>Caller: resolve({ response: responseEvent,\nwaitTime: now - startTime })
    else ID mismatch
        SM->>SM: ignore (wait for correct event)
    end

    alt Timeout fires
        SM->>SM: unsubscribe()
        SM->>Caller: reject(new Error("Suspension timed out"))
    end
```

---

## 8. ReminderManager — Automated Workflow Reminders

Composes `EventBus` + `SuspensionManager` to implement a prompt/response pattern for LLM workflows.

```mermaid
sequenceDiagram
    participant App
    participant RM as ReminderManager
    participant Bus as EventBus
    participant SM as SuspensionManager
    participant Handler as onReminder handler

    App->>RM: sendPrompt(prompt, context, { timeout, priority, userId })

    RM->>RM: generate reminderId
    RM->>RM: create SystemReminderEvent\n{ reminderId, prompt, context, priority, ... }
    RM->>Bus: publish(SystemReminderEvent)
    RM->>SM: suspendForResponse(\n  SystemReminderEvent,\n  "system.reminder.response",\n  reminderId,\n  { timeout }\n)

    Bus->>Handler: deliver SystemReminderEvent

    alt autoRespond = true
        Handler->>Handler: responseGenerator(event) → responseData
        Handler->>RM: completeReminder(reminderId, responseData, "success")
    else manual
        Handler->>App: surface prompt to user/LLM
        App->>RM: completeReminder(reminderId, responseData)
    end

    RM->>RM: create SystemReminderResponseEvent\n{ reminderId, response, status }
    RM->>Bus: publish(SystemReminderResponseEvent)

    Bus->>SM: deliver SystemReminderResponseEvent
    SM->>SM: correlationId matches reminderId
    SM->>RM: resolve({ response, waitTime })
    RM->>App: return { reminderId, response, waitTime }
```

---

## 9. InMemoryGraphStore — LRU + Secondary Indexes + Vector Search

```mermaid
flowchart TD
    subgraph "InMemoryGraphStore&lt;TGraph, TMicroservice&gt;"
        MAPS["graphs: Map&lt;id, TGraph&gt;\nmicroservices: Map&lt;id, TMicroservice&gt;"]
        LRU_G["graphAccessOrder: string[]\n(LRU tracking)"]
        IDX["Secondary indexes\ngraphsByCompany: Map&lt;companyId, Set&lt;id&gt;&gt;\ngraphsByName: Map&lt;companyId:name, id&gt;\ngraphsByUser: Map&lt;userId, Set&lt;id&gt;&gt;\nmsByCompany: Map&lt;companyId, Set&lt;id&gt;&gt;"]
    end

    CREATE["createGraph(graph)"] --> GEN_UUID["crypto.randomUUID()"]
    GEN_UUID --> CHECK_EVICT["size >= maxGraphs?\n→ evict LRU entry"]
    CHECK_EVICT --> STORE["graphs.set(id, graph)"]
    STORE --> UPDATE_IDX["update all secondary indexes"]
    UPDATE_IDX --> APPEND_LRU["graphAccessOrder.push(id)"]

    GET["getGraph(id, companyId?, userId?)"] --> LOOKUP["graphs.get(id)"]
    LOOKUP -->|"found"| MOVE_MRU["move id to end of accessOrder"]
    MOVE_MRU --> RETURN["return graph"]

    SEARCH["searchSimilarGraphsByEmbedding(\n  embedding[], topK, companyId?)"] --> FILTER_CO["filter graphs by companyId (if set)"]
    FILTER_CO --> GET_EMB["getEmbedding(graph) → graph.contextEmbedding"]
    GET_EMB --> COSINE["cosineSimilarity(query, embedding)\n= dot(a,b) / (||a|| * ||b||)"]
    COSINE --> TOP_K["searchTopK: sort by similarity DESC\ntake top K"]
    TOP_K --> RETURN_GRAPHS["return TGraph[]"]

    UPSERT["upsertGraph(graph, { name?, id? })"] --> FIND["look up by id or companyId:name"]
    FIND -->|"exists"| UPDATE["updateGraph(existing.id, updates)"]
    FIND -->|"not found"| CREATE
```

---

## 10. TypedEventEmitter — Type-Safe Async Wrapper

```mermaid
flowchart LR
    subgraph "TypedEventEmitter&lt;T extends TypedEventMap&gt;"
        EE3["eventemitter3 instance\n(underlying emitter)"]
        WRAPPED["wrappedListeners\nMap&lt;original, Map&lt;event, wrapped&gt;&gt;\n(for safe off())"]
    end

    ON["emitter.on(event, listener)"] --> WRAP["wrap listener:\ntry { await listener(data) }\ncatch { /* swallowed */ }"]
    WRAP --> STORE_WRAP["store in wrappedListeners"]
    STORE_WRAP --> EE3_ON["ee3.on(event, wrapped)"]

    EMIT["emitter.emit(event, data)"] --> EE3_EMIT["ee3.emit(event, data)\n→ calls all wrapped listeners"]

    OFF["emitter.off(event, listener)"] --> FIND_WRAP["look up wrapped version"]
    FIND_WRAP --> EE3_OFF["ee3.removeListener(event, wrapped)"]
    EE3_OFF --> CLEANUP["remove from wrappedListeners map"]

    note1["Key design: errors in async listeners\nare caught silently — emitter never crashes\neven if a listener throws or rejects"]
```

---

## 11. Public API Summary

```mermaid
mindmap
  root((events))
    TypedEventEmitter
      createTypedEventEmitter
      TypedEventMap
      EventListener
    Domain Events
      DomainEvent
      DomainEventDispatcher
      DomainEventJSON
      EventRegistry
      SystemReminderEvent
      SystemReminderResponseEvent
    Pub/Sub
      EventBus
      PubSubProvider
      LocalPubSubProvider
      Subscription
      PubSubOptions
    Cache & Storage
      EventCache
      StorageMode
        MEMORY
        WRITE_THROUGH
        STORAGE_ONLY
      EventStorage
      RedisEventStorage
      CachedEvent
      CacheStats
    Async Patterns
      SuspensionManager
      SuspensionRequest
      SuspensionResult
      SuspensionStatus
      ReminderManager
      ReminderOptions
    Graph Store
      InMemoryGraphStore
      GraphStorage
      GraphStoreStats
      searchTopK
      cosineSimilarity
```

---

## Glossary

| Term | Meaning |
|------|---------|
| **TypedEventMap** | `Record<string, unknown>` — maps event names to payload types for compile-time safety |
| **DomainEvent** | Base class for all events; carries `id`, `type`, `occurredOn`, `aggregateId`, typed `data` |
| **EventRegistry** | Singleton that maps event type strings to deserializer functions; used when loading events from Redis storage |
| **PubSubProvider** | Transport interface — `LocalPubSubProvider` for in-process, `RedisProvider` for distributed |
| **EventCache** | In-memory LRU cache with optional Redis write-through; holds recent `DomainEvent` history |
| **StorageMode** | `MEMORY` (in-process only) / `WRITE_THROUGH` (memory + async persist) / `STORAGE_ONLY` (Redis only) |
| **SuspensionManager** | Converts pub/sub into request/response: publishes a request event and `await`s the matching response |
| **ReminderManager** | Higher-level wrapper; sends `SystemReminderEvent` and uses `SuspensionManager` to await `SystemReminderResponseEvent` |
| **correlationId** | ID threaded through a request/response pair so `SuspensionManager` can match the response to the right awaiter |
| **LRU eviction** | Least-Recently-Used: when the cache/store is full, the entry accessed longest ago is removed first |
| **cosineSimilarity** | `dot(a,b) / (‖a‖·‖b‖)` — measures directional similarity between two embedding vectors; 1 = identical, 0 = orthogonal |
| **searchTopK** | Ranks all items by cosine similarity to a query embedding and returns the K closest |
