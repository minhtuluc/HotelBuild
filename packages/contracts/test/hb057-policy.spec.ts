import { expect, test } from 'vitest';
import { cancellationPolicyUpdateRequestSchema, cancellationTierSchema } from '../src/index.js';

test('canonical tier metadata survives parsing without dropping a first-night charge', () => {
  expect(
    cancellationTierSchema.parse({
      hoursBeforeCheckIn: 0,
      refundPercent: 0,
      offsetHours: -1,
      chargeFirstNight: true,
    }),
  ).toMatchObject({ offsetHours: -1, chargeFirstNight: true });
});
test('legacy zero-hour catch-all payload stays accepted', () => {
  const input = {
    tiers: [{ hoursBeforeCheckIn: 0, refundPercent: 0 }],
    earlyCheckoutFreeHours: 72,
    earlyCheckoutRefundPct: 50,
    reason: 'Synthetic revision',
  };
  expect(cancellationPolicyUpdateRequestSchema.parse(input)).toEqual(input);
});
test('canonical offsets below the catch-all and nonboolean charge flags are rejected', () => {
  for (const extra of [{ offsetHours: -2 }, { chargeFirstNight: 'false' }])
    expect(
      cancellationTierSchema.safeParse({ hoursBeforeCheckIn: 0, refundPercent: 0, ...extra })
        .success,
    ).toBe(false);
});
