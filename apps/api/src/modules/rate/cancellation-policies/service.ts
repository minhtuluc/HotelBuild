import type { Prisma, PrismaClient } from '@prisma/client';
import type { Clock, IdGenerator } from '@pinehill/domain';
import type { AuthorizedActor } from '../../../common/actor/authorized-actor.js';
import { canonical, policyDto } from './projection.js';
import { normalizePolicy } from './validation.js';
import { replaceTiers } from './replace-tiers.js';
import {
  owner,
  missing,
  conflict,
  page,
  recordChange,
  safeDatabaseError,
} from '../rate-plans/support.js';
import type { PageQuery } from '../rate-plans/support.js';
export class CancellationPoliciesService {
  constructor(
    readonly db: PrismaClient,
    readonly clock: Clock,
    readonly ids: IdGenerator,
  ) {}
  async update(
    tx: Prisma.TransactionClient,
    actor: AuthorizedActor,
    id: string,
    expected: bigint,
    body: unknown,
  ) {
    owner(actor);
    try {
      await tx.$queryRaw`SELECT id FROM cancellation_policies WHERE id=${id}::uuid FOR UPDATE`;
      const before = await tx.cancellation_policies.findUnique({
        where: { id },
        include: { cancellation_tiers: true },
      });
      if (!before) throw missing();
      if (before.version !== expected) throw conflict();
      const input = normalizePolicy(body, before);
      await replaceTiers(tx, before, input.tiers, this.ids);
      const after = await tx.cancellation_policies.update({
        where: { id },
        data: {
          early_checkout_free_hours: input.earlyCheckoutFreeHours || null,
          early_checkout_refund_pct: input.earlyCheckoutRefundPct,
        },
        include: { cancellation_tiers: true },
      });
      await recordChange(
        tx,
        actor,
        this.clock,
        this.ids,
        'CancellationPolicy',
        canonical(before),
        canonical(after),
        input.reason,
      );
      return policyDto(after);
    } catch (error) {
      return safeDatabaseError(error);
    }
  }
  async list(
    actor: AuthorizedActor,
    query: PageQuery & { status?: 'ACTIVE' | 'INACTIVE' | undefined },
  ) {
    owner(actor);
    const where = { ...(query.status ? { status: query.status } : {}) };
    // One primary snapshot prevents a concurrent tier replacement from splitting a read response.
    return this.db.$transaction(
      async (tx) => {
        const total = await tx.cancellation_policies.count({ where });
        const rows = await tx.cancellation_policies.findMany({
          where: { ...where, ...(query.cursor ? { id: { gt: query.cursor } } : {}) },
          orderBy: { id: 'asc' },
          take: query.limit + 1,
          include: { cancellation_tiers: true },
        });
        return page(rows, total, query, policyDto);
      },
      { isolationLevel: 'RepeatableRead' },
    );
  }
}
