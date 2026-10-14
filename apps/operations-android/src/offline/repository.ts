import type { KeyValueStorage } from '../storage';
import { QueueFailure, type OfflineContext, type QueueEntry } from './types';
import { decode } from './validation';

const locks = new Map<string, Promise<unknown>>();
export interface QueueTransaction {
  entries: QueueEntry[];
  save(next: readonly QueueEntry[]): Promise<void>;
}
export class QueueRepository {
  private readonly key: string;
  constructor(
    private readonly storage: KeyValueStorage,
    private readonly context: OfflineContext,
  ) {
    this.key = `offline.queue.${context.userId}.${context.propertyId}`;
  }
  transaction<T>(work: (tx: QueueTransaction) => Promise<T>): Promise<T> {
    const action = () => this.run(work);
    const next = (locks.get(this.key) ?? Promise.resolve()).then(action, action);
    locks.set(this.key, next);
    const cleanup = () => {
      if (locks.get(this.key) === next) locks.delete(this.key);
    };
    void next.then(cleanup, cleanup);
    return next;
  }
  private async read(): Promise<string | null> {
    try {
      return await this.storage.get(this.key);
    } catch {
      throw new QueueFailure('STORAGE');
    }
  }
  private async run<T>(work: (tx: QueueTransaction) => Promise<T>): Promise<T> {
    let raw = await this.read();
    const tx: QueueTransaction = {
      entries: decode(raw, this.context),
      save: async (next) => {
        const encoded = JSON.stringify(next);
        if (encoded.length > 16_384 || next.length > 32) throw new QueueFailure('QUEUE_FULL');
        const checked = decode(encoded, this.context);
        if ((await this.read()) !== raw) throw new QueueFailure('STORAGE_CHANGED');
        try {
          await this.storage.set(this.key, encoded);
        } catch {
          throw new QueueFailure('STORAGE');
        }
        if ((await this.read()) !== encoded) throw new QueueFailure('STORAGE');
        raw = encoded;
        tx.entries = checked;
      },
    };
    return work(tx);
  }
}
