import { expect, test } from 'vitest';
import { checkIn } from '../../src/front-office/index.js';
import { input } from './fixtures.js';

test.each([
  ['2026-10-05', 86_339_999, null],
  ['2026-10-05', 86_340_000, 'NO_SHOW_REQUIRED'],
  ['2026-10-05', 86_399_999, 'NO_SHOW_REQUIRED'],
  ['2026-10-06', 1_800_000, 'NO_SHOW_REQUIRED'], // TC-FO-02 00:30 next day.
  ['2026-10-04', 54_000_000, 'WRONG_DATE'],
] as const)(
  'Vietnamese date %s time %i has result %s',
  (date, millisecondsSinceMidnight, reason) => {
    const result = checkIn({
      ...input,
      localNow: { ...input.localNow, date, millisecondsSinceMidnight },
    });
    expect(result).toEqual(
      reason === null
        ? { ok: true, value: { earlyCheckInFee: 0, approvedDebt: 0 } }
        : { ok: false, error: { code: 'E_FO_CHECKIN_NOT_ALLOWED', reason } },
    );
  },
);

test.each([
  [23_400_000, 'ADDITIONAL_NIGHT_REQUIRED'], // TC-FO-04 06:30.
  [28_799_999, 'ADDITIONAL_NIGHT_REQUIRED'],
  [28_800_000, 0],
  [32_400_000, 0],
  [43_199_999, 0],
  [43_200_000, 330_000],
  [46_800_000, 330_000],
  [50_399_999, 330_000],
  [50_400_000, 0],
] as const)('early check-in at millisecond %i gives %s', (millisecondsSinceMidnight, fee) => {
  const result = checkIn({ ...input, localNow: { ...input.localNow, millisecondsSinceMidnight } });
  expect(result).toEqual(
    typeof fee === 'number'
      ? { ok: true, value: { earlyCheckInFee: fee, approvedDebt: 0 } }
      : { ok: false, error: { code: 'E_FO_CHECKIN_NOT_ALLOWED', reason: fee } },
  );
});

test.each([
  [0, 0],
  [1, 1_000],
  [3_333, 1_000],
  [3_334, 2_000],
  [1_100_001, 331_000],
  [9_007_199_254_740_991, 2_702_159_776_423_000],
])('30 percent of %i VND rounds up exactly to %i', (firstNightAmount, fee) => {
  expect(
    checkIn({
      ...input,
      firstNightAmount,
      localNow: { ...input.localNow, millisecondsSinceMidnight: 46_800_000 },
    }),
  ).toEqual({ ok: true, value: { earlyCheckInFee: fee, approvedDebt: 0 } });
});

test('same civil date uses Vietnamese time supplied by caller, not system clock', () => {
  expect(
    checkIn({
      ...input,
      checkInDate: '2024-02-29',
      localNow: { ...input.localNow, date: '2024-02-29' },
    }),
  ).toEqual({ ok: true, value: { earlyCheckInFee: 0, approvedDebt: 0 } });
});
