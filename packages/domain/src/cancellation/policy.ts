import type { CancellationPolicy, CancellationTier } from './index.js';
import { fail, integer } from './validation.js';
/**
 * Validate the frozen contract and compare exact instants without float hours.
 * @param checkInDateTime Nominal check-in instant in integer milliseconds, computed by the caller.
 * @param now Cancellation decision instant in integer milliseconds on the same timeline.
 */
export function resolveTier(
  policy: CancellationPolicy,
  checkInDateTime: number,
  now: number,
): CancellationTier {
  integer(checkInDateTime, 'checkInDateTime', true);
  integer(now, 'now', true);
  const tiers = [...policy.tiers].sort((a, b) => b.offsetHours - a.offsetHours);
  const last = tiers.at(-1);
  if (!last || last.offsetHours !== -1)
    fail('E_CANCEL_POLICY_MISSING', 'Policy needs exactly one catch-all tier');
  let previousOffset = Infinity;
  let previousRefund = 100;
  for (const tier of tiers) {
    validateOffset(tier.offsetHours, previousOffset);
    validateRefund(tier, previousRefund);
    previousOffset = tier.offsetHours;
    previousRefund = tier.refundPercent;
  }
  const delta = BigInt(checkInDateTime) - BigInt(now);
  for (const tier of tiers) {
    if (tier.offsetHours >= 0 && delta >= BigInt(tier.offsetHours) * 3_600_000n)
      return Object.freeze({ ...tier });
  }
  return Object.freeze({ ...last });
}

function validateOffset(offset: number, previous: number): void {
  if (!Number.isSafeInteger(offset) || offset < -1 || offset >= previous)
    fail(
      'E_CANCEL_INVALID_POLICY',
      'Policy offsets must be unique nonnegative safe integers or catch-all -1',
    );
}
function validateRefund(tier: CancellationTier, previous: number): void {
  if (
    !Number.isInteger(tier.refundPercent) ||
    tier.refundPercent < 0 ||
    tier.refundPercent > previous ||
    typeof tier.chargeFirstNight !== 'boolean' ||
    (tier.chargeFirstNight && tier.refundPercent !== 0)
  )
    fail(
      'E_CANCEL_INVALID_POLICY',
      'Policy refunds must be nonincreasing integer percentages with no refund when charging first night',
    );
}
