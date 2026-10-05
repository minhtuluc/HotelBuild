import type { Prisma } from '@prisma/client';
import type { Clock } from '@pinehill/domain';
import type { ActorContext } from '../../common/actor/actor-context.js';

export interface AuditEntry {
  readonly actor: ActorContext;
  readonly action: string;
  readonly entityType: string;
  readonly entityId: string | null;
  readonly beforeJson: Prisma.InputJsonValue | null;
  readonly afterJson: Prisma.InputJsonValue | null;
  readonly reason: string | null;
}

/** Stage A contract only: intentionally no behavior until DeepSeek implements stage B. */
export class AuditWriter {
  constructor(readonly clock: Clock) {}

  record(tx: Prisma.TransactionClient, entry: AuditEntry): Promise<void> {
    void tx;
    void entry;
    return Promise.resolve();
  }
}
