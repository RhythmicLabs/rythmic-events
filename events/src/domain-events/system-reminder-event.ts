import { DomainEvent, type DomainEventJSON } from './index';
import { EventRegistry } from './event-registry';

export interface SystemReminderEventData {
  reminderId: string;
  prompt: string;
  context?: Record<string, unknown>;
  source: string;
  priority?: 'low' | 'medium' | 'high';
  timeout?: number;
  expectedResponseType?: string;
  userId?: string;
  sessionId?: string;
  metadata?: Record<string, unknown>;
}

export interface SystemReminderEventJSON extends DomainEventJSON {
  metadata: Record<string, unknown> & {
    reminderId: string;
    prompt: string;
    source: string;
    priority: 'low' | 'medium' | 'high';
    timeout: number;
  };
}

export class SystemReminderEvent extends DomainEvent {
  readonly reminderId: string;
  readonly prompt: string;
  readonly context?: Record<string, unknown>;
  readonly source: string;
  readonly priority: 'low' | 'medium' | 'high';
  readonly timeout: number;
  readonly expectedResponseType?: string;
  readonly userId?: string;
  readonly sessionId?: string;

  constructor(data: SystemReminderEventData) {
    const combinedMetadata: Record<string, unknown> = {
      ...data.metadata,
      reminderId: data.reminderId,
      prompt: data.prompt,
      context: data.context,
      source: data.source,
      priority: data.priority ?? 'medium',
      timeout: data.timeout ?? 30000,
      expectedResponseType: data.expectedResponseType,
      userId: data.userId,
      sessionId: data.sessionId,
    };
    super(
      'system.reminder',
      data.reminderId,
      data,
      data.reminderId,
      combinedMetadata
    );
    this.reminderId = data.reminderId;
    this.prompt = data.prompt;
    this.context = data.context;
    this.source = data.source;
    this.priority = data.priority ?? 'medium';
    this.timeout = data.timeout ?? 30000;
    this.expectedResponseType = data.expectedResponseType;
    this.userId = data.userId;
    this.sessionId = data.sessionId;
  }

  override toJSON(): SystemReminderEventJSON {
    const result = super.toJSON();
    return {
      ...result,
      metadata: {
        ...result.metadata,
        reminderId: this.reminderId,
        prompt: this.prompt,
        context: this.context,
        source: this.source,
        priority: this.priority,
        timeout: this.timeout,
        expectedResponseType: this.expectedResponseType,
        userId: this.userId,
        sessionId: this.sessionId,
      },
    };
  }

  static fromJSON(json: DomainEventJSON): SystemReminderEvent {
    const metadata = json.metadata as Record<string, unknown> | undefined;
    return new SystemReminderEvent({
      reminderId:
        (metadata?.reminderId as string) ?? json.aggregateId ?? json.id,
      prompt: (metadata?.prompt as string) ?? '',
      context: metadata?.context as Record<string, unknown> | undefined,
      source: (metadata?.source as string) ?? 'unknown',
      priority: (metadata?.priority as 'low' | 'medium' | 'high') ?? 'medium',
      timeout: (metadata?.timeout as number) ?? 30000,
      expectedResponseType: metadata?.expectedResponseType as
        | string
        | undefined,
      userId: metadata?.userId as string | undefined,
      sessionId: metadata?.sessionId as string | undefined,
    });
  }
}

// Register with EventRegistry for deserialization
EventRegistry.getInstance().register(
  'system.reminder',
  SystemReminderEvent.fromJSON
);
