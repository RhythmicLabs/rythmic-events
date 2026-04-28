import {
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
  jest,
} from '@jest/globals';
import {
  TypedEventEmitter,
  createTypedEventEmitter,
  type TypedEventMap,
  type EventListener,
} from '../../../event-emitter/index';

describe('TypedEventEmitter', () => {
  let emitter: TypedEventEmitter<TestEvents>;

  interface TestEvents extends TypedEventMap {
    'test:event': { message: string };
    'test:number': { value: number };
    'test:object': { data: { nested: string } };
  }

  beforeEach(() => {
    emitter = createTypedEventEmitter<TestEvents>();
  });

  afterEach(() => {
    emitter.removeAllListeners();
  });

  describe('constructor', () => {
    it('should create emitter with no listeners', () => {
      const testEmitter = createTypedEventEmitter<TestEvents>();
      expect(testEmitter.listenerCount('test:event')).toBe(0);
      expect(testEmitter.eventNames()).toHaveLength(0);
    });
  });

  describe('on', () => {
    it('should add event listener', () => {
      const listener = jest.fn();
      emitter.on('test:event', listener);

      expect(emitter.listenerCount('test:event')).toBe(1);
      expect(emitter.eventNames()).toContain('test:event');
    });

    it('should add multiple listeners for same event', () => {
      const listener1 = jest.fn();
      const listener2 = jest.fn();

      emitter.on('test:event', listener1);
      emitter.on('test:event', listener2);

      expect(emitter.listenerCount('test:event')).toBe(2);
    });

    it('should return emitter for chaining', () => {
      const listener = jest.fn();
      const result = emitter.on('test:event', listener);
      expect(result).toBe(emitter);
    });
  });

  describe('once', () => {
    it('should add one-time listener', () => {
      const listener = jest.fn();
      emitter.once('test:event', listener);

      expect(emitter.listenerCount('test:event')).toBe(1);
    });

    it('should remove listener after first emission', async () => {
      const listener = jest.fn();
      emitter.once('test:event', listener);

      await emitter.emit('test:event', { message: 'test1' });
      await emitter.emit('test:event', { message: 'test2' });

      expect(listener).toHaveBeenCalledTimes(1);
      expect(listener).toHaveBeenCalledWith({ message: 'test1' });
      expect(emitter.listenerCount('test:event')).toBe(0);
    });

    it('should return emitter for chaining', () => {
      const listener = jest.fn();
      const result = emitter.once('test:event', listener);
      expect(result).toBe(emitter);
    });
  });

  describe('off', () => {
    it('should remove specific listener', () => {
      const listener1 = jest.fn();
      const listener2 = jest.fn();

      emitter.on('test:event', listener1);
      emitter.on('test:event', listener2);
      emitter.off('test:event', listener1);

      expect(emitter.listenerCount('test:event')).toBe(1);
    });

    it('should not affect other listeners', () => {
      const listener1 = jest.fn();
      const listener2 = jest.fn();

      emitter.on('test:event', listener1);
      emitter.on('test:number', listener2);
      emitter.off('test:event', listener1);

      expect(emitter.listenerCount('test:event')).toBe(0);
      expect(emitter.listenerCount('test:number')).toBe(1);
    });

    it('should return emitter for chaining', () => {
      const listener = jest.fn();
      emitter.on('test:event', listener);
      const result = emitter.off('test:event', listener);
      expect(result).toBe(emitter);
    });
  });

  describe('emit', () => {
    it('should emit events to listeners', async () => {
      const listener = jest.fn();
      emitter.on('test:event', listener);

      const result = await emitter.emit('test:event', { message: 'test' });

      expect(result).toBe(true);
      expect(listener).toHaveBeenCalledTimes(1);
      expect(listener).toHaveBeenCalledWith({ message: 'test' });
    });

    it('should emit to multiple listeners', async () => {
      const listener1 = jest.fn();
      const listener2 = jest.fn();

      emitter.on('test:event', listener1);
      emitter.on('test:event', listener2);

      const result = await emitter.emit('test:event', { message: 'test' });

      expect(result).toBe(true);
      expect(listener1).toHaveBeenCalledWith({ message: 'test' });
      expect(listener2).toHaveBeenCalledWith({ message: 'test' });
    });

    it('should emit to correct event type only', async () => {
      const eventListener = jest.fn();
      const numberListener = jest.fn();

      emitter.on('test:event', eventListener);
      emitter.on('test:number', numberListener);

      await emitter.emit('test:event', { message: 'test' });

      expect(eventListener).toHaveBeenCalledTimes(1);
      expect(numberListener).not.toHaveBeenCalled();
    });

    it('should return false if no listeners', async () => {
      const result = await emitter.emit('test:event', { message: 'test' });
      expect(result).toBe(false);
    });

    it('should handle complex object data', async () => {
      const listener = jest.fn();
      emitter.on('test:object', listener);

      const complexData = { data: { nested: 'value' } };
      await emitter.emit('test:object', complexData);

      expect(listener).toHaveBeenCalledWith(complexData);
    });
  });

  describe('removeAllListeners', () => {
    it('should remove all listeners for specific event', () => {
      emitter.on('test:event', jest.fn());
      emitter.on('test:number', jest.fn());

      emitter.removeAllListeners('test:event');

      expect(emitter.listenerCount('test:event')).toBe(0);
      expect(emitter.listenerCount('test:number')).toBe(1);
    });

    it('should remove all listeners for all events', () => {
      emitter.on('test:event', jest.fn());
      emitter.on('test:number', jest.fn());

      emitter.removeAllListeners();

      expect(emitter.listenerCount('test:event')).toBe(0);
      expect(emitter.listenerCount('test:number')).toBe(0);
      expect(emitter.eventNames()).toHaveLength(0);
    });

    it('should return emitter for chaining', () => {
      emitter.on('test:event', jest.fn());
      const result = emitter.removeAllListeners('test:event');
      expect(result).toBe(emitter);
    });
  });

  describe('listenerCount', () => {
    it('should return correct listener count', () => {
      expect(emitter.listenerCount('test:event')).toBe(0);

      emitter.on('test:event', jest.fn());
      expect(emitter.listenerCount('test:event')).toBe(1);

      emitter.on('test:event', jest.fn());
      expect(emitter.listenerCount('test:event')).toBe(2);

      emitter.on('test:event', jest.fn());
      expect(emitter.listenerCount('test:event')).toBe(3);
    });

    it('should return 0 for non-existent events', () => {
      expect(emitter.listenerCount('non:existent')).toBe(0);
    });
  });

  describe('eventNames', () => {
    it('should return list of events with listeners', () => {
      expect(emitter.eventNames()).toHaveLength(0);

      emitter.on('test:event', jest.fn());
      const names1 = emitter.eventNames();
      expect(names1).toContain('test:event');
      expect(names1).toHaveLength(1);

      emitter.on('test:number', jest.fn());
      emitter.on('test:object', jest.fn());
      const names2 = emitter.eventNames();
      expect(names2).toContain('test:event');
      expect(names2).toContain('test:number');
      expect(names2).toContain('test:object');
      expect(names2).toHaveLength(3);
    });

    it('should return array with proper type', () => {
      emitter.on('test:event', jest.fn());
      const names = emitter.eventNames();
      expect(Array.isArray(names)).toBe(true);
      expect(names).toEqual(expect.any(Array));
    });
  });

  describe('error handling', () => {
    it('should handle listener errors gracefully', async () => {
      const error = new Error('Test error');
      const listener = jest.fn().mockImplementation(() => {
        throw error;
      });

      const goodListener = jest.fn();
      emitter.on('test:event', listener);
      emitter.on('test:event', goodListener);

      // Should not throw
      const result = await emitter.emit('test:event', { message: 'test' });

      expect(result).toBe(true);
      expect(listener).toHaveBeenCalled();
      expect(goodListener).toHaveBeenCalled();
    });

    it('should handle async listener errors', async () => {
      const error = new Error('Async error');
      const listener = jest.fn().mockImplementation(async () => {
        throw error;
      });

      emitter.on('test:event', listener);

      // Should not throw
      const result = await emitter.emit('test:event', { message: 'test' });

      expect(result).toBe(true);
    });
  });

  describe('type safety', () => {
    it('should enforce type safety for event data', () => {
      const listener = jest.fn();
      emitter.on('test:event', (data) => {
        listener();
        // TypeScript should infer data type correctly
        expect(data.message).toBe('test');
      });

      emitter.emit('test:event', { message: 'test' });
      expect(listener).toHaveBeenCalled();
    });
  });
});
