import { isRecord, isSessionState, type SessionState } from './protocol.js';
export interface LockHost {
  run<T>(name: string, task: () => Promise<T>): Promise<T>;
}
export interface CoordinatorOptions {
  name: string;
  locks?: LockHost;
  storage?: Pick<Storage, 'getItem' | 'setItem'>;
  channel?: BroadcastChannel;
  peerTimeoutMs?: number;
}
export class SessionCoordinator {
  private readonly storage: Pick<Storage, 'getItem' | 'setItem'>;
  private readonly locks: LockHost;
  private readonly channel: BroadcastChannel;
  private state: SessionState | undefined;
  private revision: string | null = null;
  private readonly listeners = new Set<(state: SessionState | undefined) => void>();
  private readonly pending = new Map<string, (state: SessionState | undefined) => void>();
  constructor(private readonly options: CoordinatorOptions) {
    if (!options.locks && !globalThis.navigator?.locks)
      throw new Error('Session coordination requires a secure context and Web Locks');
    this.locks = options.locks ?? {
      async run<T>(name: string, task: () => Promise<T>): Promise<T> {
        return await navigator.locks.request(name, task);
      },
    };
    this.storage = options.storage ?? localStorage;
    this.channel = options.channel ?? new BroadcastChannel(options.name);
    this.channel.onmessage = (event: MessageEvent<unknown>) => this.receive(event.data);
  }
  current(): SessionState | undefined {
    return this.revision === this.storage.getItem(this.options.name) ? this.state : undefined;
  }
  async readShared(): Promise<SessionState | undefined> {
    const local = this.current();
    if (local) return local;
    const revision = this.storage.getItem(this.options.name);
    if (revision === null) return undefined;
    const id = crypto.randomUUID();
    return new Promise((resolve) => {
      const timer = setTimeout(() => finish(undefined), this.options.peerTimeoutMs ?? 500);
      const finish = (state: SessionState | undefined) => {
        clearTimeout(timer);
        this.pending.delete(id);
        resolve(state);
      };
      this.pending.set(id, finish);
      this.channel.postMessage({ type: 'query', revision, id });
    });
  }
  async run<T>(task: () => Promise<T>): Promise<T> {
    return this.locks.run(this.options.name, task);
  }
  publish(state: SessionState | undefined): void {
    const revision = crypto.randomUUID();
    // Only a random revision is persisted. Access tokens live in these objects and channel messages.
    this.storage.setItem(this.options.name, revision);
    this.accept(revision, state);
    this.channel.postMessage({ type: 'state', revision, state });
  }
  private accept(revision: string, state: SessionState | undefined) {
    this.revision = revision;
    this.state = state;
    for (const listener of this.listeners) listener(state);
  }
  private receive(value: unknown): void {
    if (!isMessage(value) || value.revision !== this.storage.getItem(this.options.name)) return;
    if (value.type === 'query') {
      if (this.revision === value.revision)
        this.channel.postMessage({
          type: 'reply',
          id: value.id,
          revision: value.revision,
          state: this.state,
        });
      return;
    }
    this.accept(value.revision, value.state);
    if (value.type === 'reply') this.pending.get(value.id)?.(value.state);
  }
  subscribe(listener: (state: SessionState | undefined) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }
  dispose(): void {
    for (const finish of this.pending.values()) finish(undefined);
    this.channel.close();
    this.listeners.clear();
    this.state = undefined;
  }
}
type Message =
  | { type: 'query'; revision: string; id: string }
  | { type: 'reply'; revision: string; id: string; state: SessionState | undefined }
  | { type: 'state'; revision: string; state: SessionState | undefined };
function isMessage(value: unknown): value is Message {
  if (!isRecord(value) || typeof value.revision !== 'string') return false;
  if (value.type === 'query') return typeof value.id === 'string';
  if (value.state !== undefined && !isSessionState(value.state)) return false;
  return value.type === 'state' || (value.type === 'reply' && typeof value.id === 'string');
}
