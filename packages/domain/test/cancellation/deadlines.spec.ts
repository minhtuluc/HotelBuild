/** HB-245: mốc huỷ tuyệt đối phải trùng đúng ranh giới mà `resolveTier` dùng khi huỷ thật. */
import { expect, test } from 'vitest';
import fc from 'fast-check';
import { refundDeadlines, resolveTier } from '../../src/cancellation/index.js';

const HOUR = 3_600_000;
const flex = {
  tiers: [
    { offsetHours: -1, refundPercent: 0, chargeFirstNight: true },
    { offsetHours: 168, refundPercent: 100, chargeFirstNight: false },
    { offsetHours: 72, refundPercent: 50, chargeFirstNight: false },
    { offsetHours: 0, refundPercent: 20, chargeFirstNight: false },
  ],
};

test('HB245_deadlines_sorted_with_catch_all_last', () => {
  const checkIn = Date.UTC(2026, 11, 10, 7); // 14:00 giờ VN
  const deadlines = refundDeadlines(flex, checkIn);
  expect(deadlines.map((d) => [d.until, d.tier.refundPercent])).toEqual([
    [checkIn - 168 * HOUR, 100],
    [checkIn - 72 * HOUR, 50],
    [checkIn, 20],
    [null, 0],
  ]);
  expect(new Date(deadlines[0]!.until!).toISOString()).toBe('2026-12-03T07:00:00.000Z');
});

test('HB245_each_deadline_is_the_last_instant_of_its_tier', () => {
  fc.assert(
    fc.property(
      fc.integer({ min: 0, max: 4_000_000_000_000 }),
      fc.uniqueArray(fc.integer({ min: 0, max: 2_000 }), { minLength: 0, maxLength: 5 }),
      (checkIn, offsets) => {
        const sorted = [...offsets].sort((a, b) => b - a);
        const policy = {
          tiers: [
            ...sorted.map((offsetHours, index) => ({
              offsetHours,
              refundPercent: 100 - index * 10,
              chargeFirstNight: false,
            })),
            { offsetHours: -1, refundPercent: 0, chargeFirstNight: true },
          ],
        };
        const deadlines = refundDeadlines(policy, checkIn);
        for (const [index, deadline] of deadlines.entries()) {
          if (deadline.until === null) {
            expect(index).toBe(deadlines.length - 1);
            continue;
          }
          expect(resolveTier(policy, checkIn, deadline.until)).toEqual(deadline.tier);
          expect(resolveTier(policy, checkIn, deadline.until + 1)).toEqual(
            deadlines[index + 1]!.tier,
          );
        }
      },
    ),
  );
});

test('HB245_invalid_policy_rejected_like_resolveTier', () => {
  expect(() =>
    refundDeadlines(
      { tiers: [{ offsetHours: 24, refundPercent: 50, chargeFirstNight: false }] },
      0,
    ),
  ).toThrow(/catch-all/);
});
