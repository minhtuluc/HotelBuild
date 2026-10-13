import { expect, test } from 'vitest';
import type { CancellationPolicy } from '@pinehill/contracts';
import {
  policyDraftOf,
  policyUpdateRequest,
  policyDiff,
  validateTiers,
} from '../src/lib/rate-plans';
const policy: CancellationPolicy = {
  id: 'synthetic-policy',
  name: 'Synthetic',
  status: 'ACTIVE',
  version: 1,
  tiers: [
    { hoursBeforeCheckIn: 0, offsetHours: 0, refundPercent: 0, chargeFirstNight: true },
    { hoursBeforeCheckIn: 0, offsetHours: -1, refundPercent: 0, chargeFirstNight: true },
  ],
  earlyCheckoutFreeHours: 0,
  earlyCheckoutRefundPct: 0,
};
test('published0 check-in and -1 catch-all round-trip as two distinct canonical tiers', () => {
  const draft = { ...policyDraftOf(policy), reason: 'Synthetic update' };
  expect(validateTiers(draft.tiers)).toEqual([]);
  expect(policyUpdateRequest(draft).tiers).toEqual(policy.tiers);
});
test('comparison includes canonical offset and first-night flag instead of only legacy0 aliases', () => {
  const server = { ...policy, tiers: policy.tiers.map((t) => ({ ...t, chargeFirstNight: false })) };
  const diff = policyDiff(policyDraftOf(policy), server);
  expect(diff).toContainEqual({
    label: 'tiers[0].chargeFirstNight',
    local: 'true',
    server: 'false',
  });
  expect(diff).toContainEqual({ label: 'tiers[1].offsetHours', local: '-1', server: '-1' });
});
test('BR-RATE-20 accepts five ordered tiers with exactly one catch-all', () => {
  expect(
    validateTiers(
      policyDraftOf({
        ...policy,
        tiers: [168, 72, 24, 12, -1].map((offsetHours) => ({
          hoursBeforeCheckIn: Math.max(0, offsetHours),
          offsetHours,
          refundPercent: 0,
          chargeFirstNight: false,
        })),
      }).tiers,
    ),
  ).toEqual([]);
});
test('invalid draft is rejected rather than silently becoming0 in a full policy replacement', () => {
  const draft = { ...policyDraftOf(policy), reason: 'Synthetic update' };
  draft.tiers[0]!.refundPercent = 'invalid';
  expect(() => policyUpdateRequest(draft)).toThrow();
});

test('comparison omits the derived legacy alias because only the canonical offset is edited', () => {
  const diff = policyDiff(policyDraftOf(policy), policy);
  expect(diff.map((row) => row.label)).not.toContain('tiers[0].hoursBeforeCheckIn');
});
