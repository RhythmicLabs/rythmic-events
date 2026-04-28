export interface PubSubProvider {
  publish(eventType: string, event: unknown): Promise<void>;
  subscribe(
    eventType: string,
    handler: (event: unknown) => void | Promise<void>
  ): () => void;
  subscribeOnce(
    eventType: string,
    handler: (event: unknown) => void | Promise<void>
  ): () => void;
  connect?(): Promise<void>;
  disconnect?(): Promise<void>;
  isConnected?(): boolean;
}
