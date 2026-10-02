import { expect, test } from 'vitest';
import fc from 'fast-check';
import * as engine from '../../src/cancellation/index.js';
import { input } from './fixtures/decision-table.js';

const allocate = engine.allocatePayment;

test('TC-CANCEL-44/45/46/49 generated policies preserve limits, monotonicity and purity', () => {
  let crossings = 0;
  fc.assert(
    fc.property(
      fc.integer({ min: 0, max: 200000000 }),
      fc.tuple(
        fc.integer({ min: -120000, max: 120000 }),
        fc.integer({ min: -120000, max: 120000 }),
      ),
      fc.integer({ min: 0, max: 100 }),
      fc.integer({ min: 0, max: 100 }),
      (paid, [m1, m2], p1, p2) => {
        const policy = {
          tiers: [
            { offsetHours: 72, refundPercent: Math.max(p1, p2), chargeFirstNight: false },
            { offsetHours: -1, refundPercent: Math.min(p1, p2), chargeFirstNight: false },
          ],
        };
        const earlierMinutes = Math.max(m1, m2);
        const laterMinutes = Math.min(m1, m2);
        const base = { ...input(paid, earlierMinutes), policy };
        const earlier = engine.calculateCancellation(base);
        const later = engine.calculateCancellation({ ...base, now: -laterMinutes * 60_000 });
        expect(earlier.tier.offsetHours).toBe(earlierMinutes >= 4320 ? 72 : -1);
        expect(later.tier.offsetHours).toBe(laterMinutes >= 4320 ? 72 : -1);
        if (earlier.tier.offsetHours !== later.tier.offsetHours && p1 !== p2) crossings++;
        expect(later.refundAmount).toBeLessThanOrEqual(earlier.refundAmount);
        expect(earlier.refundAmount).toBeLessThanOrEqual(paid);
        expect(earlier.refundAmount % 1000).toBe(0);
        expect(engine.calculateCancellation(base)).toEqual(earlier);
      },
    ),
    { numRuns: 200, seed: 53044 },
  );
  expect(crossings).toBeGreaterThan(0);
});
test('TC-CANCEL-44 allocation property conserves each payment', () => {
  fc.assert(
    fc.property(
      fc.integer({ min: 0, max: Number.MAX_SAFE_INTEGER }),
      fc.array(fc.integer({ min: 1, max: 1000000 }), { minLength: 1, maxLength: 8 }),
      (amount, weights) => {
        const p = allocate({
          paymentId: 'p',
          amount,
          weights: weights.map((weight, index) => ({ bookingRoomId: String(index), weight })),
        });
        expect(
          p.allocations.reduce((sum: bigint, a: { amount: number }) => sum + BigInt(a.amount), 0n),
        ).toBe(BigInt(amount));
      },
    ),
    { numRuns: 200, seed: 53019 },
  );
});

test('TC-CANCEL-45 every generated policy crosses its own threshold with a strict refund decrease', () => {
  fc.assert(
    fc.property(
      fc.integer({ min: 1, max: 336 }),
      fc.integer({ min: 100_000, max: 200_000_000 }),
      fc.integer({ min: 0, max: 99 }),
      fc.integer({ min: 0, max: 99 }),
      fc.integer({ min: 0, max: 3_600_000 }),
      fc.integer({ min: 1, max: 3_600_000 }),
      (offsetHours, paid, low, gap, before, after) => {
        const high = low + 1 + (gap % (100 - low));
        const policy = {
          tiers: [
            { offsetHours, refundPercent: high, chargeFirstNight: false },
            { offsetHours: -1, refundPercent: low, chargeFirstNight: false },
          ],
        };
        const base = input(paid, 0, policy);
        const earlier = engine.calculateCancellation({
          ...base,
          now: -offsetHours * 3_600_000 - before,
        });
        const later = engine.calculateCancellation({
          ...base,
          now: -offsetHours * 3_600_000 + after,
        });
        expect(earlier.tier).toMatchObject({ offsetHours, refundPercent: high });
        expect(later.tier).toMatchObject({ offsetHours: -1, refundPercent: low });
        expect(later.refundAmount).toBeLessThan(earlier.refundAmount);
        expect(earlier.refundAmount).toBeLessThanOrEqual(paid);
      },
    ),
    { numRuns: 200, seed: 53045 },
  );
});
