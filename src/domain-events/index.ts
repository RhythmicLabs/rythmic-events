export interface DomainEventJSON<T = unknown> {
  id: string;
  type: string;
  occurredOn: string;
  data: T;
  aggregateId?: string;
  version: number;
  metadata?: Record<string, unknown>;
}

export abstract class DomainEvent<T = unknown> {
  readonly id: string;
  readonly occurredOn: Date;
  readonly type: string;
  readonly aggregateId?: string;
  readonly version: number = 1;
  readonly metadata?: Record<string, unknown>;
  readonly data: T;

  constructor(
    type: string,
    id: string,
    data: T,
    aggregateId?: string,
    metadata?: Record<string, unknown>
  ) {
    this.id = id;
    this.type = type;
    this.data = data;
    this.occurredOn = new Date();
    if (aggregateId !== undefined) {
      this.aggregateId = aggregateId;
    }
    if (metadata !== undefined) {
      this.metadata = metadata;
    }
  }

  toJSON(): DomainEventJSON<T> {
    const result: DomainEventJSON<T> = {
      id: this.id,
      type: this.type,
      occurredOn: this.occurredOn.toISOString(),
      version: this.version,
      data: this.data,
    };
    if (this.aggregateId !== undefined) {
      result.aggregateId = this.aggregateId;
    }
    if (this.metadata !== undefined) {
      result.metadata = this.metadata;
    }
    return result;
  }
}

export type DomainEventHandler<T extends DomainEvent = DomainEvent> = (
  event: T
) => Promise<void>;

export class DomainEventDispatcher {
  private handlers: Map<string, DomainEventHandler[]> = new Map();

  register<T extends DomainEvent>(
    eventType: string,
    handler: DomainEventHandler<T>
  ): void {
    if (!this.handlers.has(eventType)) {
      this.handlers.set(eventType, []);
    }
    this.handlers.get(eventType)!.push(handler as DomainEventHandler);
  }

  unregister<T extends DomainEvent>(
    eventType: string,
    handler: DomainEventHandler<T>
  ): void {
    const handlers = this.handlers.get(eventType);
    if (handlers) {
      const index = handlers.indexOf(handler as DomainEventHandler);
      if (index > -1) {
        handlers.splice(index, 1);
      }
      if (handlers.length === 0) {
        this.handlers.delete(eventType);
      }
    }
  }

  async dispatch(event: DomainEvent): Promise<void> {
    const handlers = this.handlers.get(event.type);
    if (handlers) {
      await Promise.all(
        handlers.map(async (handler) => {
          try {
            await handler(event);
          } catch {
            // Swallow handler errors to prevent crashes
          }
        })
      );
    }
  }

  async dispatchMultiple(events: DomainEvent[]): Promise<void> {
    await Promise.all(events.map((event) => this.dispatch(event)));
  }

  clear(): void {
    this.handlers.clear();
  }

  hasHandlers(eventType: string): boolean {
    const handlers = this.handlers.get(eventType);
    return handlers ? handlers.length > 0 : false;
  }

  getHandlerCount(eventType: string): number {
    const handlers = this.handlers.get(eventType);
    return handlers ? handlers.length : 0;
  }
}
