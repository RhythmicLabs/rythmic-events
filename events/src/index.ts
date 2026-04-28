// Event Emitter
export {
  TypedEventEmitter,
  createTypedEventEmitter,
  type TypedEventMap,
  type EventListener,
} from './event-emitter/index';

// Domain Events
export {
  DomainEvent,
  DomainEventDispatcher,
  type DomainEventJSON,
  type DomainEventHandler,
} from './domain-events/index';

export {
  EventRegistry,
  type EventDeserializer,
} from './domain-events/event-registry';

export {
  SystemReminderEvent,
  type SystemReminderEventData,
  type SystemReminderEventJSON,
} from './domain-events/system-reminder-event';

export {
  SystemReminderResponseEvent,
  type SystemReminderResponseEventData,
  type SystemReminderResponseEventJSON,
} from './domain-events/system-reminder-response-event';

// Cache
export {
  EventCache,
  StorageMode,
  type CacheOptions,
  type CachedEvent,
  type CacheStats,
} from './cache/index';

export {
  type EventStorage,
  type QueryCriteria,
  type StorageOptions,
} from './cache/storage';

export {
  RedisEventStorage,
  type RedisStorageOptions,
  type RedisStorageStats,
} from './cache/redis-storage';

// PubSub
export {
  EventBus,
  type PubSubOptions,
  type Subscription,
} from './pubsub/index';

export { type PubSubProvider } from './pubsub/provider';

export { LocalPubSubProvider } from './pubsub/local-provider';

// Suspension
export { SuspensionManager } from './suspension/index';

export type {
  SuspensionRequest,
  SuspensionOptions,
  SuspensionResult,
  SuspensionStatus,
  PendingSuspension,
} from './suspension/suspension-types';

// Reminder
export {
  ReminderManager,
  type ReminderOptions,
  type ReminderHandlerOptions,
} from './reminder/index';

// Graph Store
export {
  InMemoryGraphStore,
  type InMemoryGraphStoreOptions,
  type GraphStorage,
  type GraphStoreStats,
  cosineSimilarity,
  searchTopK,
  type SimilarityResult,
} from './graph-store/index';
