import { expect, test } from 'vitest';
import { checkIn } from '../../src/front-office/index.js';
import type { CheckInInput, CheckInUnit } from '../../src/front-office/index.js';
import { approval, debt, input } from './fixtures.js';

test('TC-FO-01 paid CONFIRMED booking can check in', () => {
  expect(checkIn(input)).toEqual({ ok: true, value: { earlyCheckInFee: 0, approvedDebt: 0 } });
});

test.each([
  'DRAFT',
  'HELD',
  'PENDING_PAYMENT',
  'CHECKED_IN',
  'CHECKED_OUT',
  'CANCELLED',
  'EXPIRED',
  'NO_SHOW',
  'unknown',
])('%s cannot check in even with owner approval', (status) => {
  expect(checkIn({ ...debt(6_000_000, 10_000_000, 'OWNER'), status })).toEqual({
    ok: false,
    error: { code: 'E_FO_CHECKIN_NOT_ALLOWED', reason: 'STATUS' },
  });
});

test.each([
  [200_000, 2_000_000],
  [5_000_000, 10_000_000],
  [1, 2],
  [0, 0],
])('manager can approve %i debt on %i total, with inclusive thresholds', (balance, total) => {
  expect(checkIn(debt(balance, total, 'MANAGER'))).toEqual({
    ok: true,
    value: { earlyCheckInFee: 0, approvedDebt: balance },
  });
});

test.each([
  [5_000_001, 20_000_000], // Amount only.
  [2_000_001, 4_000_000], // Percentage only.
  [6_000_000, 10_000_000], // Both (TC-FO-01).
  [1, 1],
  [1, 0],
])('either exceeded manager limit (%i/%i) requires OWNER', (balance, total) => {
  expect(checkIn(debt(balance, total, 'MANAGER'))).toEqual({
    ok: false,
    error: { code: 'E_FO_CHECKIN_NOT_ALLOWED', reason: 'DEBT_APPROVAL_REQUIRED' },
  });
  expect(checkIn(debt(balance, total, 'OWNER'))).toEqual({
    ok: true,
    value: { earlyCheckInFee: 0, approvedDebt: balance },
  });
});

test.each(['FRONT_DESK', 'HOUSEKEEPING', 'ACCOUNTANT', 'ADMIN', 'manager', ''])(
  'role %s cannot approve debt',
  (approverRole) => {
    expect(checkIn(debt(200_000, 2_000_000, approverRole))).toEqual({
      ok: false,
      error: { code: 'E_FO_CHECKIN_NOT_ALLOWED', reason: 'DEBT_APPROVAL_REQUIRED' },
    });
  },
);

test.each([null, { ...approval, bookingId: 'other-booking' }, { ...approval, amount: 199_999 }])(
  'no, other-booking or insufficient approval cannot authorize debt',
  (debtApproval) => {
    expect(checkIn({ ...input, balanceDue: 200_000, debtApproval })).toEqual({
      ok: false,
      error: { code: 'E_FO_CHECKIN_NOT_ALLOWED', reason: 'DEBT_APPROVAL_REQUIRED' },
    });
  },
);

test('higher debt must be approved again even by OWNER', () => {
  expect(
    checkIn({
      ...debt(6_000_000, 10_000_000, 'OWNER'),
      debtApproval: { ...approval, approverRole: 'OWNER', amount: 5_999_999 },
    }),
  ).toEqual({
    ok: false,
    error: { code: 'E_FO_CHECKIN_NOT_ALLOWED', reason: 'DEBT_APPROVAL_REQUIRED' },
  });
  expect(checkIn({ ...input, balanceDue: 100_000, debtApproval: approval })).toEqual({
    ok: true,
    value: { earlyCheckInFee: 0, approvedDebt: 100_000 },
  });
});

test('manager limits come from input SystemSetting values', () => {
  const configured = {
    ...debt(200_000, 2_000_000, 'MANAGER'),
    managerDebtLimits: { amount: 200_000, percent: 10 },
  };
  expect(checkIn(configured)).toEqual({
    ok: true,
    value: { earlyCheckInFee: 0, approvedDebt: 200_000 },
  });
  expect(checkIn({ ...configured, managerDebtLimits: { amount: 199_999, percent: 10 } })).toEqual({
    ok: false,
    error: { code: 'E_FO_CHECKIN_NOT_ALLOWED', reason: 'DEBT_APPROVAL_REQUIRED' },
  });
  expect(checkIn({ ...configured, managerDebtLimits: { amount: 200_000, percent: 9 } })).toEqual({
    ok: false,
    error: { code: 'E_FO_CHECKIN_NOT_ALLOWED', reason: 'DEBT_APPROVAL_REQUIRED' },
  });
});

test.each([
  [4_503_599_627_370_495, true],
  [4_503_599_627_370_496, false],
])('manager percentage comparison stays exact for large integer debt %i', (balance, allowed) => {
  const result = checkIn({
    ...debt(balance, 9_007_199_254_740_991, 'MANAGER'),
    managerDebtLimits: { amount: 9_007_199_254_740_991, percent: 50 },
  });
  expect(result).toEqual(
    allowed
      ? { ok: true, value: { earlyCheckInFee: 0, approvedDebt: balance } }
      : {
          ok: false,
          error: { code: 'E_FO_CHECKIN_NOT_ALLOWED', reason: 'DEBT_APPROVAL_REQUIRED' },
        },
  );
});

test.each<Partial<CheckInUnit>>([
  { status: 'MAINTENANCE' },
  { status: 'INACTIVE' },
  { blockedAtHandover: true },
  { occupiedAtHandover: true },
  { readinessForCurrentRelease: 'PENDING' },
  { readinessForCurrentRelease: 'IN_PROGRESS' },
  { readinessForCurrentRelease: null },
])('one unavailable unit blocks handover of all units (%j)', (patch) => {
  const ready = input.units[0]!;
  expect(checkIn({ ...input, units: [ready, { ...ready, roomId: 'room-2', ...patch }] })).toEqual({
    ok: false,
    error: { code: 'E_FO_CHECKIN_NOT_ALLOWED', reason: 'UNITS_NOT_READY' },
  });
});

test.each(['DONE', 'INSPECTED', 'VERIFIED'] as const)(
  '%s evidence for the current release allows handover',
  (readinessForCurrentRelease) => {
    expect(
      checkIn({ ...input, units: [{ ...input.units[0]!, readinessForCurrentRelease }] }),
    ).toEqual({ ok: true, value: { earlyCheckInFee: 0, approvedDebt: 0 } });
  },
);

test('distinct beds in the same room are distinct selling units', () => {
  const unit = input.units[0]!;
  expect(
    checkIn({
      ...input,
      units: [
        { ...unit, bedNo: 1 },
        { ...unit, bedNo: 2 },
      ],
    }),
  ).toEqual({ ok: true, value: { earlyCheckInFee: 0, approvedDebt: 0 } });
});

test('pure decision does not mutate frozen input, units or approval', () => {
  const request: CheckInInput = Object.freeze({
    ...debt(200_000, 2_000_000, 'MANAGER'),
    units: Object.freeze(input.units.map((unit) => Object.freeze({ ...unit }))),
    localNow: Object.freeze({ ...input.localNow }),
    debtApproval: Object.freeze({ ...approval }),
  });
  const before = JSON.stringify(request);
  const wanted = { ok: true, value: { earlyCheckInFee: 0, approvedDebt: 200_000 } };
  expect(checkIn(request)).toEqual(wanted);
  expect(checkIn(request)).toEqual(wanted);
  expect(JSON.stringify(request)).toBe(before);
});
