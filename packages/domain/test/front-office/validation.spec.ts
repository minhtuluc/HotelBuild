import { expect, test } from 'vitest';
import { checkIn } from '../../src/front-office/index.js';
import type { CheckInInput, CheckInUnit } from '../../src/front-office/index.js';
import { approval, input } from './fixtures.js';

function invalid(request: CheckInInput): void {
  const result = checkIn(request);
  expect(result.ok).toBe(false);
  if (result.ok) expect.fail('Malformed facts must be rejected');
  expect(result.error.code).toBe('E_FO_INVALID_INPUT');
  if (result.error.code !== 'E_FO_INVALID_INPUT') expect.fail('Expected invalid-input failure');
  expect(result.error.message).toBeTypeOf('string');
}

test.each(['totalAmount', 'balanceDue', 'firstNightAmount'] as const)(
  '%s rejects negative, fractional, nonfinite and unsafe VND',
  (field) => {
    for (const value of [
      -1,
      0.5,
      Number.NaN,
      Number.POSITIVE_INFINITY,
      Number.MAX_SAFE_INTEGER + 1,
    ])
      invalid({ ...input, [field]: value });
  },
);

test.each(['', ' ', '2026-2-01', '2026-02-30', '2026-13-01', '2025-02-29'])(
  'invalid civil date %s fails closed for both dates',
  (date) => {
    invalid({ ...input, checkInDate: date });
    invalid({ ...input, localNow: { ...input.localNow, date } });
  },
);

test.each([-1, 0.5, Number.NaN, Number.POSITIVE_INFINITY, 86_400_000])(
  'invalid time of day %s fails closed',
  (millisecondsSinceMidnight) => {
    invalid({ ...input, localNow: { ...input.localNow, millisecondsSinceMidnight } });
  },
);

test('non-Vietnam timezone or non-string date is invalid', () => {
  // @ts-expect-error Runtime boundary must reject a timezone that is outside the declared input.
  invalid({ ...input, localNow: { ...input.localNow, timeZone: 'UTC' } });
  // @ts-expect-error Malformed runtime date.
  invalid({ ...input, checkInDate: 20261005 });
});

test.each(['', ' '])('empty booking ID %j is invalid', (bookingId) =>
  invalid({ ...input, bookingId }),
);
test('non-string booking ID is invalid', () => {
  // @ts-expect-error Malformed runtime identity.
  invalid({ ...input, bookingId: 1 });
});

test.each<Partial<CheckInUnit>>([{ roomId: '' }, { roomId: ' ' }, { bedNo: -1 }, { bedNo: 0.5 }])(
  'invalid selling unit identity %j fails closed',
  (patch) => invalid({ ...input, units: [{ ...input.units[0]!, ...patch }] }),
);

test('malformed readiness booleans and room ID fail closed', () => {
  // @ts-expect-error Malformed runtime flag, truthiness is insufficient.
  invalid({ ...input, units: [{ ...input.units[0]!, blockedAtHandover: 'false' }] });
  // @ts-expect-error Malformed runtime flag.
  invalid({ ...input, units: [{ ...input.units[0]!, occupiedAtHandover: null }] });
  // @ts-expect-error Malformed runtime identity.
  invalid({ ...input, units: [{ ...input.units[0]!, roomId: 1 }] });
});

test('empty or duplicate selling units fail closed', () => {
  invalid({ ...input, units: [] });
  invalid({ ...input, units: [input.units[0]!, input.units[0]!] });
});

test.each([
  { amount: -1, percent: 50 },
  { amount: 0.5, percent: 50 },
  { amount: 5_000_000, percent: -1 },
  { amount: 5_000_000, percent: 50.5 },
  { amount: 5_000_000, percent: 101 },
])('invalid manager threshold %j fails closed', (managerDebtLimits) =>
  invalid({ ...input, managerDebtLimits }),
);

test.each([-1, 0.5])('invalid approved debt %s fails closed', (amount) =>
  invalid({ ...input, debtApproval: { ...approval, amount } }),
);
test('invalid approval identity or role type fails closed', () => {
  invalid({ ...input, debtApproval: { ...approval, bookingId: '' } });
  // @ts-expect-error Malformed runtime approver role, not a permission fact.
  invalid({ ...input, debtApproval: { ...approval, approverRole: 1 } });
});
