import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import {
  TypedEventEmitter,
  createTypedEventEmitter,
  type TypedEventMap,
} from '../../../event-emitter/index';

interface TestEvents extends TypedEventMap {
  'test:event': { message: string };
  'test:number': { value: number };
}

describe('TypedEventEmitter Performance & Scalability', () => {
  describe('High Volume Listener Operations', () => {
    it('should handle 1000 listeners efficiently', () => {
      const emitter = createTypedEventEmitter<TestEvents>();
      const listeners: Array<() => void> = [];

      const startTime = Date.now();

      for (let i = 0; i < 1000; i++) {
        const listener = () => {};
        listeners.push(listener);
        emitter.on('test:event', listener);
      }

      const addTime = Date.now() - startTime;

      expect(emitter.listenerCount('test:event')).toBe(1000);
      expect(addTime).toBeLessThan(1000);
    });

    it('should handle 10000 listeners', () => {
      const emitter = createTypedEventEmitter<TestEvents>();

      for (let i = 0; i < 10000; i++) {
        emitter.on('test:event', () => {});
      }

      expect(emitter.listenerCount('test:event')).toBe(10000);
    });

    it('should handle rapid listener additions', () => {
      const emitter = createTypedEventEmitter<TestEvents>();
      const listener = () => {};

      for (let i = 0; i < 100; i++) {
        emitter.on('test:event', listener);
      }

      expect(emitter.listenerCount('test:event')).toBe(100);
    });

    it('should handle many unique event types', () => {
      const emitter = createTypedEventEmitter<TestEvents>();

      for (let i = 0; i < 500; i++) {
        emitter.on(`event:${i}`, () => {});
      }

      expect(emitter.eventNames().length).toBe(500);
    });
  });

  describe('High Volume Emission Operations', () => {
    it('should handle 1000 rapid emissions', async () => {
      const emitter = createTypedEventEmitter<TestEvents>();
      let emissionCount = 0;

      emitter.on('test:event', () => {
        emissionCount++;
      });

      const startTime = Date.now();

      for (let i = 0; i < 1000; i++) {
        await emitter.emit('test:event', { message: `test-${i}` });
      }

      const emitTime = Date.now() - startTime;

      expect(emissionCount).toBe(1000);
      expect(emitTime).toBeLessThan(5000);
    });

    it('should handle 10000 emissions', async () => {
      const emitter = createTypedEventEmitter<TestEvents>();
      let callCount = 0;

      emitter.on('test:event', () => {
        callCount++;
      });

      for (let i = 0; i < 10000; i++) {
        await emitter.emit('test:event', { message: 'test' });
      }

      expect(callCount).toBe(10000);
    });

    it('should handle emissions with no listeners efficiently', async () => {
      const emitter = createTypedEventEmitter<TestEvents>();

      const startTime = Date.now();

      for (let i = 0; i < 1000; i++) {
        await emitter.emit('test:event', { message: `test-${i}` });
      }

      const emitTime = Date.now() - startTime;

      expect(emitTime).toBeLessThan(1000);
    });
  });

  describe('Add/Remove Cycle Performance', () => {
    it('should handle 1000 add/remove cycles', () => {
      const emitter = createTypedEventEmitter<TestEvents>();
      const listener = () => {};

      const startTime = Date.now();

      for (let i = 0; i < 1000; i++) {
        emitter.on('test:event', listener);
        emitter.off('test:event', listener);
      }

      const cycleTime = Date.now() - startTime;

      expect(emitter.listenerCount('test:event')).toBe(0);
      expect(cycleTime).toBeLessThan(2000);
    });

    it('should handle frequent listener creation and cleanup', () => {
      const emitter = createTypedEventEmitter<TestEvents>();

      for (let cycle = 0; cycle < 100; cycle++) {
        for (let i = 0; i < 10; i++) {
          emitter.on(`batch:${cycle}`, () => {});
        }
        emitter.removeAllListeners(`batch:${cycle}`);
      }

      expect(emitter.eventNames().length).toBe(0);
    });

    it('should handle bulk operations efficiently', () => {
      const emitter = createTypedEventEmitter<TestEvents>();
      const listeners: Array<() => void> = [];

      for (let i = 0; i < 100; i++) {
        const listener = () => {};
        listeners.push(listener);
        emitter.on('test:event', listener);
      }

      const startTime = Date.now();
      emitter.removeAllListeners();
      const removeTime = Date.now() - startTime;

      expect(emitter.listenerCount('test:event')).toBe(0);
      expect(removeTime).toBeLessThan(500);
    });
  });

  describe('Multiple Event Types Performance', () => {
    it('should handle many different event types with listeners', () => {
      const emitter = createTypedEventEmitter<TestEvents>();

      for (let i = 0; i < 100; i++) {
        emitter.on(`event:${i}`, () => {});
        emitter.on(`event:${i}`, () => {});
        emitter.on(`event:${i}`, () => {});
      }

      for (let i = 0; i < 100; i++) {
        expect(emitter.listenerCount(`event:${i}`)).toBe(3);
      }
    });

    it('should handle emissions across many event types', async () => {
      const emitter = createTypedEventEmitter<TestEvents>();
      const callCounts: Record<string, number> = {};

      for (let i = 0; i < 50; i++) {
        const eventName = `multi:${i}`;
        callCounts[eventName] = 0;

        emitter.on(eventName, () => {
          callCounts[eventName]++;
        });
      }

      for (let i = 0; i < 50; i++) {
        await emitter.emit(`multi:${i}`, { message: `test-${i}` });
      }

      for (let i = 0; i < 50; i++) {
        expect(callCounts[`multi:${i}`]).toBe(1);
      }
    });
  });

  describe('Memory Efficiency Under Load', () => {
    it('should not grow memory under sustained listener operations', () => {
      const emitter = createTypedEventEmitter<TestEvents>();

      for (let i = 0; i < 50; i++) {
        const listener = () => {};
        emitter.on('sustained:event', listener);
        emitter.off('sustained:event', listener);
      }

      expect(emitter.listenerCount('sustained:event')).toBe(0);
      expect(emitter.eventNames()).toHaveLength(0);
    });

    it('should efficiently manage repeated emission patterns', async () => {
      const emitter = createTypedEventEmitter<TestEvents>();
      let totalCalls = 0;

      for (let batch = 0; batch < 10; batch++) {
        const listener = () => {
          totalCalls++;
        };

        emitter.on('pattern:event', listener);

        for (let i = 0; i < 100; i++) {
          await emitter.emit('pattern:event', { message: `batch-${batch}` });
        }

        emitter.off('pattern:event', listener);
      }

      expect(totalCalls).toBe(1000);
      expect(emitter.listenerCount('pattern:event')).toBe(0);
    });

    it('should handle concurrent operations efficiently', async () => {
      const emitter = createTypedEventEmitter<TestEvents>();
      const results: boolean[] = [];

      for (let i = 0; i < 10; i++) {
        emitter.on('concurrent:event', async () => {
          results.push(true);
        });
      }

      await emitter.emit('concurrent:event', { message: 'test' });

      expect(results.length).toBe(10);
    });
  });

  describe('Large Scale Operations', () => {
    it('should handle 10000 add operations across multiple events', () => {
      const emitter = createTypedEventEmitter<TestEvents>();

      for (let i = 0; i < 100; i++) {
        for (let j = 0; j < 100; j++) {
          emitter.on(`event:${i}`, () => {});
        }
      }

      for (let i = 0; i < 100; i++) {
        expect(emitter.listenerCount(`event:${i}`)).toBe(100);
      }
    });

    it('should handle bulk emissions efficiently', async () => {
      const emitter = createTypedEventEmitter<TestEvents>();
      let totalEmissions = 0;

      for (let i = 0; i < 20; i++) {
        emitter.on('bulk:event', () => {
          totalEmissions++;
        });
      }

      const emissions = 100;
      for (let i = 0; i < emissions; i++) {
        await emitter.emit('bulk:event', { message: `bulk-${i}` });
      }

      expect(totalEmissions).toBe(emissions * 20);
    });

    it('should scale reasonably with event count', () => {
      const emitter = createTypedEventEmitter<TestEvents>();

      const measureAddTime = (count: number) => {
        const start = Date.now();
        for (let i = 0; i < count; i++) {
          emitter.on(`scale:${i}`, () => {});
        }
        return Date.now() - start;
      };

      const time10 = measureAddTime(10);
      const time100 = measureAddTime(100);
      const time1000 = measureAddTime(1000);

      expect(time1000).toBeLessThan(5000);
      expect(time10).toBeLessThan(100);
    });
  });

  describe('Edge Case Performance', () => {
    it('should handle empty event names efficiently', () => {
      const emitter = createTypedEventEmitter<TestEvents>();

      for (let i = 0; i < 100; i++) {
        emitter.on('', () => {});
      }

      expect(emitter.listenerCount('')).toBe(100);
    });

    it('should handle very long event names', () => {
      const emitter = createTypedEventEmitter<TestEvents>();
      const longName = 'a'.repeat(1000);

      emitter.on(longName, () => {});

      expect(emitter.listenerCount(longName)).toBe(1);
    });

    it('should handle emitting to removed events', async () => {
      const emitter = createTypedEventEmitter<TestEvents>();
      let callCount = 0;

      const listener = () => {
        callCount++;
      };

      emitter.on('remove:event', listener);
      emitter.removeAllListeners('remove:event');

      await emitter.emit('remove:event', { message: 'test' });

      expect(callCount).toBe(0);
    });
  });
});
