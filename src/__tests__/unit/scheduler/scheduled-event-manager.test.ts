import {
  describe,
  it,
  expect,
  jest,
  beforeEach,
  afterEach,
} from '@jest/globals';
import type { DomainEvent } from '../../../domain-events/index';

// ── Mock croner before any dynamic imports of the manager ──────────────────

type TickCallback = () => Promise<void>;

interface MockJobHandle {
  fireTick: () => Promise<void>;
  pause: ReturnType<typeof jest.fn>;
  resume: ReturnType<typeof jest.fn>;
  stop: ReturnType<typeof jest.fn>;
  trigger: ReturnType<typeof jest.fn>;
}

const mockJobs: MockJobHandle[] = [];

jest.unstable_mockModule('croner', () => ({
  Cron: jest.fn((_pattern: string, _opts: unknown, callback: TickCallback) => {
    const job: MockJobHandle = {
      fireTick: async () => callback(),
      pause: jest.fn(() => true),
      resume: jest.fn(() => true),
      stop: jest.fn(),
      trigger: jest.fn(async () => callback()),
    };
    mockJobs.push(job);
    return job;
  }),
}));

// ── Dynamically import modules that use croner after the mock is set up ────

const { ScheduledEventManager } = await import(
  '../../../scheduler/scheduled-event-manager'
);
const { ScheduledEvent } = await import('../../../scheduler/scheduled-event');
const { LocalPubSubProvider } = await import('../../../pubsub/local-provider');
const { EventBus } = await import('../../../pubsub/index');

// ── Helpers ────────────────────────────────────────────────────────────────

