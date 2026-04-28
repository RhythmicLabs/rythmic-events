import type { DomainEvent } from '../domain-events/index';

export interface QueryCriteria {
  eventType?: string;
  limit?: number;
  before?: Date;
  after?: Date;
  aggregateId?: string;
}

export interface StorageOptions {
  autoConnect?: boolean;
  retry?: {
    attempts: number;
    delay: number;
  };
}

export interface EventStorage {
  save(event: DomainEvent): Promise<void>;
  load(eventId: string): Promise<DomainEvent | null>;
  delete(eventId: string): Promise<boolean>;
  query(criteria: QueryCriteria): Promise<DomainEvent[]>;
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  isConnected(): boolean;
  healthCheck(): Promise<boolean>;
}
