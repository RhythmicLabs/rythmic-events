import { randomUUID } from 'node:crypto';
import {
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
  jest,
} from '@jest/globals';
import {
  DomainEvent,
  DomainEventDispatcher,
  type DomainEventHandler,
  type DomainEventJSON,
} from '../../../domain-events/index';

describe('DomainEvent', () => {
  describe('constructor', () => {
    it('should create event with required properties', () => {
      const eventType = 'test.event';
      const aggregateId = 'test-aggregate';
      const metadata = { source: 'test' };
      const data = { payload: 'test-data' };

      class TestEvent extends DomainEvent<typeof data> {
        constructor(
          type: string,
          aggregateId?: string,
          metadata?: Record<string, unknown>,
          id?: string
        ) {
          const eventId = id ?? 'generated-id';
          super(type, eventId, data, aggregateId, metadata);
        }
      }

      const event = new TestEvent(eventType, aggregateId, metadata);

      expect(event.type).toBe(eventType);
      expect(event.aggregateId).toBe(aggregateId);
      expect(event.metadata).toBe(metadata);
      expect(event.id).toBeDefined();
      expect(event.occurredOn).toBeInstanceOf(Date);
      expect(event.version).toBe(1);
      expect(event.data).toEqual(data);
    });

    it('should generate unique UUID for each event', () => {
      const data = { test: true };

      class TestEvent extends DomainEvent<typeof data> {
        constructor() {
          const id = randomUUID();
          super('test.event', id, data);
        }
      }

      const event1 = new TestEvent();
      const event2 = new TestEvent();

      expect(event1.id).toBeDefined();
      expect(event2.id).toBeDefined();
      expect(event1.id).not.toBe(event2.id);
      expect(event1.id).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
      );
    });

    it('should use current timestamp', () => {
      const data = { test: true };

      class TestEvent extends DomainEvent<typeof data> {
        constructor() {
          const id = randomUUID();
          super('test.event', id, data);
        }
      }

      const before = new Date();
      const event = new TestEvent();
      const after = new Date();

      expect(event.occurredOn.getTime()).toBeGreaterThanOrEqual(
        before.getTime()
      );
      expect(event.occurredOn.getTime()).toBeLessThanOrEqual(after.getTime());
    });

    it('should have default version 1', () => {
      const data = { test: true };

      class TestEvent extends DomainEvent<typeof data> {
        constructor() {
          const id = randomUUID();
          super('test.event', id, data);
        }
      }

      const event = new TestEvent();
      expect(event.version).toBe(1);
    });
  });

  describe('toJSON', () => {
    it('should serialize to correct JSON format', () => {
      class TestEvent extends DomainEvent<Record<string, unknown>> {
        constructor() {
          const id = randomUUID();
          const data = { source: 'test', priority: 'high' };
          super('test.event', id, data, 'test-aggregate');
        }
      }

      const event = new TestEvent();
      const json = event.toJSON();

      expect(json).toEqual({
        id: event.id,
        type: 'test.event',
        occurredOn: event.occurredOn.toISOString(),
        aggregateId: 'test-aggregate',
        version: 1,
        data: { source: 'test', priority: 'high' },
      });
    });

    it('should omit undefined properties', () => {
      class TestEvent extends DomainEvent<Record<string, unknown>> {
        constructor() {
          const id = randomUUID();
          super('test.event', id, {});
        }
      }

      const event = new TestEvent();
      const json = event.toJSON();

      expect(json.aggregateId).toBeUndefined();
      expect(json.metadata).toBeUndefined();
      expect(json).not.toHaveProperty('aggregateId');
      expect(json).not.toHaveProperty('metadata');
    });

    it('should serialize date to ISO string', () => {
      const testDate = new Date('2024-01-01T12:00:00.000Z');

      class TestEvent extends DomainEvent<Record<string, unknown>> {
        constructor() {
          const id = randomUUID();
          super('test.event', id, {});
        }
      }

      const event = new TestEvent();
      // Mock the occurredOn to control test
      (event as any).occurredOn = testDate;

      const json = event.toJSON();

      expect(json.occurredOn).toBe('2024-01-01T12:00:00.000Z');
    });
  });
});

