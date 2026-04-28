import { EventBus } from '../pubsub/index';
import { SuspensionManager } from '../suspension/index';
import { SystemReminderEvent } from '../domain-events/system-reminder-event';
import { SystemReminderResponseEvent } from '../domain-events/system-reminder-response-event';
import type { PubSubProvider } from '../pubsub/provider';

export interface ReminderOptions {
  timeout?: number;
  priority?: 'low' | 'medium' | 'high';
  source?: string;
  userId?: string;
  sessionId?: string;
  expectedResponseType?: string;
}

export interface ReminderHandlerOptions {
  filter?: (event: SystemReminderEvent) => boolean;
  autoRespond?: boolean;
  responseGenerator?: (event: SystemReminderEvent) => unknown;
}

export class ReminderManager {
  private eventBus: EventBus;
  private suspensionManager: SuspensionManager;
  private subscriptionIds: string[] = [];

  constructor(eventBus: EventBus, provider?: PubSubProvider) {
    this.eventBus = eventBus;
    if (!provider) {
      throw new Error('Provider must be supplied to ReminderManager');
    }
    this.suspensionManager = new SuspensionManager(provider);
  }

  async sendPrompt(
    prompt: string,
    context?: Record<string, unknown>,
    options: ReminderOptions = {}
  ): Promise<{
    reminderId: string;
    response: unknown;
    waitTime: number;
  }> {
    const reminderId = this.generateReminderId();
    const reminderEvent = new SystemReminderEvent({
      reminderId,
      prompt,
      context,
      source: options.source ?? 'ReminderManager',
      priority: options.priority ?? 'medium',
      timeout: options.timeout ?? 30000,
      expectedResponseType: options.expectedResponseType,
      userId: options.userId,
      sessionId: options.sessionId,
    });

    // Publish the reminder event
    await this.eventBus.publish(reminderEvent);

    // Wait for response using suspension manager
    const result = await this.suspensionManager.suspendForResponse(
      reminderEvent,
      'system.reminder.response',
      reminderId,
      { timeout: options.timeout }
    );

    return {
      reminderId,
      response: (result.response as SystemReminderResponseEvent).response,
      waitTime: result.waitTime,
    };
  }

  onReminder(
    handler: (event: SystemReminderEvent) => void | Promise<void>,
    options: ReminderHandlerOptions = {}
  ): string {
    const subscriptionId = this.eventBus.subscribe(
      'system.reminder',
      async (event: unknown) => {
        const reminderEvent = event as SystemReminderEvent;

        // Apply filter if provided
        if (options.filter && !options.filter(reminderEvent)) {
          return;
        }

        // Call the handler
        await handler(reminderEvent);

        // Auto-respond if enabled
        if (options.autoRespond && options.responseGenerator) {
          const response = options.responseGenerator(reminderEvent);
          await this.completeReminder(reminderEvent.reminderId, response);
        }
      }
    );

    this.subscriptionIds.push(subscriptionId);
    return subscriptionId;
  }

  async completeReminder(
    reminderId: string,
    response: unknown,
    status: 'success' | 'error' | 'partial' = 'success',
    options: {
      processingTime?: number;
      error?: string;
      partialData?: Record<string, unknown>;
      confidence?: number;
    } = {}
  ): Promise<void> {
    const responseEvent = new SystemReminderResponseEvent({
      reminderId,
      response,
      status,
      processingTime: options.processingTime,
      error: options.error,
      partialData: options.partialData,
      confidence: options.confidence,
    });

    await this.eventBus.publish(responseEvent);
  }

  async cancelReminder(reminderId: string): Promise<boolean> {
    return this.suspensionManager.cancel(reminderId);
  }

  async cancelAllReminders(): Promise<number> {
    return this.suspensionManager.cancelAll();
  }

  getPendingReminderCount(): number {
    return this.suspensionManager.getPendingCount();
  }

  isPending(reminderId: string): boolean {
    return this.suspensionManager.isPending(reminderId);
  }

  getPendingReminderIds(): string[] {
    return this.suspensionManager.getPendingCorrelationIds();
  }

  async cleanup(): Promise<void> {
    // Unsubscribe all reminder handlers
    for (const subscriptionId of this.subscriptionIds) {
      this.eventBus.unsubscribe(subscriptionId);
    }
    this.subscriptionIds = [];

    // Cancel all pending suspensions
    await this.cancelAllReminders();
  }

  private generateReminderId(): string {
    return `reminder_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }
}
