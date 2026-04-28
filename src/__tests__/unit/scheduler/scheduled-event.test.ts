import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import { EventRegistry } from '../../../domain-events/event-registry';
import {
  ScheduledEvent,
  type ScheduledEventData,
} from '../../../scheduler/scheduled-event';

const baseData: ScheduledEventData = {
  scheduleId: 'sched-123',
  cronExpression: '* * * * *',
  tickNumber: 1,
  scheduledAt: '2024-01-15T10:00:00.000Z',
  payload: { task: 'cleanup' },
};

describe('ScheduledEvent', () => {
  describe('constructor', () => {
    it('sets all fields from data', () => {
      const event = new ScheduledEvent(baseData);

      expect(event.type).toBe('scheduler.tick');
      expect(event.scheduleId).toBe('sched-123');
      expect(event.cronExpression).toBe('* * * * *');
      expect(event.tickNumber).toBe(1);
      expect(event.scheduledAt).toEqual(new Date('2024-01-15T10:00:00.000Z'));
      expect(event.payload).toEqual({ task: 'cleanup' });
      expect(event.aggregateId).toBe('sched-123');
    });

    it('generates a unique id for each instance', () => {
      const e1 = new ScheduledEvent(baseData);
      const e2 = new ScheduledEvent(baseData);
      expect(e1.id).not.toBe(e2.id);
    });

    it('occurredOn is a Date set at construction time', () => {
      const before = new Date();
      const event = new ScheduledEvent(baseData);
      const after = new Date();
      expect(event.occurredOn.getTime()).toBeGreaterThanOrEqual(before.getTime());
      expect(event.occurredOn.getTime()).toBeLessThanOrEqual(after.getTime());
    });

    it('payload is undefined when not provided', () => {
      const event = new ScheduledEvent({ ...baseData, payload: undefined });
      expect(event.payload).toBeUndefined();
    });
  });

  describe('EVENT_TYPE', () => {
    it('is scheduler.tick', () => {
      expect(ScheduledEvent.EVENT_TYPE).toBe('scheduler.tick');
    });
  });

  describe('toJSON / fromJSON round-trip', () => {
    it('reconstructs an equivalent event', () => {
      const original = new ScheduledEvent(baseData);
      const json = original.toJSON();
      const restored = ScheduledEvent.fromJSON(json);

      expect(restored.scheduleId).toBe(original.scheduleId);
      expect(restored.cronExpression).toBe(original.cronExpression);
      expect(restored.tickNumber).toBe(original.tickNumber);
      expect(restored.scheduledAt.toISOString()).toBe(
        original.scheduledAt.toISOString()
      );
      expect(restored.payload).toEqual(original.payload);
      expect(restored.type).toBe('scheduler.tick');
    });

    it('scheduledAt survives as ISO string through JSON', () => {
      const event = new ScheduledEvent(baseData);
      const json = event.toJSON();
      const data = json.data as ScheduledEventData;
      expect(typeof data.scheduledAt).toBe('string');
      expect(data.scheduledAt).toBe('2024-01-15T10:00:00.000Z');
    });
  });
});

describe('ScheduledEvent EventRegistry integration', () => {
  beforeEach(() => {
    EventRegistry.resetInstance();
    // Re-register since ES module caching prevents the side-effect from re-running
    EventRegistry.getInstance().register(
      ScheduledEvent.EVENT_TYPE,
      ScheduledEvent.fromJSON
    );
  });

  afterEach(() => {
    EventRegistry.resetInstance();
  });

  it('has the correct event type registered', () => {
    expect(EventRegistry.getInstance().has('scheduler.tick')).toBe(true);
  });

  it('deserializes via EventRegistry back to ScheduledEvent', () => {
    const event = new ScheduledEvent(baseData);
    const json = event.toJSON();
    const restored = EventRegistry.getInstance().deserialize(json);
    expect(restored.type).toBe('scheduler.tick');
    expect((restored as ScheduledEvent).scheduleId).toBe('sched-123');
    expect((restored as ScheduledEvent).tickNumber).toBe(1);
  });
});