describe('DomainEventDispatcher', () => {
  let dispatcher: DomainEventDispatcher;

  beforeEach(() => {
    dispatcher = new DomainEventDispatcher();
  });

  afterEach(() => {
    dispatcher.clear();
  });

  describe('register', () => {
    it('should register event handler', () => {
      const handler: DomainEventHandler = jest.fn();

      dispatcher.register('test.event', handler);

      expect(dispatcher.hasHandlers('test.event')).toBe(true);
      expect(dispatcher.getHandlerCount('test.event')).toBe(1);
    });

    it('should register multiple handlers for same event', () => {
      const handler1 = jest.fn();
      const handler2 = jest.fn();

      dispatcher.register('test.event', handler1);
      dispatcher.register('test.event', handler2);

      expect(dispatcher.hasHandlers('test.event')).toBe(true);
      expect(dispatcher.getHandlerCount('test.event')).toBe(2);
    });

    it('should register handlers for different events', () => {
      const handler1 = jest.fn();
      const handler2 = jest.fn();

      dispatcher.register('event.one', handler1);
      dispatcher.register('event.two', handler2);

      expect(dispatcher.hasHandlers('event.one')).toBe(true);
      expect(dispatcher.hasHandlers('event.two')).toBe(true);
      expect(dispatcher.hasHandlers('event.three')).toBe(false);
    });
  });

  describe('unregister', () => {
    it('should unregister specific handler', () => {
      const handler1 = jest.fn();
      const handler2 = jest.fn();

      dispatcher.register('test.event', handler1);
      dispatcher.register('test.event', handler2);
      dispatcher.unregister('test.event', handler1);

      expect(dispatcher.hasHandlers('test.event')).toBe(true);
      expect(dispatcher.getHandlerCount('test.event')).toBe(1);
    });

    it('should remove last handler and clean up', () => {
      const handler = jest.fn();

      dispatcher.register('test.event', handler);
      dispatcher.unregister('test.event', handler);

      expect(dispatcher.hasHandlers('test.event')).toBe(false);
      expect(dispatcher.getHandlerCount('test.event')).toBe(0);
    });

    it('should not affect other event handlers', () => {
      const handler1 = jest.fn();
      const handler2 = jest.fn();

      dispatcher.register('event.one', handler1);
      dispatcher.register('event.two', handler2);
      dispatcher.unregister('event.one', handler1);

      expect(dispatcher.hasHandlers('event.one')).toBe(false);
      expect(dispatcher.hasHandlers('event.two')).toBe(true);
    });
  });

  describe('dispatch', () => {
    it('should dispatch event to registered handlers', async () => {
      const handler1 = jest.fn();
      const handler2 = jest.fn();

      dispatcher.register('test.event', handler1);
      dispatcher.register('test.event', handler2);

      class TestEvent extends DomainEvent<Record<string, unknown>> {
        constructor() {
          const id = randomUUID();
          const data = { test: 'data' };
          super('test.event', id, data, 'test-aggregate', data);
        }
      }

      const event = new TestEvent();
      await dispatcher.dispatch(event);

      expect(handler1).toHaveBeenCalledWith(event);
      expect(handler2).toHaveBeenCalledWith(event);
    });

    it('should not call handlers for different events', async () => {
      const handler = jest.fn();

      dispatcher.register('test.event', handler);

      class TestEvent extends DomainEvent<Record<string, unknown>> {
        constructor() {
          const id = randomUUID();
          super('different.event', id, {});
        }
      }

      const event = new TestEvent();
      await dispatcher.dispatch(event);

      expect(handler).not.toHaveBeenCalled();
    });

    it('should handle multiple handlers for same event', async () => {
      const handler1 = jest.fn();
      const handler2 = jest.fn();
      const handler3 = jest.fn();

      dispatcher.register('test.event', handler1);
      dispatcher.register('test.event', handler2);
      dispatcher.register('test.event', handler3);

      class TestEvent extends DomainEvent<Record<string, unknown>> {
        constructor() {
          const id = randomUUID();
          super('test.event', id, {});
        }
      }

      const event = new TestEvent();
      await dispatcher.dispatch(event);

      expect(handler1).toHaveBeenCalled();
      expect(handler2).toHaveBeenCalled();
      expect(handler3).toHaveBeenCalled();
    });

    it('should handle handler errors gracefully', async () => {
      const error = new Error('Handler error');
      const errorHandler = jest.fn().mockRejectedValue(error);
      const goodHandler = jest.fn();

      dispatcher.register('test.event', errorHandler);
      dispatcher.register('test.event', goodHandler);

      class TestEvent extends DomainEvent<Record<string, unknown>> {
        constructor() {
          const id = randomUUID();
          super('test.event', id, {});
        }
      }

      const event = new TestEvent();

      // Should not throw even with handler errors
      await expect(dispatcher.dispatch(event)).resolves.toBeUndefined();

      expect(errorHandler).toHaveBeenCalled();
      expect(goodHandler).toHaveBeenCalled();
    });
  });

  describe('dispatchMultiple', () => {
    it('should dispatch multiple events to handlers', async () => {
      const handler = jest.fn();

      dispatcher.register('test.event', handler);

      class TestEvent extends DomainEvent<Record<string, unknown>> {
        constructor(id: number) {
          const eventId = randomUUID();
          super('test.event', eventId, { eventId: id });
        }
      }

      const events = [new TestEvent(1), new TestEvent(2), new TestEvent(3)];

      await dispatcher.dispatchMultiple(events);

      expect(handler).toHaveBeenCalledTimes(3);
      expect(handler).toHaveBeenCalledWith(events[0]);
      expect(handler).toHaveBeenCalledWith(events[1]);
      expect(handler).toHaveBeenCalledWith(events[2]);
    });

    it('should handle mixed event types', async () => {
      const handler1 = jest.fn();
      const handler2 = jest.fn();

      dispatcher.register('test.event', handler1);
      dispatcher.register('different.event', handler2);

      class TestEvent1 extends DomainEvent<Record<string, unknown>> {
        constructor() {
          const id = randomUUID();
          super('test.event', id, {});
        }
      }

      class TestEvent2 extends DomainEvent<Record<string, unknown>> {
        constructor() {
          const id = randomUUID();
          super('different.event', id, {});
        }
      }

      const events = [new TestEvent1(), new TestEvent2()];
      await dispatcher.dispatchMultiple(events);

      expect(handler1).toHaveBeenCalledWith(events[0]);
      expect(handler1).not.toHaveBeenCalledWith(events[1]);
      expect(handler2).toHaveBeenCalledWith(events[1]);
      expect(handler2).not.toHaveBeenCalledWith(events[0]);
    });
  });

  describe('clear', () => {
    it('should remove all handlers', () => {
      const handler1 = jest.fn();
      const handler2 = jest.fn();

      dispatcher.register('event.one', handler1);
      dispatcher.register('event.two', handler2);

      expect(dispatcher.hasHandlers('event.one')).toBe(true);
      expect(dispatcher.hasHandlers('event.two')).toBe(true);

      dispatcher.clear();

      expect(dispatcher.hasHandlers('event.one')).toBe(false);
      expect(dispatcher.hasHandlers('event.two')).toBe(false);
      expect(dispatcher.getHandlerCount('event.one')).toBe(0);
      expect(dispatcher.getHandlerCount('event.two')).toBe(0);
    });
  });

  describe('hasHandlers', () => {
    it('should return true when handlers exist', () => {
      dispatcher.register('test.event', jest.fn());
      expect(dispatcher.hasHandlers('test.event')).toBe(true);
    });

    it('should return false when no handlers exist', () => {
      expect(dispatcher.hasHandlers('non.existent')).toBe(false);
    });

    it('should return false after clearing', () => {
      dispatcher.register('test.event', jest.fn());
      expect(dispatcher.hasHandlers('test.event')).toBe(true);

      dispatcher.clear();
      expect(dispatcher.hasHandlers('test.event')).toBe(false);
    });
  });

  describe('getHandlerCount', () => {
    it('should return correct handler count', () => {
      expect(dispatcher.getHandlerCount('test.event')).toBe(0);

      dispatcher.register('test.event', jest.fn());
      expect(dispatcher.getHandlerCount('test.event')).toBe(1);

      dispatcher.register('test.event', jest.fn());
      expect(dispatcher.getHandlerCount('test.event')).toBe(2);

      dispatcher.register('test.event', jest.fn());
      expect(dispatcher.getHandlerCount('test.event')).toBe(3);
    });

    it('should return 0 for non-existent events', () => {
      expect(dispatcher.getHandlerCount('non.existent')).toBe(0);
    });
  });
});
