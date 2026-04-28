import type { DomainEvent } from '../domain-events/index';

export interface SuspensionRequest<
  TReq extends DomainEvent,
  TResp extends DomainEvent,
> {
  correlationId: string;
  requestEvent: TReq;
  responseEventType: string;
  correlationExtractor?: (event: TResp) => string;
  timeout?: number;
}

export interface SuspensionOptions {
  timeout?: number;
  correlationExtractor?: <TResp extends DomainEvent>(event: TResp) => string;
}

export type SuspensionStatus = 'pending' | 'resolved' | 'timeout' | 'cancelled';

export interface SuspensionResult<TResp extends DomainEvent> {
  response: TResp;
  waitTime: number;
}

export interface PendingSuspension<TResp extends DomainEvent> {
  resolve: (result: SuspensionResult<TResp>) => void;
  reject: (reason: Error) => void;
  timeout: ReturnType<typeof setTimeout>;
  startTime: number;
  responseEventType: string;
  correlationExtractor?: (event: TResp) => string;
  unsubscribe: () => void;
}
