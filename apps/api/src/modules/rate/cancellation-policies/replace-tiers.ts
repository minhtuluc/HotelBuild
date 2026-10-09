import type { Prisma } from '@prisma/client';
import type { CancellationTier } from '@pinehill/domain/cancellation';
import type { IdGenerator } from '@pinehill/domain';
import type { PolicyRow } from './projection.js';
import { configuration } from '../rate-plans/support.js';

/** Replace the full live set, preserving identities and refund references at retained offsets. */
export async function replaceTiers(
  tx: Prisma.TransactionClient,
  old: PolicyRow,
  tiers: readonly (CancellationTier & { label: string })[],
  ids: IdGenerator,
) {
  const existing = new Map(old.cancellation_tiers.map((t) => [t.offset_hours, t]));
  const retained = tiers.flatMap((tier, i) => {
    const row = existing.get(tier.offsetHours);
    return row
      ? [
          {
            row,
            data: {
              offset_hours: tier.offsetHours,
              refund_percent: tier.refundPercent,
              charge_first_night: tier.chargeFirstNight,
              label: tier.label,
              sort_order: i + 1,
            },
          },
        ]
      : [];
  });
  // Existing valid lists and new normalized lists retain relative offset order. This permits
  // collision-free rank shifts without deleting referenced rows or disabling UNIQUE constraints.
  if (retained.some((r, i) => i > 0 && r.row.sort_order <= retained[i - 1]!.row.sort_order))
    configuration('tiers', 'EXISTING_ORDER_INVALID');
  await tx.cancellation_tiers.deleteMany({
    where: { policy_id: old.id, offset_hours: { notIn: tiers.map((t) => t.offsetHours) } },
  });
  const up = retained.filter((r) => r.data.sort_order < r.row.sort_order);
  const down = retained.filter((r) => r.data.sort_order > r.row.sort_order).reverse();
  const same = retained.filter((r) => r.data.sort_order === r.row.sort_order);
  for (const r of [...up, ...down, ...same])
    await tx.cancellation_tiers.update({ where: { id: r.row.id }, data: r.data });
  const fresh = tiers.flatMap((t, i) =>
    existing.has(t.offsetHours)
      ? []
      : [
          {
            id: ids.generate(),
            policy_id: old.id,
            offset_hours: t.offsetHours,
            refund_percent: t.refundPercent,
            charge_first_night: t.chargeFirstNight,
            label: t.label,
            sort_order: i + 1,
          },
        ],
  );
  for (let start = 0; start < fresh.length; start += 500)
    await tx.cancellation_tiers.createMany({ data: fresh.slice(start, start + 500) });
}
