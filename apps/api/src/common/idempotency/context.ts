import type { Prisma } from '@prisma/client';
import { AsyncLocalStorage } from 'node:async_hooks';

export class IdempotencyContext {
  private readonly storage = new AsyncLocalStorage<Prisma.TransactionClient>();
  run<T>(tx: Prisma.TransactionClient, work: () => Promise<T>): Promise<T> {
    return this.storage.run(tx, work);
  }
  transaction(): Prisma.TransactionClient {
    const tx = this.storage.getStore();
    if (!tx) throw new Error('No active idempotent transaction');
    return tx;
  }
}
