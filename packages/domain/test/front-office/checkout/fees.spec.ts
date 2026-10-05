import { expect, test } from 'vitest';
import { checkOutFee } from '@pinehill/domain/front-office';
import type { CheckOutFeeInput } from '@pinehill/domain/front-office';

const input: CheckOutFeeInput = {
  checkOutDate: '2026-10-05',
  lastNightAmount: 1_100_000,
  localNow: {
    date: '2026-10-05',
    millisecondsSinceMidnight: 41_400_000,
    timeZone: 'Asia/Ho_Chi_Minh',
  },
};
function at(time: number, date = '2026-10-05'): CheckOutFeeInput {
  return { ...input, localNow: { ...input.localNow, date, millisecondsSinceMidnight: time } };
}

test.each([
  [41_400_000, 0, 0],
  [54_000_000, 50, 550_000],
  [68_400_000, 100, 1_100_000], // TC-FO-03.
  [43_199_999, 0, 0],
  [43_200_000, 50, 550_000],
  [64_799_999, 50, 550_000],
  [64_800_000, 50, 550_000],
  [64_800_001, 100, 1_100_000],
] as const)(
  'TC-FO-03 at %i ms charges %i percent = %i VND',
  (time, lateFeePercent, lateCheckOutFee) => {
    expect(checkOutFee(at(time))).toEqual({
      ok: true,
      value: { lateFeePercent, lateCheckOutFee, earlyCheckout: null },
    });
  },
);

test.each([0, 41_400_000, 68_400_000, 86_399_999])(
  'early date at %i ms returns unused nights and charges no late fee',
  (time) => {
    expect(checkOutFee(at(time, '2026-10-04'))).toEqual({
      ok: true,
      value: {
        lateFeePercent: 0,
        lateCheckOutFee: 0,
        earlyCheckout: {
          reason: 'EARLY_CHECKOUT',
          actualLocalTime: {
            date: '2026-10-04',
            millisecondsSinceMidnight: time,
            timeZone: 'Asia/Ho_Chi_Minh',
          },
          unusedNightRange: { startDate: '2026-10-04', endDate: '2026-10-05' },
        },
      },
    });
  },
);

test('midnight after the scheduled checkout day is already past its 18:00 cutoff', () => {
  expect(checkOutFee(at(0, '2026-10-06'))).toEqual({
    ok: true,
    value: { lateFeePercent: 100, lateCheckOutFee: 1_100_000, earlyCheckout: null },
  });
});

test.each([
  [0, 54_000_000, 0],
  [1, 54_000_000, 1_000],
  [2_000, 54_000_000, 1_000],
  [2_001, 54_000_000, 2_000],
  [1_100_001, 54_000_000, 551_000],
  [1_100_001, 68_400_000, 1_101_000],
  [9_007_199_254_740_991, 54_000_000, 4_503_599_627_371_000],
  [9_007_199_254_740_000, 68_400_000, 9_007_199_254_740_000],
])('round-up of %i VND at %i ms is exactly %i VND', (lastNightAmount, time, fee) => {
  const result = checkOutFee({ ...at(time), lastNightAmount });
  expect(result.ok).toBe(true);
  if (!result.ok) expect.fail('Valid fee quote must succeed');
  expect(result.value.lateCheckOutFee).toBe(fee);
});

test('rounded 100-percent fee overflow is refused instead of returning unsafe VND', () => {
  const result = checkOutFee({ ...at(68_400_000), lastNightAmount: Number.MAX_SAFE_INTEGER });
  expect(result.ok).toBe(false);
  if (result.ok) expect.fail('Rounded VND exceeds safe range');
  expect(result.error.code).toBe('E_FO_UNSAFE_AMOUNT');
});

test('Gregorian leap-day facts and frozen inputs are deterministic without system time', () => {
  const request = Object.freeze({
    ...input,
    checkOutDate: '2024-03-01',
    localNow: Object.freeze({ ...input.localNow, date: '2024-02-29' }),
  });
  const wanted = {
    ok: true,
    value: {
      lateFeePercent: 0,
      lateCheckOutFee: 0,
      earlyCheckout: {
        reason: 'EARLY_CHECKOUT',
        actualLocalTime: {
          date: '2024-02-29',
          millisecondsSinceMidnight: 41_400_000,
          timeZone: 'Asia/Ho_Chi_Minh',
        },
        unusedNightRange: { startDate: '2024-02-29', endDate: '2024-03-01' },
      },
    },
  };
  const before = JSON.stringify(request);
  expect(checkOutFee(request)).toEqual(wanted);
  expect(checkOutFee(request)).toEqual(wanted);
  expect(JSON.stringify(request)).toBe(before);
});

test('early facts copy the caller clock instead of sharing its mutable object', () => {
  const request = at(41_400_000, '2026-10-04');
  const result = checkOutFee(request);
  expect(result.ok).toBe(true);
  if (!result.ok) expect.fail('Early facts expected');
  expect(result.value.earlyCheckout?.actualLocalTime).not.toBe(request.localNow);
});

function invalid(request: CheckOutFeeInput): void {
  const result = checkOutFee(request);
  expect(result.ok).toBe(false);
  if (result.ok) expect.fail('Invalid snapshot must fail');
  expect(result.error.code).toBe('E_FO_INVALID_INPUT');
}
test.each([-1, 0.5, Number.NaN, Number.POSITIVE_INFINITY, Number.MAX_SAFE_INTEGER + 1])(
  'invalid VND %s fails closed',
  (lastNightAmount) => invalid({ ...input, lastNightAmount }),
);
test.each([-1, 0.5, Number.NaN, Number.POSITIVE_INFINITY, 86_400_000])(
  'invalid clock %s fails closed',
  (time) => invalid(at(time)),
);
test.each(['', '2026-2-01', '2026-02-30', '2026-13-01', '2025-02-29'])(
  'invalid civil date %s fails closed on both sides',
  (date) => {
    invalid({ ...input, checkOutDate: date });
    invalid(at(41_400_000, date));
  },
);
test('timezone and malformed date types are refused', () => {
  // @ts-expect-error Runtime fact outside the declared VN timezone.
  invalid({ ...input, localNow: { ...input.localNow, timeZone: 'UTC' } });
  // @ts-expect-error Malformed runtime date.
  invalid({ ...input, checkOutDate: 20261005 });
});
