import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import {
  TypedEventEmitter,
  createTypedEventEmitter,
  type TypedEventMap,
  type EventListener,
} from '../../../event-emitter/index';

describe('createTypedEventEmitter Factory', () => {
  describe('Basic Functionality', () => {
    it('should create emitter with no listeners', () => {
      const emitter = createTypedEventEmitter();

      expect(emitter.listenerCount('test:event')).toBe(0);
      expect(emitter.eventNames()).toHaveLength(0);
    });

    it('should accept custom event map types', () => {
      interface CustomEvents extends TypedEventMap {
        'custom:event': { data: string };
        'custom:number': { value: number };
      }

      const emitter = createTypedEventEmitter<CustomEvents>();

      expect(emitter).toBeInstanceOf(TypedEventEmitter);
      expect(emitter.listenerCount('custom:event')).toBe(0);
    });

    it('should use default TypedEventMap when no type provided', () => {
      const emitter = createTypedEventEmitter();

      expect(() => {
        emitter.on('any:event-name', () => {});
        emitter.emit('any:event-name', {});
      }).not.toThrow();
    });

    it('should create clean emitter instances', () => {
      const emitter1 = createTypedEventEmitter();
      const emitter2 = createTypedEventEmitter();

      emitter1.on('test:event', () => {});
      emitter2.on('test:event', () => {});

      expect(emitter1.listenerCount('test:event')).toBe(1);
      expect(emitter2.listenerCount('test:event')).toBe(1);
      expect(emitter1).not.toBe(emitter2);
    });
  });

  describe('Type Safety', () => {
    interface StrictEvents extends TypedEventMap {
      'strict:event': { required: string; optional?: number };
    }

    it('should maintain generic type inference', () => {
      const emitter = createTypedEventEmitter<StrictEvents>();
      const listener: EventListener<{
        required: string;
        optional?: number;
      }> = () => {};

      expect(() => {
        emitter.on('strict:event', listener);
      }).not.toThrow();
    });

    it('should enforce event data types', () => {
      const emitter = createTypedEventEmitter<StrictEvents>();

      emitter.on('strict:event', (data) => {
        expect(data.required).toBeDefined();
        expect(typeof data.required).toBe('string');
      });

      expect(() => {
        emitter.emit('strict:event', { required: 'test' });
      }).not.toThrow();
    });

    it('should create type-safe instances', () => {
      interface SafeEvents extends TypedEventMap {
        'safe:event': { message: string };
      }

      const emitter = createTypedEventEmitter<SafeEvents>();

      emitter.emit('safe:event', { message: 'test' });

      let called = false;
      emitter.on('safe:event', () => {
        called = true;
      });
      emitter.emit('safe:event', { message: 'hello' });

      expect(called).toBe(true);
    });

    it('should preserve type safety through all methods', () => {
      interface MethodEvents extends TypedEventMap {
        'method:test': { value: string };
      }

      const emitter = createTypedEventEmitter<MethodEvents>();
      let callCount = 0;

      const listener: EventListener<{ value: string }> = () => {
        callCount++;
      };

      emitter.on('method:test', listener);
      emitter.once('method:test', listener);
      emitter.emit('method:test', { value: 'test' });
      emitter.off('method:test', listener);
      emitter.removeAllListeners('method:test');

      expect(callCount).toBe(2);
    });
  });

  describe('Instance Isolation', () => {
    it('should not share listeners between instances', () => {
      const emitter1 = createTypedEventEmitter();
      const emitter2 = createTypedEventEmitter();
      let call1 = 0;
      let call2 = 0;

      emitter1.on('shared:event', () => {
        call1++;
      });
      emitter2.on('shared:event', () => {
        call2++;
      });

      emitter1.emit('shared:event', {});
      emitter2.emit('shared:event', {});

      expect(call1).toBe(1);
      expect(call2).toBe(1);
      expect(emitter1.listenerCount('shared:event')).toBe(1);
      expect(emitter2.listenerCount('shared:event')).toBe(1);
    });

    it('should have separate event maps per instance', () => {
      const emitter1 = createTypedEventEmitter<{
        emitter1: { data: string };
      }>();
      const emitter2 = createTypedEventEmitter<{
        emitter2: { data: number };
      }>();

      let result1 = '';
      let result2 = 0;

      emitter1.on('emitter1', (data) => {
        result1 = data.data;
      });
      emitter2.on('emitter2', (data) => {
        result2 = data.data;
      });

      emitter1.emit('emitter1', { data: 'string' });
      emitter2.emit('emitter2', { data: 42 });

      expect(result1).toBe('string');
      expect(result2).toBe(42);
    });

    it('should maintain isolation across all operations', () => {
      const emitter1 = createTypedEventEmitter();
      const emitter2 = createTypedEventEmitter();

      emitter1.on('isolation:test', () => {});
      emitter2.on('isolation:test', () => {});

      emitter1.removeAllListeners('isolation:test');

      expect(emitter1.listenerCount('isolation:test')).toBe(0);
      expect(emitter2.listenerCount('isolation:test')).toBe(1);
    });

    it('should create multiple independent instances', () => {
      const emitters = Array.from({ length: 10 }, () =>
        createTypedEventEmitter()
      );
      const listenerCounts = emitters.map((emitter) => ({
        event: 'multi:test',
        listeners: emitter.listenerCount('multi:test'),
      }));

      expect(listenerCounts.every((count) => count.listeners === 0)).toBe(true);

      emitters.forEach((emitter) => {
        emitter.on('multi:test', () => {});
      });

      expect(
        emitters.every((emitter) => emitter.listenerCount('multi:test') === 1)
      ).toBe(true);
    });
  });

  describe('Consistency with TypedEventEmitter Class', () => {
    it('should produce instances identical to direct construction', () => {
      const factoryEmitter = createTypedEventEmitter();
      const classEmitter = new TypedEventEmitter();

      expect(factoryEmitter.eventNames()).toEqual(classEmitter.eventNames());
      expect(factoryEmitter.listenerCount('test:event')).toBe(
        classEmitter.listenerCount('test:event')
      );

      let factoryCalls = 0;
      let classCalls = 0;

      factoryEmitter.on('consistency:test', () => {
        factoryCalls++;
      });
      classEmitter.on('consistency:test', () => {
        classCalls++;
      });

      factoryEmitter.emit('consistency:test', { data: 'factory' });
      classEmitter.emit('consistency:test', { data: 'class' });

      expect(factoryCalls).toBe(1);
      expect(classCalls).toBe(1);
    });

    it('should support all TypedEventEmitter methods', () => {
      const emitter = createTypedEventEmitter();

      expect(typeof emitter.on).toBe('function');
      expect(typeof emitter.once).toBe('function');
      expect(typeof emitter.off).toBe('function');
      expect(typeof emitter.emit).toBe('function');
      expect(typeof emitter.removeAllListeners).toBe('function');
      expect(typeof emitter.listenerCount).toBe('function');
      expect(typeof emitter.eventNames).toBe('function');

      expect(
        emitter
          .on('chain:test', () => {})
          .once('once:test', () => {})
          .removeAllListeners()
      ).toBe(emitter);
    });
  });
});
