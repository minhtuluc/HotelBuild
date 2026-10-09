import type { Prisma, PrismaClient } from '@prisma/client';
import type { Clock, IdGenerator } from '@pinehill/domain';
import { resolveTier } from '@pinehill/domain/cancellation';
import type { AuthorizedActor } from '../../../common/actor/authorized-actor.js';
import { planAdmin, planPublic, planSnapshot } from './projection.js';
import { planInput, nights, validateStay, planData } from './validation.js';
import type { PublicQuery } from './validation.js';
import {
  owner,
  missing,
  conflict,
  configuration,
  page,
  recordChange,
  safeDatabaseError,
} from './support.js';
import type { PageQuery } from './support.js';
const include = { cancellation_policies: { include: { cancellation_tiers: true } } } as const;
export class RatePlansService {
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
      await tx.$queryRaw`SELECT id FROM rate_plans WHERE id=${id}::uuid FOR UPDATE`;
      const current = await tx.rate_plans.findUnique({ where: { id } });
      if (!current) throw missing();
      if (current.version !== expected) throw conflict();
      const input = planInput(body);
      validateStay(input, current);
      const policyId = input.cancellationPolicyId ?? current.cancellation_policy_id;
      // Lock both previous and selected policies before reading their complete audit shape.
      // Stable UUID order prevents crossed relinks from acquiring these locks in opposite order.
      for (const lockedId of [...new Set([current.cancellation_policy_id, policyId])].sort())
        await tx.$queryRaw`SELECT id FROM cancellation_policies WHERE id=${lockedId}::uuid FOR UPDATE`;
      const before = await tx.rate_plans.findUnique({ where: { id }, include });
      if (!before) throw missing();
      const policy = await tx.cancellation_policies.findUnique({
        where: { id: policyId },
        include: { cancellation_tiers: true },
      });
      if (!policy || (input.cancellationPolicyId !== undefined && policy.status !== 'ACTIVE'))
        configuration('cancellationPolicyId', 'POLICY_UNAVAILABLE');
      // Validate the linked policy using exactly the frozen engine shape.
      resolveTier(
        {
          tiers: policy.cancellation_tiers.map((t) => ({
            offsetHours: t.offset_hours,
            refundPercent: Number(t.refund_percent),
            chargeFirstNight: t.charge_first_night,
          })),
        },
        0,
        0,
      );
      const after = await tx.rate_plans.update({
        where: { id },
        data: planData(input, this.clock.now()),
        include,
      });
      await recordChange(
        tx,
        actor,
        this.clock,
        this.ids,
        'RatePlan',
        planSnapshot(before),
        planSnapshot(after),
        input.reason,
      );
    } catch (error) {
      safeDatabaseError(error);
    }
  }
  async listPublic(query: PublicQuery) {
    const stay = nights(query);
    return this.db.$transaction(
      async (tx) => {
        if (
          query.propertyId &&
          !(await tx.properties.findFirst({
            where: { id: query.propertyId, status: 'ACTIVE' },
            select: { id: true },
          }))
        )
          return page([], 0, query, planPublic);
        const where = {
          status: 'ACTIVE',
          cancellation_policies: { status: 'ACTIVE' },
          ...(stay === undefined ? {} : { min_nights: { lte: stay }, max_nights: { gte: stay } }),
        };
        const total = await tx.rate_plans.count({ where });
        const rows = await tx.rate_plans.findMany({
          where: { ...where, ...(query.cursor ? { id: { gt: query.cursor } } : {}) },
          include,
          orderBy: { id: 'asc' },
          take: query.limit + 1,
        });
        return page(rows, total, query, planPublic);
      },
      { isolationLevel: 'RepeatableRead' },
    );
  }
  async listAdmin(actor: AuthorizedActor, query: PageQuery) {
    owner(actor);
    return this.db.$transaction(
      async (tx) => {
        const total = await tx.rate_plans.count();
        const rows = await tx.rate_plans.findMany({
          where: query.cursor ? { id: { gt: query.cursor } } : {},
          include,
          orderBy: { id: 'asc' },
          take: query.limit + 1,
        });
        return page(rows, total, query, planAdmin);
      },
      { isolationLevel: 'RepeatableRead' },
    );
  }
}
