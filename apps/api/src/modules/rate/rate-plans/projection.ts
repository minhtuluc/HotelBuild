import { ratePlanCodeSchema } from '@pinehill/contracts';
import type { RatePlanAdmin, RatePlanPublic } from '@pinehill/contracts';
import type { Prisma } from '@prisma/client';
import { numericVersion } from './support.js';
import { canonical as policyCanonical } from '../cancellation-policies/projection.js';
export type PlanRow = Prisma.rate_plansGetPayload<{
  include: { cancellation_policies: { include: { cancellation_tiers: true } } };
}>;
export function planAdmin(row: PlanRow): RatePlanAdmin {
  if (row.status !== 'ACTIVE' && row.status !== 'INACTIVE')
    throw new Error('INVALID_RATE_PLAN_STATUS');
  return {
    id: row.id,
    code: ratePlanCodeSchema.parse(row.code),
    name: row.name,
    minNights: row.min_nights,
    maxNights: row.max_nights,
    depositPercent: Number(row.deposit_percent),
    cancellationPolicyId: row.cancellation_policy_id,
    status: row.status,
    version: numericVersion(row.version),
  };
}
export function planPublic(row: PlanRow): RatePlanPublic {
  const admin = planAdmin(row);
  const offsets = row.cancellation_policies.cancellation_tiers
    .filter((t) => t.offset_hours >= 0 && Number(t.refund_percent) === 100 && !t.charge_first_night)
    .map((t) => t.offset_hours);
  return {
    code: admin.code,
    name: admin.name,
    minNights: admin.minNights,
    maxNights: admin.maxNights,
    depositPercent: admin.depositPercent,
    ...(offsets.length ? { freeCancelHours: Math.min(...offsets) } : {}),
  };
}
export function planSnapshot(row: PlanRow) {
  return {
    ...planAdmin(row),
    fixedNightlyPrice: row.fixed_nightly_price === null ? null : row.fixed_nightly_price.toString(),
    losDiscountEnabled: row.los_discount_enabled,
    rescheduleAllowed: row.reschedule_allowed,
    rescheduleMinHours: row.reschedule_min_hours,
    rescheduleFeePct: Number(row.reschedule_fee_pct),
    maxReschedules: row.max_reschedules,
    policy: policyCanonical(row.cancellation_policies),
  };
}
