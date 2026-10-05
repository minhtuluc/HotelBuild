import { expect, test } from 'vitest';
import * as policy from '@pinehill/domain/front-office';
import { input } from './fixtures.js';

test('front-office entrypoint exposes the check-in decision', () => {
  expect(policy).toHaveProperty('checkIn', expect.any(Function));
  expect(policy.checkIn(input)).toEqual({
    ok: true,
    value: { earlyCheckInFee: 0, approvedDebt: 0 },
  });
});
