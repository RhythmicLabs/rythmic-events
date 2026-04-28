import { randomUUID } from 'node:crypto';
import { DomainEvent, type DomainEventJSON } from '@/domain-events/index';
import type { SystemReminderEventData } from '@/domain-events/system-reminder-event';
import type { SystemReminderResponseEventData } from '@/domain-events/system-reminder-response-event';
import type { QueryCriteria } from '@/cache/storage';

/**
 * Factory class for creating test events and data
 */
export class EventFactory {
  /**
   * Create a basic domain event
   */
  static createDomainEvent(
    overrides: Partial<DomainEvent> & { id?: string } = {}
  ): DomainEvent {
    return new TestDomainEvent(
      overrides.type ?? 'test.event',
      overrides.aggregateId ?? `test-aggregate-${randomUUID()}`,
      overrides.metadata ?? { test: true },
      overrides.id
    );
  }

  /**
   * Create a system reminder event
   */
  static createSystemReminderEvent(
    overrides: Partial<SystemReminderEventData> = {}
  ): any {
    const reminderId = overrides.reminderId ?? `reminder-${randomUUID()}`;
    return {
      reminderId,
      prompt: overrides.prompt ?? 'Test reminder prompt',
      context: overrides.context ?? { source: 'test' },
      source: overrides.source ?? 'TestFactory',
      priority: overrides.priority ?? 'medium',
      timeout: overrides.timeout ?? 30000,
      expectedResponseType: overrides.expectedResponseType,
      userId: overrides.userId ?? 'test-user',
      sessionId: overrides.sessionId ?? 'test-session',
      metadata: overrides.metadata ?? { created: Date.now() },
    };
  }

  /**
   * Create a system reminder response event
   */
  static createSystemReminderResponseEvent(
    overrides: Partial<SystemReminderResponseEventData> = {}
  ): any {
    const reminderId = overrides.reminderId ?? `reminder-${randomUUID()}`;
    return {
      reminderId,
      response: overrides.response ?? { status: 'completed' },
      status: overrides.status ?? 'success',
      processingTime: overrides.processingTime ?? 150,
      error: overrides.error,
      partialData: overrides.partialData,
      confidence: overrides.confidence ?? 0.95,
      metadata: overrides.metadata ?? { created: Date.now() },
    };
  }

  /**
   * Create a batch of events for performance testing
   */
  static createEventBatch(
    count: number,
    eventType: string = 'test.batch'
  ): DomainEvent[] {
    return Array.from({ length: count }, (_, index) =>
      this.createDomainEvent({
        type: `${eventType}.${index}`,
        aggregateId: `batch-aggregate-${Math.floor(index / 10)}`,
        metadata: {
          batchIndex: index,
          batchSize: count,
          timestamp: Date.now(),
        },
      })
    );
  }

  /**
   * Create events with specific time range for time-based queries
   */
  static createEventTimeSeries(
    count: number,
    daysSpan: number = 7
  ): DomainEvent[] {
    const now = new Date();
    const startTime = new Date(now.getTime() - daysSpan * 24 * 60 * 60 * 1000);

    return Array.from({ length: count }, (_, index) => {
      const eventTime = new Date(
        startTime.getTime() +
          (index / count) * (now.getTime() - startTime.getTime())
      );

      return this.createDomainEvent({
        occurredOn: eventTime,
        metadata: {
          timeSeriesIndex: index,
          generatedAt: eventTime.toISOString(),
        },
      });
    });
  }

  /**
   * Create query criteria for testing
   */
  static createQueryCriteria(
    overrides: Partial<QueryCriteria> = {}
  ): QueryCriteria {
    return {
      eventType: overrides.eventType,
      limit: overrides.limit,
      before: overrides.before,
      after: overrides.after,
      aggregateId: overrides.aggregateId,
    };
  }
}

/**
 * Test implementation of DomainEvent for testing purposes
 */
class TestDomainEvent extends DomainEvent<Record<string, unknown>> {
  constructor(
    type: string,
    aggregateId?: string,
    metadata?: Record<string, unknown>,
    id?: string
  ) {
    const eventId = id ?? randomUUID();
    super(type, eventId, metadata ?? {}, aggregateId, metadata);
  }
}

/**
 * Pre-defined test events for common scenarios
 */
export const SAMPLE_EVENTS = {
  simple: new TestDomainEvent('test.simple', 'simple-aggregate', {
    simple: true,
  }),
  complex: new TestDomainEvent('test.complex', 'complex-aggregate', {
    complex: true,
    nested: {
      level1: {
        level2: 'deep-value',
      },
    },
  }),
  highPriority: new TestDomainEvent('test.priority', 'priority-aggregate', {
    priority: 'high',
    urgent: true,
  }),
  batched: new TestDomainEvent('test.batch', 'batch-aggregate', {
    batchId: 'batch-123',
    index: 0,
  }),
  withMetadata: new TestDomainEvent('test.metadata', 'metadata-aggregate', {
    version: '1.0.0',
    source: 'test-factory',
    environment: 'test',
    correlationId: randomUUID(),
  }),
};

/**
 * Sample Redis data for testing
 */
export const SAMPLE_REDIS_DATA = {
  simpleEvent: {
    id: 'simple-event-123',
    type: 'test.simple',
    occurredOn: '2024-01-01T00:00:00.000Z',
    aggregateId: 'simple-aggregate',
    version: 1,
    metadata: { simple: true },
  },
  complexEvent: {
    id: 'complex-event-456',
    type: 'test.complex',
    occurredOn: '2024-01-01T01:00:00.000Z',
    aggregateId: 'complex-aggregate',
    version: 1,
    metadata: {
      complex: true,
      nested: { level1: { level2: 'deep-value' } },
    },
  },
};
