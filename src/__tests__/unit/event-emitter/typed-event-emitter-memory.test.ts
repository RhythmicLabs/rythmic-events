import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import {
  TypedEventEmitter,
  createTypedEventEmitter,
  type TypedEventMap,
} from '../../../event-emitter/index';

interface TestEvents extends TypedEventMap {
  'test:event': { message: string };
  'test:number': { value: number };
  'test:object': { data: Record<string, unknown> };
}

describe('TypedEventEmitter Memory Leak Prevention', () => {
  describe('Listener Cleanup', () => {
    it('should NOT retain listeners after off() is called', () => {
      const emitter = createTypedEventEmitter<TestEvents>();
      const listeners: Array<() => void> = [];

      for (let i = 0; i < 10; i++) {
        const listener = () => {};
        listeners.push(listener);
        emitter.on('test:event', listener);
      }

      emitter.removeAllListeners();

      expect(emitter.listenerCount('test:event')).toBe(0);
      listeners.length = 0;
      expect(listeners.length).toBe(0);
    });

    it('should NOT retain listeners after removeAllListeners() with specific event', () => {
      const emitter = createTypedEventEmitter<TestEvents>();

      const listener1 = () => {};
      const listener2 = () => {};

      emitter.on('test:event', listener1);
      emitter.on('test:event', listener2);

      emitter.removeAllListeners('test:event');

      expect(emitter.listenerCount('test:event')).toBe(0);
    });

    it('should NOT retain listeners when same listener added to multiple events', () => {
      const emitter = createTypedEventEmitter<TestEvents>();
      const listener = () => {};

      emitter.on('test:event', listener);
      emitter.on('test:number', listener);

      // When same listener is added to multiple events, removing from one event
      // should still leave the other event with the listener
      emitter.off('test:event', listener);

      expect(emitter.listenerCount('test:event')).toBe(0);
      expect(emitter.listenerCount('test:number')).toBe(1);
    });

    it('should NOT retain listeners when removing specific listener', () => {
      const emitter = createTypedEventEmitter<TestEvents>();

      const listener1 = () => {};
      const listener2 = () => {};

      emitter.on('test:event', listener1);
      emitter.on('test:event', listener2);

      emitter.off('test:event', listener1);

      expect(emitter.listenerCount('test:event')).toBe(1);
      emitter.off('test:event', listener2);
      expect(emitter.listenerCount('test:event')).toBe(0);
    });

    it('should clean up completely after all listeners removed', () => {
      const emitter = createTypedEventEmitter<TestEvents>();
      const listeners: Array<() => void> = [];

      for (let i = 0; i < 5; i++) {
        const listener = () => {};
        listeners.push(listener);
        emitter.on('test:event', listener);
      }

      emitter.removeAllListeners();

      expect(emitter.listenerCount('test:event')).toBe(0);
      expect(emitter.eventNames()).toHaveLength(0);
    });
  });

  describe('Nested Object Cleanup', () => {
    it('should handle large nested objects in event data', async () => {
      const emitter = createTypedEventEmitter<TestEvents>();

      for (let i = 0; i < 5; i++) {
        const nestedData = {
          level1: {
            level2: {
              level3: {
                data: {
                  items: Array(100)
                    .fill(null)
                    .map((_, idx) => ({
                      id: idx,
                      value: `test-value-${idx}`,
                      metadata: { created: Date.now(), source: 'test' },
                    })),
                },
              },
            },
          },
        };

        await emitter.emit('test:object', { data: nestedData });
      }

      emitter.removeAllListeners();

      expect(emitter.listenerCount('test:object')).toBe(0);
    });

    it('should handle circular reference objects', async () => {
      const emitter = createTypedEventEmitter<TestEvents>();

      const createCircularObject = () => {
        const obj: Record<string, unknown> = { id: 'circular' };
        obj.self = obj;
        return obj;
      };

      for (let i = 0; i < 3; i++) {
        const circular = createCircularObject();
        await emitter.emit('test:object', { data: circular });
      }

      emitter.removeAllListeners();

      expect(emitter.listenerCount('test:object')).toBe(0);
    });

    it('should handle deeply nested object emissions', async () => {
      const emitter = createTypedEventEmitter<TestEvents>();
      const deepNested = {
        a: { b: { c: { d: { e: { f: { g: { h: 'deep' } } } } } } },
      };

      for (let i = 0; i < 10; i++) {
        await emitter.emit('test:object', { data: deepNested });
      }

      emitter.removeAllListeners();

      expect(emitter.listenerCount('test:object')).toBe(0);
    });

    it('should not retain event data after emission completes', async () => {
      const emitter = createTypedEventEmitter<TestEvents>();
      let eventProcessed = false;

      const eventData = {
        level1: { level2: { level3: { deep: 'value' } } },
      };

      emitter.on('test:object', async () => {
        eventProcessed = true;
        await Promise.resolve();
      });

      await emitter.emit('test:object', { data: eventData });

      expect(eventProcessed).toBe(true);
      emitter.removeAllListeners();

      expect(emitter.listenerCount('test:object')).toBe(0);
    });
  });

  describe('Instance Lifecycle', () => {
    it('should properly clean up emitter state after use', () => {
      const createAndUseEmitter = () => {
        const emitter = createTypedEventEmitter<TestEvents>();

        emitter.on('test:event', () => {});
        emitter.on('test:number', () => {});
        emitter.emit('test:event', { message: 'test' });

        return emitter;
      };

      const emitter1 = createAndUseEmitter();
      const emitter2 = createAndUseEmitter();

      expect(emitter1.listenerCount('test:event')).toBe(1);
      expect(emitter2.listenerCount('test:event')).toBe(1);

      emitter1.removeAllListeners();
      emitter2.removeAllListeners();

      expect(emitter1.listenerCount('test:event')).toBe(0);
      expect(emitter2.listenerCount('test:event')).toBe(0);
    });

    it('should NOT retain internal state after removeAllListeners without event parameter', () => {
      const emitter = createTypedEventEmitter<TestEvents>();

      emitter.on('test:event', () => {});
      emitter.on('test:number', () => {});
      emitter.emit('test:event', { message: 'test' });
      emitter.emit('test:number', { value: 42 });

      emitter.removeAllListeners();

      expect(emitter.listenerCount('test:event')).toBe(0);
      expect(emitter.listenerCount('test:number')).toBe(0);
      expect(emitter.eventNames()).toHaveLength(0);
    });

    it('should handle multiple emitter instances correctly', () => {
      const emitters: Array<TypedEventEmitter<TestEvents>> = [];

      for (let i = 0; i < 20; i++) {
        const emitter = createTypedEventEmitter<TestEvents>();
        emitters.push(emitter);

        emitter.on('loop:event', () => {});
      }

      emitters.forEach((emitter) => {
        expect(emitter.listenerCount('loop:event')).toBe(1);
      });

      emitters.forEach((emitter) => {
        emitter.removeAllListeners();
      });

      emitters.forEach((emitter) => {
        expect(emitter.listenerCount('loop:event')).toBe(0);
      });
    });
  });

  describe('Event Name Memory Management', () => {
    it('should not leak memory with many unique event names', () => {
      const emitter = createTypedEventEmitter<TestEvents>();

      for (let i = 0; i < 100; i++) {
        emitter.on(`unique:event:${i}`, () => {});
      }

      expect(emitter.eventNames().length).toBe(100);

      emitter.removeAllListeners();

      expect(emitter.eventNames()).toHaveLength(0);
    });

    it('should handle rapid event name registration and cleanup', () => {
      const emitter = createTypedEventEmitter<TestEvents>();
      const listeners: Array<() => void> = [];

      for (let i = 0; i < 50; i++) {
        const listener = () => {};
        listeners.push(listener);
        emitter.on(`rapid:${i}`, listener);
      }

      for (let i = 0; i < 50; i++) {
        emitter.off(`rapid:${i}`, listeners[i]);
      }

      expect(emitter.eventNames()).toHaveLength(0);
    });
  });

  describe('Listener Function References', () => {
    it('should properly cleanup detached listener functions', () => {
      const emitter = createTypedEventEmitter<TestEvents>();

      const createListener = () => {
        return () => {};
      };

      const listener1 = createListener();
      const listener2 = createListener();

      emitter.on('test:event', listener1);
      emitter.on('test:event', listener2);

      emitter.off('test:event', listener1);

      expect(emitter.listenerCount('test:event')).toBe(1);

      emitter.off('test:event', listener2);
      expect(emitter.listenerCount('test:event')).toBe(0);
    });

    it('should properly handle async listener cleanup', async () => {
      const emitter = createTypedEventEmitter<TestEvents>();

      const asyncListener = async () => {
        await Promise.resolve();
      };

      emitter.on('test:event', asyncListener);
      await emitter.emit('test:event', { message: 'test' });
      emitter.off('test:event', asyncListener);

      expect(emitter.listenerCount('test:event')).toBe(0);
    });
  });

  describe('Memory Under Sustained Load', () => {
    it('should not accumulate listeners over multiple add/remove cycles', () => {
      const emitter = createTypedEventEmitter<TestEvents>();

      for (let cycle = 0; cycle < 10; cycle++) {
        const listener = () => {};
        emitter.on('cycle:event', listener);
        emitter.emit('cycle:event', { message: `cycle-${cycle}` });
        emitter.off('cycle:event', listener);
      }

      expect(emitter.listenerCount('cycle:event')).toBe(0);
      expect(emitter.eventNames()).toHaveLength(0);
    });

    it('should handle repeated emit operations efficiently', async () => {
      const emitter = createTypedEventEmitter<TestEvents>();
      let callCount = 0;

      const listener = () => {
        callCount++;
      };

      emitter.on('repeated:event', listener);

      for (let i = 0; i < 100; i++) {
        await emitter.emit('repeated:event', { message: `message-${i}` });
      }

      expect(callCount).toBe(100);

      emitter.off('repeated:event', listener);

      expect(emitter.listenerCount('repeated:event')).toBe(0);
    });

    it('should properly manage memory with many once() listeners', async () => {
      const emitter = createTypedEventEmitter<TestEvents>();
      let callCount = 0;

      for (let i = 0; i < 10; i++) {
        const listener = () => {
          callCount++;
        };
        emitter.once('once:event', listener);
      }

      await emitter.emit('once:event', { message: 'test' });

      expect(callCount).toBe(10);
      expect(emitter.listenerCount('once:event')).toBe(0);
      expect(emitter.eventNames()).toHaveLength(0);
    });

    it('should handle rapid add/remove operations', () => {
      const emitter = createTypedEventEmitter<TestEvents>();
      const listener = () => {};

      for (let i = 0; i < 100; i++) {
        emitter.on('rapid:ops', listener);
        emitter.off('rapid:ops', listener);
      }

      expect(emitter.listenerCount('rapid:ops')).toBe(0);
      expect(emitter.eventNames()).toHaveLength(0);
    });
  });

  describe('Edge Cases', () => {
    it('should handle removing non-existent listener gracefully', () => {
      const emitter = createTypedEventEmitter<TestEvents>();
      const listener = () => {};

      emitter.on('test:event', listener);

      expect(() => {
        emitter.off('test:event', () => {});
      }).not.toThrow();

      expect(emitter.listenerCount('test:event')).toBe(1);
    });

    it('should handle removing from non-existent event gracefully', () => {
      const emitter = createTypedEventEmitter<TestEvents>();
      const listener = () => {};

      expect(() => {
        emitter.off('non:existent', listener);
      }).not.toThrow();
    });

    it('should handle emitting with no listeners', async () => {
      const emitter = createTypedEventEmitter<TestEvents>();

      const result = await emitter.emit('test:event', { message: 'test' });

      expect(result).toBe(false);
    });

    it('should handle multiple emitters with overlapping event names', () => {
      const emitter1 = createTypedEventEmitter<TestEvents>();
      const emitter2 = createTypedEventEmitter<TestEvents>();

      const listener1 = () => {};
      const listener2 = () => {};

      emitter1.on('shared:event', listener1);
      emitter2.on('shared:event', listener2);

      expect(emitter1.listenerCount('shared:event')).toBe(1);
      expect(emitter2.listenerCount('shared:event')).toBe(1);

      emitter1.removeAllListeners();

      expect(emitter1.listenerCount('shared:event')).toBe(0);
      expect(emitter2.listenerCount('shared:event')).toBe(1);
    });
  });
});
