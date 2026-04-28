import type { PubSubProvider } from './provider';
import {
  TypedEventEmitter,
  createTypedEventEmitter,
} from '../event-emitter/index';

export class LocalPubSubProvider implements PubSubProvider {
  private emitter: TypedEventEmitter<Record<string, unknown>>;
  private connected: boolean = false;

  constructor() {
    this.emitter = createTypedEventEmitter();
    this.connected = true;
  }

  async connect(): Promise<void> {
    this.connected = true;
  }

  async disconnect(): Promise<void> {
    this.emitter.removeAllListeners();
    this.connected = false;
  }

  isConnected(): boolean {
    return this.connected;
  }

  async publish(eventType: string, event: unknown): Promise<void> {
    this.emitter.emit(eventType, event);
  }

  subscribe(
    eventType: string,
    handler: (event: unknown) => void | Promise<void>
  ): () => void {
    this.emitter.on(eventType, handler);
    return () => this.emitter.off(eventType, handler);
  }

  subscribeOnce(
    eventType: string,
    handler: (event: unknown) => void | Promise<void>
  ): () => void {
    this.emitter.once(eventType, handler);
    return () => this.emitter.off(eventType, handler);
  }
}
