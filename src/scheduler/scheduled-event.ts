import { randomUUID } from 'node:crypto';
import { DomainEvent, type DomainEventJSON } from '../domain-events/index';
import { EventRegistry } from '../domain-events/event-registry';

export interface ScheduledEventData<TPayload = unknown> {
  scheduleId: string;
  cronExpression: string;
  tickNumber: number;
  scheduledAt: string;
  payload?: TPayload;
  metadata?: Record<string, unknown>;
}

export class ScheduledEvent<TPayload = unknown> extends DomainEvent<
  ScheduledEventData<TPayload>
> {
  static readonly EVENT_TYPE = 'scheduler.tick' as const;

  constructor(data: ScheduledEventData<TPayload>) {
    super(ScheduledEvent.EVENT_TYPE, randomUUID(), data, data.scheduleId);
  }

  get scheduleId(): string {
    return this.data.scheduleId;
  }

  get cronExpression(): string {
    return this.data.cronExpression;
  }

  get tickNumber(): number {
    return this.data.tickNumber;
  }

  get scheduledAt(): Date {
    return new Date(this.data.scheduledAt);
  }

  get payload(): TPayload | undefined {
    return this.data.payload;
  }

  static fromJSON(json: DomainEventJSON): ScheduledEvent {
    const data = json.data as ScheduledEventData;
    return new ScheduledEvent({
      scheduleId: data.scheduleId ?? json.aggregateId ?? json.id,
      cronExpression: data.cronExpression ?? '',
      tickNumber: data.tickNumber ?? 0,
      scheduledAt: data.scheduledAt ?? json.occurredOn,
      payload: data.payload,
      metadata: data.metadata,
    });
  }
}

EventRegistry.getInstance().register(
  ScheduledEvent.EVENT_TYPE,
  ScheduledEvent.fromJSON
);
