import type { DomainEvent, DomainEventJSON } from './index';

export type EventDeserializer<T extends DomainEvent = DomainEvent> = (
  json: DomainEventJSON
) => T;

export class EventRegistry {
  private static instance: EventRegistry;
  private deserializers: Map<string, EventDeserializer> = new Map();

  static getInstance(): EventRegistry {
    if (!EventRegistry.instance) {
      EventRegistry.instance = new EventRegistry();
    }
    return EventRegistry.instance;
  }

  static resetInstance(): void {
    EventRegistry.instance = undefined as any;
  }

  register<T extends DomainEvent>(
    eventType: string,
    deserializer: EventDeserializer<T>
  ): void {
    this.deserializers.set(eventType, deserializer as EventDeserializer);
  }

  deserialize(json: DomainEventJSON): DomainEvent {
    const deserializer = this.deserializers.get(json.type);
    if (!deserializer) {
      throw new Error(
        `No deserializer registered for event type "${json.type}". ` +
          `Register one via EventRegistry.getInstance().register("${json.type}", deserializerFn)`
      );
    }
    return deserializer(json);
  }

  has(eventType: string): boolean {
    return this.deserializers.has(eventType);
  }

  clear(): void {
    this.deserializers.clear();
  }
}
