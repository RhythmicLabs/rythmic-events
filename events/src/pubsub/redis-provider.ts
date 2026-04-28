import type { PubSubProvider } from './provider';

interface RedisPubSubClient {
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  quit(): Promise<void>;
  isOpen: boolean;
  on(event: 'error', handler: (err: Error) => void): void;
  on(
    event: 'message',
    handler: (channel: string, message: string | Buffer) => void
  ): void;
  subscribe(channel: string): void;
  unsubscribe(channel: string): Promise<void>;
  publish(channel: string, message: string | Buffer): Promise<number>;
}

export type SerializeType = 'json' | 'string' | 'buffer';

export interface PublishOptions {
  serializeAs?: SerializeType;
}

export interface SubscribeOptions {
  raw?: boolean;
}

export interface RedisPubSubOptions {
  redis?: RedisPubSubClient;
  url?: string;
  channelPrefix?: string;
  errorHandler?: (error: Error) => void;
}

type MessageHandler = (event: unknown) => void | Promise<void>;

function isBuffer(value: unknown): value is Buffer {
  return value instanceof globalThis.Buffer;
}

export class RedisProvider implements PubSubProvider {
  private client: RedisPubSubClient | null = null;
  private clientOwned: boolean = false;
  private connected: boolean = false;
  private channelPrefix: string;
  private errorHandler?: (error: Error) => void;
  private subscriptions: Map<string, Set<MessageHandler>> = new Map();
  private onceHandlers: Map<string, MessageHandler> = new Map();
  private rawMode: Map<string, boolean> = new Map();

  constructor(options: RedisPubSubOptions = {}) {
    this.channelPrefix = options.channelPrefix ?? '';
    this.errorHandler = options.errorHandler;

    if (options.redis) {
      this.client = options.redis;
      this.clientOwned = false;
    }

    this.setupErrorHandling();
  }

  private async createClient(url?: string): Promise<RedisPubSubClient> {
    const { createClient } = await import('redis');
    const client = url ? createClient({ url }) : createClient();
    return client as unknown as RedisPubSubClient;
  }

  private setupErrorHandling(): void {
    if (this.client) {
      this.client.on('error', (err: Error) => {
        if (this.errorHandler) {
          this.errorHandler(err);
        }
      });
    }
  }

  private getChannel(eventType: string): string {
    return `${this.channelPrefix}${eventType}`;
  }

  private serialize(
    value: unknown,
    serializeAs?: SerializeType
  ): string | Buffer {
    const type = serializeAs ?? this.detectType(value);

    switch (type) {
      case 'buffer':
        if (isBuffer(value)) {
          return value;
        }
        return Buffer.from(String(value));
      case 'string':
        return String(value);
      case 'json':
      default:
        if (typeof value === 'string') {
          return value;
        }
        try {
          return JSON.stringify(value);
        } catch {
          return String(value);
        }
    }
  }

  private detectType(value: unknown): SerializeType {
    if (isBuffer(value)) {
      return 'buffer';
    }
    if (typeof value === 'string') {
      return 'string';
    }
    return 'json';
  }

  private deserialize(message: string | Buffer, raw: boolean): unknown {
    if (raw) {
      return message;
    }

    const str = isBuffer(message) ? message.toString('utf-8') : message;

    try {
      return JSON.parse(str);
    } catch {
      return str;
    }
  }

  async connect(): Promise<void> {
    if (!this.client) {
      this.client = await this.createClient();
      this.clientOwned = true;
      this.setupErrorHandling();
    }

    if (!this.connected) {
      await this.client.connect();
      this.connected = true;
    }
  }

  async disconnect(): Promise<void> {
    if (this.client && this.connected) {
      for (const [eventType] of this.subscriptions) {
        await this.client.unsubscribe(this.getChannel(eventType));
      }
      this.subscriptions.clear();
      this.onceHandlers.clear();

      if (this.clientOwned) {
        await this.client.quit();
      }
      this.connected = false;
    }
  }

  isConnected(): boolean {
    return this.connected && this.client?.isOpen === true;
  }

  async publish(
    eventType: string,
    event: unknown,
    options?: PublishOptions
  ): Promise<void> {
    if (!this.client || !this.isConnected()) {
      throw new Error('Redis client not connected');
    }

    const channel = this.getChannel(eventType);
    const message = this.serialize(event, options?.serializeAs);

    await this.client.publish(channel, message);
  }

  subscribe(
    eventType: string,
    handler: MessageHandler,
    options?: SubscribeOptions
  ): () => void {
    if (!this.client || !this.isConnected()) {
      throw new Error('Redis client not connected');
    }

    const channel = this.getChannel(eventType);
    const raw = options?.raw ?? false;

    if (!this.subscriptions.has(eventType)) {
      this.subscriptions.set(eventType, new Set());
      this.rawMode.set(eventType, raw);

      this.client.on('message', (ch: string, message: string | Buffer) => {
        if (ch === channel) {
          const handlers = this.subscriptions.get(eventType);
          const isRaw = this.rawMode.get(eventType) ?? false;
          const deserialized = this.deserialize(message, isRaw);

          if (handlers) {
            for (const h of handlers) {
              h(deserialized);
            }
          }

          const onceHandler = this.onceHandlers.get(eventType);
          if (onceHandler) {
            onceHandler(deserialized);
            this.onceHandlers.delete(eventType);
            const currentHandlers = this.subscriptions.get(eventType);
            if (currentHandlers) {
              currentHandlers.delete(onceHandler);
            }
          }
        }
      });

      this.client.subscribe(channel);
    } else {
      const currentRaw = this.rawMode.get(eventType) ?? false;
      if (currentRaw !== raw) {
        this.rawMode.set(eventType, raw);
      }
    }

    this.subscriptions.get(eventType)!.add(handler);

    return () => {
      const handlers = this.subscriptions.get(eventType);
      if (handlers) {
        handlers.delete(handler);
        if (handlers.size === 0) {
          this.subscriptions.delete(eventType);
          this.rawMode.delete(eventType);
          if (this.client && this.connected) {
            this.client.unsubscribe(channel);
          }
        }
      }
    };
  }

  subscribeOnce(
    eventType: string,
    handler: MessageHandler,
    options?: SubscribeOptions
  ): () => void {
    const channel = this.getChannel(eventType);
    const raw = options?.raw ?? false;

    if (!this.subscriptions.has(eventType)) {
      this.onceHandlers.set(eventType, handler);
      this.rawMode.set(eventType, raw);

      this.client?.on('message', (ch: string, message: string | Buffer) => {
        if (ch === channel) {
          const isRaw = this.rawMode.get(eventType) ?? false;
          const deserialized = this.deserialize(message, isRaw);
          const onceHandler = this.onceHandlers.get(eventType);

          if (onceHandler) {
            onceHandler(deserialized);
            this.onceHandlers.delete(eventType);
            this.subscriptions.delete(eventType);
            this.rawMode.delete(eventType);
            if (this.client && this.connected) {
              this.client.unsubscribe(channel);
            }
          }
        }
      });

      this.client?.subscribe(channel);
      this.subscriptions.set(eventType, new Set());
    } else {
      this.onceHandlers.set(eventType, handler);
      const currentRaw = this.rawMode.get(eventType) ?? false;
      if (currentRaw !== raw) {
        this.rawMode.set(eventType, raw);
      }
    }

    return () => {
      const handler = this.onceHandlers.get(eventType);
      if (handler) {
        this.onceHandlers.delete(eventType);
      }
    };
  }
}
