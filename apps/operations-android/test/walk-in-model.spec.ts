import { expect, test } from 'vitest';
import { ApiError } from '@pinehill/api-client';
import { walkInRequestSchema } from '@pinehill/contracts';
import {
  actionFailure,
  addDays,
  depositBody,
  guestIssue,
  nextStep,
  pinFailure,
  previousStep,
  stayIssue,
  stepNumber,
  toWalkInRequest,
  validBusinessDate,
  walkInDefaults,
  WALK_IN_STEPS,
} from '../src/walk-in/model';

const stay = { ...walkInDefaults('p1', '2026-10-22'), roomTypeId: 'rt1' };
const guest = { fullName: ' Nguyễn Văn A ', phone: ' 0912345678 ' };

test('there are exactly five steps and navigation clamps at both ends', () => {
  expect(WALK_IN_STEPS).toEqual(['stay', 'guest', 'review', 'deposit', 'done']);
  expect(WALK_IN_STEPS.map(stepNumber)).toEqual([1, 2, 3, 4, 5]);
  expect(nextStep('stay')).toBe('guest');
  expect(nextStep('done')).toBe('done');
  expect(previousStep('guest')).toBe('stay');
  expect(previousStep('stay')).toBe('stay');
});

test('calendar helpers do not drift across month, year and leap boundaries', () => {
  expect(validBusinessDate('2026-02-29')).toBe(false);
  expect(validBusinessDate('2028-02-29')).toBe(true);
  expect(validBusinessDate('2026-1-1')).toBe(false);
  expect(addDays('2026-10-31', 1)).toBe('2026-11-01');
  expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
  expect(addDays('2028-02-28', 1)).toBe('2028-02-29');
});

test('defaults start today for one night, FLEX7, 2 adults, 1 room', () => {
  expect(walkInDefaults('p1', '2026-10-22')).toEqual({
    propertyId: 'p1',
    roomTypeId: '',
    ratePlanCode: 'FLEX7',
    checkIn: '2026-10-22',
    checkOut: '2026-10-23',
    adults: '2',
    children: '0',
    roomCount: '1',
  });
});

test('stayIssue reports the first form problem only; the server still owns price and stock', () => {
  expect(stayIssue(stay)).toBeNull();
  expect(stayIssue({ ...stay, propertyId: '' })).toBe('PROPERTY');
  expect(stayIssue({ ...stay, roomTypeId: '' })).toBe('ROOM_TYPE');
  expect(stayIssue({ ...stay, checkIn: 'x' })).toBe('DATES');
  expect(stayIssue({ ...stay, checkOut: stay.checkIn })).toBe('DATES');
  expect(stayIssue({ ...stay, adults: '0' })).toBe('COUNTS');
  expect(stayIssue({ ...stay, children: '-1' })).toBe('COUNTS');
  expect(stayIssue({ ...stay, roomCount: '11' })).toBe('COUNTS');
  expect(stayIssue({ ...stay, adults: '2.5' })).toBe('COUNTS');
});

test('guestIssue accepts 0XXXXXXXXX and +84XXXXXXXXX only', () => {
  expect(guestIssue(guest)).toBeNull();
  expect(guestIssue({ ...guest, phone: '+84912345678' })).toBeNull();
  expect(guestIssue({ ...guest, fullName: '  ' })).toBe('NAME');
  expect(guestIssue({ ...guest, fullName: 'x'.repeat(121) })).toBe('NAME');
  expect(guestIssue({ ...guest, phone: '091234567' })).toBe('PHONE');
  expect(guestIssue({ ...guest, phone: '84912345678' })).toBe('PHONE');
});

test('toWalkInRequest builds a body the strict contract accepts, without a channelCode', () => {
  const request = toWalkInRequest(stay, guest, '  ');
  expect(request).toEqual({
    propertyId: 'p1',
    roomTypeId: 'rt1',
    ratePlanCode: 'FLEX7',
    checkIn: '2026-10-22',
    checkOut: '2026-10-23',
    adults: 2,
    children: 0,
    roomCount: 1,
    guest: { fullName: 'Nguyễn Văn A', phone: '0912345678' },
  });
  expect(walkInRequestSchema.safeParse(request).success).toBe(true);
  expect(toWalkInRequest(stay, guest, ' khách quen ').note).toBe('khách quen');
  expect(() => toWalkInRequest({ ...stay, adults: 'x' }, guest, '')).toThrow(RangeError);
});

test('depositBody carries the server deposit amount and a one-time pinToken, never card data', () => {
  expect(depositBody('b1', 'CASH', 907_000, 'p'.repeat(16))).toEqual({
    bookingId: 'b1',
    type: 'DEPOSIT',
    method: 'CASH',
    amount: 907_000,
    pinToken: 'p'.repeat(16),
  });
});

const http = (status: number, code: string, message = 'm') =>
  new ApiError({ kind: 'http', status, code, message });

test('actionFailure separates certain rejection, conflict, forbidden and unknown outcome', () => {
  expect(actionFailure(http(409, 'E_BOOK_X', 'Hết phòng'))).toEqual({
    kind: 'rejected',
    code: 'E_BOOK_X',
    status: 409,
    reason: 'Hết phòng',
  });
  expect(actionFailure(http(403, 'E_RBAC_FORBIDDEN'))).toEqual({ kind: 'forbidden' });
  expect(actionFailure(http(412, 'E_GEN_VERSION_CONFLICT'))).toEqual({ kind: 'conflict' });
  expect(actionFailure(http(401, 'E_AUTH_PIN_REQUIRED'))).toMatchObject({ kind: 'rejected' });
  expect(actionFailure(http(502, 'E_SYS')).kind).toBe('unknownOutcome');
  expect(actionFailure(new ApiError({ kind: 'timeout', message: 't', traceId: 'tr' }))).toEqual({
    kind: 'unknownOutcome',
    reference: 'tr',
  });
  expect(actionFailure(new Error('x')).kind).toBe('unknownOutcome');
});

test('pinFailure distinguishes wrong PIN, lock-out (with minutes) and unavailable', () => {
  expect(pinFailure(http(401, 'E_AUTH_INVALID_CREDENTIALS'))).toEqual({ kind: 'wrong' });
  expect(pinFailure(http(401, 'E_AUTH_PIN_REQUIRED'))).toEqual({ kind: 'wrong' });
  expect(
    pinFailure(
      new ApiError({
        kind: 'http',
        status: 423,
        code: 'E_AUTH_PIN_LOCKED',
        message: 'l',
        retryAfterSeconds: 601,
      }),
    ),
  ).toEqual({ kind: 'locked', minutes: 11 });
  expect(pinFailure(http(423, 'E_AUTH_PIN_LOCKED'))).toEqual({ kind: 'locked', minutes: null });
  expect(pinFailure(http(500, 'E_SYS'))).toEqual({ kind: 'unavailable' });
  expect(pinFailure(new Error('x'))).toEqual({ kind: 'unavailable' });
});
