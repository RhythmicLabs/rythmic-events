import type { DomainEvent } from '../domain-events/index';
import type { PubSubProvider } from '../pubsub/provider';
import type {
  SuspensionOptions,
  SuspensionResult,
  SuspensionStatus,
  PendingSuspension,
} from './suspension-types';

export class SuspensionManager {
  private pendingSuspensions: Map<string, PendingSuspension<DomainEvent>> =
    new Map();
  private provider: PubSubProvider;
  private defaultTimeout: number = 30000; // 30 seconds default

  constructor(provider: PubSubProvider, defaultTimeout?: number) {
    this.provider = provider;
    if (defaultTimeout) {
      this.defaultTimeout = defaultTimeout;
    }
  }

  async suspendForResponse<TReq extends DomainEvent, TResp extends DomainEvent>(
    requestEvent: TReq,
    responseEventType: string,
    correlationId: string,
    options: SuspensionOptions = {}
  ): Promise<SuspensionResult<TResp>> {
    const timeout = options.timeout ?? this.defaultTimeout;
    const correlationExtractor =
      options.correlationExtractor ?? this.defaultCorrelationExtractor;

    return new Promise<SuspensionResult<TResp>>((resolve, reject) => {
      // Set up timeout
      const timeoutHandle = setTimeout(() => {
        this.cleanup(correlationId);
        reject(new Error(`Suspension timed out after ${timeout}ms`));
      }, timeout);

      // Set up response listener BEFORE publishing to prevent race conditions
      const unsubscribe = this.provider.subscribe(
        responseEventType,
        async (event: unknown) => {
          const responseEvent = event as TResp;
          const extractedId = correlationExtractor(responseEvent);

          if (extractedId === correlationId) {
            const startTime = Date.now();
            const waitTime = Date.now() - startTime;

            // Clean up timeout and subscription
            clearTimeout(timeoutHandle);
            this.cleanup(correlationId);

            // Resolve with the response
            resolve({
              response: responseEvent,
              waitTime,
            });
          }
        }
      );

      // Store the pending suspension
      const pending: PendingSuspension<TResp> = {
        resolve: resolve as (result: SuspensionResult<DomainEvent>) => void,
        reject,
        timeout: timeoutHandle,
        startTime: Date.now(),
        responseEventType,
        correlationExtractor,
        unsubscribe,
      };

      this.pendingSuspensions.set(
        correlationId,
        pending as PendingSuspension<DomainEvent>
      );
    });
  }

  resolve<TResp extends DomainEvent>(
    correlationId: string,
    responseEvent: TResp
  ): boolean {
    const pending = this.pendingSuspensions.get(correlationId);
    if (!pending) {
      return false;
    }

    const waitTime = Date.now() - pending.startTime;
    const result: SuspensionResult<TResp> = {
      response: responseEvent,
      waitTime,
    };

    // Clean up timeout and subscription
    clearTimeout(pending.timeout);
    pending.unsubscribe();
    this.pendingSuspensions.delete(correlationId);

    // Resolve the promise
    pending.resolve(result as SuspensionResult<DomainEvent>);
    return true;
  }

  cancel(correlationId: string): boolean {
    const pending = this.pendingSuspensions.get(correlationId);
    if (!pending) {
      return false;
    }

    // Clean up timeout and subscription
    clearTimeout(pending.timeout);
    pending.unsubscribe();
    this.pendingSuspensions.delete(correlationId);

    // Reject the promise
    pending.reject(new Error('Suspension was cancelled'));
    return true;
  }

  cancelAll(): number {
    const count = this.pendingSuspensions.size;
    for (const correlationId of this.pendingSuspensions.keys()) {
      this.cancel(correlationId);
    }
    return count;
  }

  getPendingCount(): number {
    return this.pendingSuspensions.size;
  }

  isPending(correlationId: string): boolean {
    return this.pendingSuspensions.has(correlationId);
  }

  getPendingCorrelationIds(): string[] {
    return Array.from(this.pendingSuspensions.keys());
  }

  getStatus(correlationId: string): SuspensionStatus {
    if (this.pendingSuspensions.has(correlationId)) {
      return 'pending';
    }
    return 'resolved'; // We can't distinguish between timeout, cancelled, or resolved after cleanup
  }

  private cleanup(correlationId: string): void {
    const pending = this.pendingSuspensions.get(correlationId);
    if (pending) {
      clearTimeout(pending.timeout);
      pending.unsubscribe();
      this.pendingSuspensions.delete(correlationId);
    }
  }

  private defaultCorrelationExtractor<TResp extends DomainEvent>(
    event: TResp
  ): string {
    // Default correlation extraction uses aggregateId, falls back to event id
    return event.aggregateId ?? event.id;
  }
}
