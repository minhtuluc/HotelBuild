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

/** Một mốc huỷ tuyệt đối: bậc `tier` còn áp tới **hết** `until` (ms, tính cả); `null` = bậc bắt tất. */
export interface RefundDeadline {
  readonly until: number | null;
  readonly tier: CancellationTier;
}

/**
 * Quy các bậc "số giờ trước giờ nhận phòng" ra mốc tuyệt đối, **cùng luật** với `resolveTier`: bậc
 * `offsetHours = h ≥ 0` áp khi `checkIn − now ≥ h giờ`, tức `now ≤ checkIn − h giờ`. Kết quả xếp theo
 * thời gian tăng dần; bậc bắt tất (`-1`) đứng cuối với `until = null` (áp sau mốc cuối cùng).
 * Chính sách sai cấu hình bị từ chối y như `resolveTier`, nên mốc và quyết định huỷ không thể lệch nhau.
 */
export function refundDeadlines(
  policy: CancellationPolicy,
  checkInDateTime: number,
): readonly RefundDeadline[] {
  integer(checkInDateTime, 'checkInDateTime', true);
  // Kiểm cấu hình bằng chính `resolveTier` (cùng thông báo lỗi), `now` bất kỳ.
  resolveTier(policy, checkInDateTime, checkInDateTime);
  return [...policy.tiers]
    .sort((a, b) => b.offsetHours - a.offsetHours)
    .map((tier) =>
      Object.freeze({
        until: tier.offsetHours >= 0 ? checkInDateTime - tier.offsetHours * 3_600_000 : null,
        tier: Object.freeze({ ...tier }),
      }),
    );
}
