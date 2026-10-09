import type { Prisma } from '@prisma/client';
import type { CancellationPolicy } from '@pinehill/contracts';
import { numericVersion, maskText } from '../rate-plans/support.js';
export type PolicyRow = Prisma.cancellation_policiesGetPayload<{
  include: { cancellation_tiers: true };
}>;
export function canonical(row: PolicyRow) {
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    status: row.status,
    version: numericVersion(row.version),
    isDefault: row.is_default,
    earlyCheckoutFreeHours: row.early_checkout_free_hours,
    earlyCheckoutRefundPct: Number(row.early_checkout_refund_pct),
    tiers: [...row.cancellation_tiers]
      .sort((a, b) => a.sort_order - b.sort_order)
      .map((t) => ({
        id: t.id,
        offsetHours: t.offset_hours,
        refundPercent: Number(t.refund_percent),
        chargeFirstNight: t.charge_first_night,
        label: maskText(t.label),
        sortOrder: t.sort_order,
        version: numericVersion(t.version),
      })),
  };
}
export function policyDto(row: PolicyRow): CancellationPolicy {
  const c = canonical(row);
  if (c.status !== 'ACTIVE' && c.status !== 'INACTIVE') throw new Error('INVALID_POLICY_STATUS');
  return {
    id: c.id,
    name: c.name,
    status: c.status,
    version: c.version,
    earlyCheckoutFreeHours: c.earlyCheckoutFreeHours ?? 0,
    earlyCheckoutRefundPct: c.earlyCheckoutRefundPct,
    tiers: c.tiers.map((t) => ({
      hoursBeforeCheckIn: Math.max(0, t.offsetHours),
      offsetHours: t.offsetHours,
      refundPercent: t.refundPercent,
      chargeFirstNight: t.chargeFirstNight,
      label: t.label,
    })),
  };
}