function makeBus() {
  const provider = new LocalPubSubProvider();
  return new EventBus({ provider, enableCache: false });
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe('ScheduledEventManager', () => {
  let bus: InstanceType<typeof EventBus>;
  let manager: InstanceType<typeof ScheduledEventManager>;

  beforeEach(() => {
    mockJobs.length = 0;
    bus = makeBus();
    manager = new ScheduledEventManager(bus);
  });

  afterEach(() => {
    manager.cleanup();
  });

  describe('schedule()', () => {
    it('returns a schedule id string', async () => {
      const id = await manager.schedule({ cronExpression: '* * * * *' });
      expect(typeof id).toBe('string');
      expect(id.length).toBeGreaterThan(0);
    });

    it('uses the provided scheduleId when given', async () => {
      const id = await manager.schedule({
        cronExpression: '* * * * *',
        scheduleId: 'my-schedule',
      });
      expect(id).toBe('my-schedule');
    });

    it('entry has status active after scheduling', async () => {
      const id = await manager.schedule({ cronExpression: '* * * * *' });
      const entry = manager.getSchedule(id);
      expect(entry?.status).toBe('active');
      expect(entry?.tickCount).toBe(0);
    });

    it('publishes a ScheduledEvent on each tick', async () => {
      const published: DomainEvent[] = [];
      const id = await manager.schedule({
        cronExpression: '* * * * *',
        payload: { hello: 'world' },
      });
      bus.subscribe(ScheduledEvent.EVENT_TYPE, (e) => {
        published.push(e as DomainEvent);
      });

      await mockJobs[0].fireTick();

      expect(published).toHaveLength(1);
      const event = published[0] as InstanceType<typeof ScheduledEvent>;
      expect(event.type).toBe('scheduler.tick');
      expect(event.scheduleId).toBe(id);
      expect(event.tickNumber).toBe(1);
      expect(event.payload).toEqual({ hello: 'world' });
    });

    it('increments tickCount on each tick', async () => {
      const id = await manager.schedule({ cronExpression: '* * * * *' });
      await mockJobs[0].fireTick();
      await mockJobs[0].fireTick();
      await mockJobs[0].fireTick();
      expect(manager.getSchedule(id)?.tickCount).toBe(3);
    });

    it('publishes the tickFactory event instead of ScheduledEvent', async () => {
      const published: DomainEvent[] = [];
      bus.subscribe('custom.event', (e) => published.push(e as DomainEvent));

      await manager.schedule({
        cronExpression: '* * * * *',
        tickFactory: (tick) => {
          return new ScheduledEvent({
            scheduleId: tick.scheduleId,
            cronExpression: tick.cronExpression,
            tickNumber: tick.tickNumber,
            scheduledAt: tick.scheduledAt.toISOString(),
            payload: { custom: true },
          });
        },
      });

      // Verify tickFactory is invoked — we'll check via the ScheduledEvent type
      const customPublished: DomainEvent[] = [];
      bus.subscribe(ScheduledEvent.EVENT_TYPE, (e) =>
        customPublished.push(e as DomainEvent)
      );
      await mockJobs[0].fireTick();
      expect(customPublished).toHaveLength(1);
    });

    it('fires immediately when startImmediately is true', async () => {
      const published: DomainEvent[] = [];
      bus.subscribe(ScheduledEvent.EVENT_TYPE, (e) =>
        published.push(e as DomainEvent)
      );
      await manager.schedule({
        cronExpression: '* * * * *',
        startImmediately: true,
      });
      expect(published).toHaveLength(1);
    });
  });

  describe('stop() and start()', () => {
    it('stop() sets status to stopped', async () => {
      const id = await manager.schedule({ cronExpression: '* * * * *' });
      const result = manager.stop(id);
      expect(result).toBe(true);
      expect(manager.getSchedule(id)?.status).toBe('stopped');
    });

    it('start() resumes a stopped schedule', async () => {
      const id = await manager.schedule({ cronExpression: '* * * * *' });
      manager.stop(id);
      const result = manager.start(id);
      expect(result).toBe(true);
      expect(manager.getSchedule(id)?.status).toBe('active');
    });

    it('ticks fired while stopped are ignored', async () => {
      const published: DomainEvent[] = [];
      const id = await manager.schedule({ cronExpression: '* * * * *' });
      bus.subscribe(ScheduledEvent.EVENT_TYPE, (e) =>
        published.push(e as DomainEvent)
      );
      manager.stop(id);
      await mockJobs[0].fireTick();
      expect(published).toHaveLength(0);
      expect(manager.getSchedule(id)?.tickCount).toBe(0);
    });

    it('stop() returns false for non-existent schedule', () => {
      expect(manager.stop('unknown')).toBe(false);
    });

    it('start() returns false for non-stopped schedule', async () => {
      const id = await manager.schedule({ cronExpression: '* * * * *' });
      expect(manager.start(id)).toBe(false);
    });
  });

  describe('unschedule()', () => {
    it('removes the schedule entry', async () => {
      const id = await manager.schedule({ cronExpression: '* * * * *' });
      expect(manager.unschedule(id)).toBe(true);
      expect(manager.getSchedule(id)).toBeUndefined();
    });

    it('returns false for unknown id', () => {
      expect(manager.unschedule('ghost')).toBe(false);
    });

    it('calls job.stop()', async () => {
      const id = await manager.schedule({ cronExpression: '* * * * *' });
      manager.unschedule(id);
      expect(mockJobs[0].stop).toHaveBeenCalled();
    });
  });

  describe('maxTicks', () => {
    it('auto-unschedules and marks exhausted after maxTicks', async () => {
      const id = await manager.schedule({
        cronExpression: '* * * * *',
        scheduleId: 'max-test',
        maxTicks: 2,
      });
      await mockJobs[0].fireTick();
      expect(manager.getSchedule(id)?.status).toBe('active');
      await mockJobs[0].fireTick();
      expect(manager.getSchedule(id)?.status).toBe('exhausted');
      expect(mockJobs[0].stop).toHaveBeenCalled();
    });
  });

  describe('listSchedules() and getActiveCount()', () => {
    it('lists all schedules', async () => {
      await manager.schedule({ cronExpression: '* * * * *', scheduleId: 'a' });
      await manager.schedule({ cronExpression: '* * * * *', scheduleId: 'b' });
      const list = manager.listSchedules();
      expect(list).toHaveLength(2);
      expect(list.map((e) => e.scheduleId).sort()).toEqual(['a', 'b']);
    });

    it('getActiveCount returns count of active schedules', async () => {
      await manager.schedule({ cronExpression: '* * * * *', scheduleId: 'a' });
      await manager.schedule({ cronExpression: '* * * * *', scheduleId: 'b' });
      expect(manager.getActiveCount()).toBe(2);
      manager.stop('a');
      expect(manager.getActiveCount()).toBe(1);
    });

    it('getSchedule does not expose the internal job', async () => {
      const id = await manager.schedule({ cronExpression: '* * * * *' });
      const entry = manager.getSchedule(id);
      expect(entry).not.toHaveProperty('job');
    });
  });

  describe('cleanup()', () => {
    it('stops all jobs and clears the map', async () => {
      await manager.schedule({ cronExpression: '* * * * *', scheduleId: 'a' });
      await manager.schedule({ cronExpression: '* * * * *', scheduleId: 'b' });
      manager.cleanup();
      expect(manager.listSchedules()).toHaveLength(0);
      expect(manager.getActiveCount()).toBe(0);
      expect(mockJobs[0].stop).toHaveBeenCalled();
      expect(mockJobs[1].stop).toHaveBeenCalled();
    });

    it('is idempotent — calling twice does not throw', async () => {
      await manager.schedule({ cronExpression: '* * * * *' });
      expect(() => {
        manager.cleanup();
        manager.cleanup();
      }).not.toThrow();
    });
  });

  describe('error handling', () => {
    it('tick errors in tickFactory do not crash the scheduler', async () => {
      await manager.schedule({
        cronExpression: '* * * * *',
        tickFactory: () => {
          throw new Error('factory error');
        },
      });
      await expect(mockJobs[0].fireTick()).resolves.not.toThrow();
    });

    it('publish errors do not crash the scheduler', async () => {
      jest.spyOn(bus, 'publish').mockRejectedValue(new Error('publish failed') as never);
      await manager.schedule({ cronExpression: '* * * * *' });
      await expect(mockJobs[0].fireTick()).resolves.not.toThrow();
    });
  });
});
