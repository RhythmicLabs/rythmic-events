import { EventEmitter } from 'eventemitter3';

export interface TypedEventMap {
  [key: string]: unknown;
}

export type EventListener<T = unknown> = (event: T) => void | Promise<void>;

export class TypedEventEmitter<T extends TypedEventMap = TypedEventMap> {
  protected readonly emitter: EventEmitter = new EventEmitter();

  on<K extends string & keyof T>(
    event: K,
    listener: EventListener<T[K]>
  ): this {
    const wrappedListener = this.createWrappedListener(listener);
    this.storeWrappedListener(listener, wrappedListener, event);
    this.emitter.on(event, wrappedListener as (...args: unknown[]) => void);
    return this;
  }

  once<K extends string & keyof T>(
    event: K,
    listener: EventListener<T[K]>
  ): this {
    const wrappedListener = this.createWrappedListener(listener);
    this.storeWrappedListener(listener, wrappedListener, event);
    this.emitter.once(event, wrappedListener as (...args: unknown[]) => void);
    return this;
  }

  off<K extends string & keyof T>(
    event: K,
    listener: EventListener<T[K]>
  ): this {
    const wrappedListener = this.getWrappedListener(listener, event);
    if (wrappedListener) {
      this.emitter.off(event, wrappedListener as (...args: unknown[]) => void);
      this.removeWrappedListener(listener, event);
    }
    return this;
  }

  emit<K extends string & keyof T>(event: K, data: T[K]): boolean {
    return this.emitter.emit(event, data);
  }

  removeAllListeners<K extends string & keyof T>(event?: K): this {
    this.emitter.removeAllListeners(event);
    return this;
  }

  listenerCount<K extends string & keyof T>(event: K): number {
    return this.emitter.listenerCount(event);
  }

  eventNames(): Array<string & keyof T> {
    return this.emitter.eventNames() as Array<string & keyof T>;
  }

  private wrappedListeners: Map<Function, Map<string, Function>> = new Map();

  private createWrappedListener(listener: Function): Function {
    return async (...args: unknown[]) => {
      try {
        await (listener as (...args: unknown[]) => Promise<void>)(...args);
      } catch {
        // Swallow listener errors to prevent crashes
      }
    };
  }

  private storeWrappedListener(
    listener: Function,
    wrappedListener: Function,
    event: string
  ): void {
    if (!this.wrappedListeners.has(listener)) {
      this.wrappedListeners.set(listener, new Map());
    }
    this.wrappedListeners.get(listener)!.set(event, wrappedListener);
  }

  private getWrappedListener(
    listener: Function,
    event: string
  ): Function | undefined {
    return this.wrappedListeners.get(listener)?.get(event);
  }

  private removeWrappedListener(listener: Function, event: string): void {
    const eventMap = this.wrappedListeners.get(listener);
    if (eventMap) {
      eventMap.delete(event);
      if (eventMap.size === 0) {
        this.wrappedListeners.delete(listener);
      }
    }
  }
}

export function createTypedEventEmitter<
  T extends TypedEventMap = TypedEventMap,
>(): TypedEventEmitter<T> {
  return new TypedEventEmitter<T>();
}
