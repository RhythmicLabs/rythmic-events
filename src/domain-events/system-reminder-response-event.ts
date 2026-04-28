import { DomainEvent, type DomainEventJSON } from './index';
import { EventRegistry } from './event-registry';

export interface SystemReminderResponseEventData {
  reminderId: string;
  response: unknown;
  status: 'success' | 'error' | 'partial';
  processingTime?: number;
  error?: string;
  partialData?: Record<string, unknown>;
  confidence?: number;
  metadata?: Record<string, unknown>;
}

export interface SystemReminderResponseEventJSON extends DomainEventJSON {
  metadata: Record<string, unknown> & {
    reminderId: string;
    status: 'success' | 'error' | 'partial';
    processingTime?: number;
    error?: string;
    partialData?: Record<string, unknown>;
    confidence?: number;
  };
}

export class SystemReminderResponseEvent extends DomainEvent {
  readonly reminderId: string;
  readonly response: unknown;
  readonly status: 'success' | 'error' | 'partial';
  readonly processingTime?: number;
  readonly error?: string;
  readonly partialData?: Record<string, unknown>;
  readonly confidence?: number;

  constructor(data: SystemReminderResponseEventData) {
    const combinedMetadata: Record<string, unknown> = {
      ...data.metadata,
      reminderId: data.reminderId,
      status: data.status,
      processingTime: data.processingTime,
      error: data.error,
      partialData: data.partialData,
      confidence: data.confidence,
    };
    super('system.reminder.response', data.reminderId, combinedMetadata);
    this.reminderId = data.reminderId;
    this.response = data.response;
    this.status = data.status;
    this.processingTime = data.processingTime;
    this.error = data.error;
    this.partialData = data.partialData;
    this.confidence = data.confidence;
  }

  override toJSON(): SystemReminderResponseEventJSON {
    const result = super.toJSON();
    return {
      ...result,
      metadata: {
        ...result.metadata,
        reminderId: this.reminderId,
        status: this.status,
        processingTime: this.processingTime,
        error: this.error,
        partialData: this.partialData,
        confidence: this.confidence,
      },
    };
  }

  static fromJSON(json: DomainEventJSON): SystemReminderResponseEvent {
    const metadata = json.metadata as Record<string, unknown> | undefined;
    return new SystemReminderResponseEvent({
      reminderId:
        (metadata?.reminderId as string) ?? json.aggregateId ?? json.id,
      response: metadata?.response,
      status:
        (metadata?.status as 'success' | 'error' | 'partial') ?? 'success',
      processingTime: metadata?.processingTime as number | undefined,
      error: metadata?.error as string | undefined,
      partialData: metadata?.partialData as Record<string, unknown> | undefined,
      confidence: metadata?.confidence as number | undefined,
    });
  }
}

// Register with EventRegistry for deserialization
EventRegistry.getInstance().register(
  'system.reminder.response',
  SystemReminderResponseEvent.fromJSON
);
