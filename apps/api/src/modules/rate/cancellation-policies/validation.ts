import { cancellationPolicyUpdateRequestSchema } from '@pinehill/contracts';
import type { CancellationTier as WireTier } from '@pinehill/contracts';
import { resolveTier } from '@pinehill/domain/cancellation';
import type { CancellationTier } from '@pinehill/domain/cancellation';
import type { PolicyRow } from './projection.js';
import { configuration, maskText, reason } from '../rate-plans/support.js';
export function policyInput(value: unknown) {
  const p = cancellationPolicyUpdateRequestSchema.safeParse(value);
  if (!p.success) {
    const issue = p.error.issues[0]!;
    const field =
      issue.path
        .map((p, i) => (typeof p === 'number' ? `[${p}]` : `${i ? '.' : ''}${String(p)}`))
        .join('') || 'request';
    configuration(field, 'INVALID_VALUE');
  }
  return { ...p.data, reason: reason(p.data.reason) };
}
export function normalizePolicy(value: unknown, old: PolicyRow) {
  const input = policyInput(value),
    previous = new Map(old.cancellation_tiers.map((t) => [t.offset_hours, t]));
  if (input.tiers.length > 32767) configuration('tiers', 'TOO_MANY');
  if (input.earlyCheckoutFreeHours > 32767) configuration('earlyCheckoutFreeHours', 'OUT_OF_RANGE');
  if (input.earlyCheckoutFreeHours === 0 && input.earlyCheckoutRefundPct !== 0)
    configuration('earlyCheckoutRefundPct', 'REFUND_WITHOUT_THRESHOLD');
  const tiers = input.tiers.map((t, index) => {
    const offset = t.offsetHours ?? (t.hoursBeforeCheckIn === 0 ? -1 : t.hoursBeforeCheckIn);
    if (t.hoursBeforeCheckIn !== Math.max(0, offset))
      configuration(`tiers[${index}].hoursBeforeCheckIn`, 'OFFSET_MISMATCH');
    const prev = previous.get(offset);
    return {
      offsetHours: offset,
      refundPercent: t.refundPercent,
      chargeFirstNight: t.chargeFirstNight ?? prev?.charge_first_night ?? false,
      label: tierLabel(t, prev?.label, offset),
    };
  });
  validateTiers(tiers);
  // Exactly the engine function used for sold-policy selection validates the frozen shape.
  resolveTier({ tiers }, 0, 0);
  return { ...input, tiers };
}
function validateTiers(tiers: readonly CancellationTier[]) {
  const offsets = new Set<number>();
  let previousOffset = Infinity,
    previousRefund = 100,
    catchAll = 0;
  for (const [i, t] of tiers.entries()) {
    if (offsets.has(t.offsetHours))
      configuration(`tiers[${i}].hoursBeforeCheckIn`, 'DUPLICATE_OFFSET');
    offsets.add(t.offsetHours);
  }
  for (const [i, t] of tiers.entries()) {
    if (t.offsetHours === -1) {
      catchAll++;
      if (i !== tiers.length - 1)
        configuration(`tiers[${i}].hoursBeforeCheckIn`, 'CATCH_ALL_NOT_LAST');
    }
    validateOffset(t.offsetHours, previousOffset, i);
    validateRefund(t, previousRefund, i);
    previousOffset = t.offsetHours;
    previousRefund = t.refundPercent;
  }
  if (catchAll !== 1)
    configuration(
      `tiers[${Math.max(0, tiers.length - 1)}].hoursBeforeCheckIn`,
      'MISSING_CATCH_ALL',
    );
}
function tierLabel(tier: WireTier, previous: string | undefined, offset: number): string {
  return maskText(tier.label?.trim() || previous || `Bậc ${offset}h`);
}
function validateOffset(offset: number, previous: number, index: number): void {
  if (offset > 2147483647) configuration(`tiers[${index}].hoursBeforeCheckIn`, 'OUT_OF_RANGE');
  if (!Number.isSafeInteger(offset) || offset < -1 || offset >= previous)
    configuration(`tiers[${index}].hoursBeforeCheckIn`, 'INVALID_ORDER');
}
function validateRefund(tier: CancellationTier, previous: number, index: number): void {
  if (!Number.isInteger(tier.refundPercent) || tier.refundPercent < 0 || tier.refundPercent > 100)
    configuration(`tiers[${index}].refundPercent`, 'OUT_OF_RANGE');
  if (tier.refundPercent > previous) configuration(`tiers[${index}].refundPercent`, 'NONMONOTONIC');
  if (tier.chargeFirstNight && tier.refundPercent !== 0)
    configuration(`tiers[${index}].chargeFirstNight`, 'REFUND_WITH_FIRST_NIGHT_CHARGE');
}
