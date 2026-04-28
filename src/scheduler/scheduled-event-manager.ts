import { randomUUID } from 'node:crypto';
import type { EventBus } from '../pubsub/index';
import { ScheduledEvent } from './scheduled-event';
import type {
  ScheduleDescriptor,
  ScheduleEntry,
  ScheduleStatus,
  ScheduledTick,
} from './scheduler-types';

type InternalEntry = ScheduleEntry & {
  job: {
    pause(): boolean;
    resume(): boolean;
    stop(): void;
    trigger(): Promise<void>;
  };
};

export class ScheduledEventManager {
  private readonly schedules: Map<string, InternalEntry> = new Map();

  constructor(private readonly bus: EventBus) {}

  async schedule<TData = unknown>(
    descriptor: ScheduleDescriptor<TData>
  ): Promise<string> {
    const { Cron } = await import('croner').catch(() => {
      throw new Error(
        'croner is required for ScheduledEventManager. Install it: npm install croner'
      );
    });

    const scheduleId = descriptor.scheduleId ?? `schedule_${randomUUID()}`;

    const entry: InternalEntry = {
      scheduleId,
      descriptor: Object.freeze({ ...descriptor }),
      status: 'active' as ScheduleStatus,
      tickCount: 0,
      createdAt: new Date(),
      lastFiredAt: undefined,
      job: null as unknown as InternalEntry['job'],
    };

    const job = new Cron(
      descriptor.cronExpression,
      {
        timezone: descriptor.timezone,
        unref: true,
        catch: true,
      },
      async () => {
        const current = this.schedules.get(scheduleId);
        if (!current || current.status !== 'active') return;

        const now = new Date();
        current.tickCount++;
        current.lastFiredAt = now;

        const tick: ScheduledTick = {
          scheduleId,
          tickNumber: current.tickCount,
          scheduledAt: now,
          cronExpression: descriptor.cronExpression,
        };

        let event;
        try {
          event = descriptor.tickFactory
            ? descriptor.tickFactory(tick)
            : new ScheduledEvent({
                scheduleId,
                cronExpression: descriptor.cronExpression,
                tickNumber: current.tickCount,
                scheduledAt: now.toISOString(),
                payload: descriptor.payload,
                metadata: descriptor.metadata,
              });
        } catch {
          return;
        }

        await this.bus.publish(event).catch(() => {});

        if (
          descriptor.maxTicks !== undefined &&
          current.tickCount >= descriptor.maxTicks
        ) {
          current.status = 'exhausted';
          current.job.stop();
        }
      }
    );

    entry.job = job;
    this.schedules.set(scheduleId, entry);

    if (descriptor.startImmediately) {
      await job.trigger().catch(() => {});
    }

    return scheduleId;
  }

  unschedule(scheduleId: string): boolean {
    const entry = this.schedules.get(scheduleId);
    if (!entry) return false;
    entry.job.stop();
    this.schedules.delete(scheduleId);
    return true;
  }

  stop(scheduleId: string): boolean {
    const entry = this.schedules.get(scheduleId);
    if (!entry || entry.status !== 'active') return false;
    entry.job.pause();
    entry.status = 'stopped';
    return true;
  }

  start(scheduleId: string): boolean {
    const entry = this.schedules.get(scheduleId);
    if (!entry || entry.status !== 'stopped') return false;
    const resumed = entry.job.resume();
    if (resumed) {
      entry.status = 'active';
    }
    return resumed;
  }

  getSchedule(scheduleId: string): ScheduleEntry | undefined {
    const entry = this.schedules.get(scheduleId);
    if (!entry) return undefined;
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { job: _, ...publicEntry } = entry;
    return publicEntry;
  }

  listSchedules(): ScheduleEntry[] {
    return Array.from(this.schedules.values()).map(
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      ({ job: _, ...entry }) => entry
    );
  }

  getActiveCount(): number {
    let count = 0;
    for (const entry of this.schedules.values()) {
      if (entry.status === 'active') count++;
    }
    return count;
  }

  cleanup(): void {
    for (const entry of this.schedules.values()) {
      entry.job.stop();
    }
    this.schedules.clear();
  }
}
