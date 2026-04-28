import type { DomainEvent } from '../domain-events/index';

export interface ScheduledTick {
  scheduleId: string;
  tickNumber: number;
  scheduledAt: Date;
  cronExpression: string;
}

export type ScheduledTickFactory = (tick: ScheduledTick) => DomainEvent;

export interface ScheduleDescriptor<TData = unknown> {
  cronExpression: string;
  scheduleId?: string;
  name?: string;
  payload?: TData;
  tickFactory?: ScheduledTickFactory;
  timezone?: string;
  startImmediately?: boolean;
  maxTicks?: number;
  metadata?: Record<string, unknown>;
}

export type ScheduleStatus = 'active' | 'stopped' | 'exhausted';

export interface ScheduleEntry {
  scheduleId: string;
  descriptor: Readonly<ScheduleDescriptor>;
  status: ScheduleStatus;
  tickCount: number;
  createdAt: Date;
  lastFiredAt?: Date;
}
