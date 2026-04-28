import { randomUUID } from 'node:crypto';
import {
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
  jest,
} from '@jest/globals';
import { DomainEvent, type DomainEventJSON } from '../../../domain-events/index';
import {
  EventRegistry,
  type EventDeserializer,
} from '../../../domain-events/event-registry';

class TestEvent extends DomainEvent<Record<string, unknown>> {
  constructor(
    type: string,
    aggregateId?: string,
    metadata?: Record<string, unknown>,
    id?: string
  ) {
    const eventId = id ?? randomUUID();
    super(type, eventId, { aggregateId, metadata }, aggregateId, metadata);
  }
}

describe('EventRegistry', () => {
  let registry: EventRegistry;

  beforeEach(() => {
    EventRegistry.resetInstance();
    registry = EventRegistry.getInstance();
  });

  afterEach(() => {
    registry.clear();
    EventRegistry.resetInstance();
  });

  describe('singleton pattern', () => {
    it('should return same instance', () => {
      const instance1 = EventRegistry.getInstance();
      const instance2 = EventRegistry.getInstance();
      const instance3 = EventRegistry.getInstance();

      expect(instance1).toBe(instance2);
      expect(instance2).toBe(instance3);
    });

    it('should create new instance after reset', () => {
      const instance1 = EventRegistry.getInstance();
      EventRegistry.resetInstance();
      const instance2 = EventRegistry.getInstance();

      expect(instance1).not.toBe(instance2);
    });
  });

  describe('register', () => {
    it('should register event deserializer', () => {
      const deserializer: EventDeserializer = jest.fn(() => new TestEvent('test.event'));

      registry.register('test.event', deserializer);

      expect(registry.has('test.event')).toBe(true);
    });

    it('should allow multiple deserializers', () => {
      const deserializer1 = jest.fn();
      const deserializer2 = jest.fn();

      registry.register('event.one', deserializer1);
      registry.register('event.two', deserializer2);

      expect(registry.has('event.one')).toBe(true);
      expect(registry.has('event.two')).toBe(true);
    });

    it('should overwrite existing deserializer', () => {
      const deserializer1 = jest.fn();
      const deserializer2 = jest.fn();

      registry.register('test.event', deserializer1);
      registry.register('test.event', deserializer2);

      // The registry should use the latest deserializer
      const json: DomainEventJSON = {
        id: 'test-id',
        type: 'test.event',
        occurredOn: '2024-01-01T00:00:00.000Z',
        version: 1,
      } as any;

      registry.deserialize(json);

      expect(deserializer1).not.toHaveBeenCalled();
      expect(deserializer2).toHaveBeenCalledWith(json);
    });
  });

  describe('has', () => {
    it('should return true for registered events', () => {
      registry.register('test.event', jest.fn());
      expect(registry.has('test.event')).toBe(true);
    });

    it('should return false for unregistered events', () => {
      expect(registry.has('non.existent')).toBe(false);
    });

    it('should return false after clearing', () => {
      registry.register('test.event', jest.fn());
      expect(registry.has('test.event')).toBe(true);

      registry.clear();
      expect(registry.has('test.event')).toBe(false);
    });
  });

  describe('deserialize', () => {
    let TestEvent: any;
    let testJson: DomainEventJSON;

    beforeEach(() => {
      TestEvent = class extends DomainEvent<Record<string, unknown>> {
        constructor(
          type: string,
          aggregateId?: string,
          metadata?: Record<string, unknown>,
          id?: string
        ) {
          const eventId = id ?? randomUUID();
          super(type, eventId, { aggregateId, metadata }, aggregateId, metadata);
        }
      };

      testJson = {
        id: 'test-id-123',
        type: 'test.event',
        occurredOn: '2024-01-01T12:00:00.000Z',
        aggregateId: 'test-aggregate-456',
        version: 1,
        data: {},
        metadata: {
          source: 'test-factory',
          priority: 'high',
        },
      };
    });

    it('should deserialize registered event type', () => {
      const deserializer: EventDeserializer = (json: DomainEventJSON) => {
        return new TestEvent(
          json.type,
          json.aggregateId,
          json.metadata,
          json.id
        );
      };

      registry.register('test.event', deserializer);

      const result = registry.deserialize(testJson);

      expect(result).toBeInstanceOf(TestEvent);
      expect(result.id).toBe('test-id-123');
      expect(result.type).toBe('test.event');
      expect(result.aggregateId).toBe('test-aggregate-456');
      expect(result.metadata).toEqual({
        source: 'test-factory',
        priority: 'high',
      });
    });

    it('should call registered deserializer', () => {
      const deserializer: EventDeserializer = jest.fn(
        (json: DomainEventJSON) => {
          return new TestEvent(
            json.type,
            json.aggregateId,
            json.metadata,
            json.id
          );
        }
      );

      registry.register('test.event', deserializer);
      registry.deserialize(testJson);

      expect(deserializer).toHaveBeenCalledWith(testJson);
    });

    it('should throw error for unregistered event type', () => {
      expect(() => {
        registry.deserialize(testJson);
      }).toThrow('No deserializer registered for event type "test.event"');
    });

    it('should include event type in error message', () => {
      const eventType = 'custom.event';

      expect(() => {
        registry.deserialize({
          id: 'test',
          type: eventType,
          occurredOn: '2024-01-01T00:00:00.000Z',
          version: 1,
        } as any);
      }).toThrow(`No deserializer registered for event type "${eventType}"`);
    });

    it('should include registration suggestion in error message', () => {
      const eventType = 'missing.event';

      try {
        registry.deserialize({
          id: 'test',
          type: eventType,
          occurredOn: '2024-01-01T00:00:00.000Z',
          version: 1,
        } as any);
      } catch (error) {
        expect(error.message).toContain(
          'Register one via EventRegistry.getInstance().register'
        );
        expect(error.message).toContain(`"${eventType}"`);
      }
    });

    it('should handle deserialization errors', () => {
      const error = new Error('Deserialization failed');
      const deserializer: EventDeserializer = jest
        .fn()
        .mockImplementation(() => {
          throw error;
        });

      registry.register('error.event', deserializer);

      const errorJson = {
        id: 'error-id',
        type: 'error.event',
        occurredOn: '2024-01-01T00:00:00.000Z',
        version: 1,
      } as any;

      expect(() => {
        registry.deserialize(errorJson);
      }).toThrow('Deserialization failed');
    });
  });

  describe('clear', () => {
    it('should remove all registered deserializers', () => {
      registry.register('event.one', jest.fn());
      registry.register('event.two', jest.fn());
      registry.register('event.three', jest.fn());

      expect(registry.has('event.one')).toBe(true);
      expect(registry.has('event.two')).toBe(true);
      expect(registry.has('event.three')).toBe(true);

      registry.clear();

      expect(registry.has('event.one')).toBe(false);
      expect(registry.has('event.two')).toBe(false);
      expect(registry.has('event.three')).toBe(false);
    });

    it('should reset to empty state', () => {
      registry.register('test.event', jest.fn());
      registry.clear();

      // Should be able to register again after clear
      const deserializer: EventDeserializer = jest.fn();
      registry.register('test.event', deserializer);

      expect(registry.has('test.event')).toBe(true);
      expect(registry.deserialize).toBeDefined();
    });
  });

  describe('integration with domain events', () => {
    class TestEvent extends DomainEvent<Record<string, unknown>> {
      readonly testData: string;

      constructor(
        type: string,
        aggregateId?: string,
        metadata?: Record<string, unknown>,
        id?: string,
        testData?: string
      ) {
        const eventId = id ?? randomUUID();
        const data = { testData: testData || 'default', ...metadata };
        super(type, eventId, data, aggregateId, metadata);
        this.testData = testData || 'default';
      }
    }

    it('should work with actual domain event classes', () => {
      const deserializer: EventDeserializer = (json: DomainEventJSON) => {
        const testData = (json.data as any)?.testData || 'default';
        return new TestEvent(
          json.type,
          json.aggregateId,
          json.metadata,
          json.id,
          testData
        );
      };

      registry.register('test.event', deserializer);

      const json: DomainEventJSON = {
        id: 'integration-test',
        type: 'test.event',
        occurredOn: '2024-01-01T00:00:00.000Z',
        version: 1,
        data: { testData: 'integration value' },
      } as any;

      const result = registry.deserialize(json);

      expect(result).toBeInstanceOf(TestEvent);
      expect((result as any).testData).toBe('integration value');
    });

    it('should handle complex metadata', () => {
      class ComplexEvent extends DomainEvent<Record<string, unknown>> {
        readonly complexData: { nested: { value: string; count: number } };

        constructor(complexData: { nested: { value: string; count: number } }) {
          const id = randomUUID();
          super('complex.event', id, { complexData });
          this.complexData = complexData;
        }
      }

      const deserializer: EventDeserializer = (json: DomainEventJSON) => {
        return new ComplexEvent((json.data as any)?.complexData);
      };

      registry.register('complex.event', deserializer);

      const json: DomainEventJSON = {
        id: 'complex-test',
        type: 'complex.event',
        occurredOn: '2024-01-01T00:00:00.000Z',
        version: 1,
        data: {
          complexData: {
            nested: {
              value: 'deep value',
              count: 42,
            },
          },
        },
      } as any;

      const result = registry.deserialize(json);

      expect(result).toBeInstanceOf(ComplexEvent);
      expect((result as any).complexData).toEqual({
        nested: {
          value: 'deep value',
          count: 42,
        },
      });
    });
  });
});
