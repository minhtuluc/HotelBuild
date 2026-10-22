import { expect, test } from 'vitest';
import { ApiError } from '@pinehill/api-client';
import type { BookingSummary } from '@pinehill/contracts';
import {
  amountIssue,
  checkOutBody,
  collectBody,
  departuresOf,
  isEarlyCheckOut,
  isUnsettled,
  pinIssue,
  pinUnlockFailure,
  readFailure,
  stayFailure,
} from '../src/stay/model';

const booking = (over: Partial<BookingSummary> = {}): BookingSummary => ({
  id: 'b1',
  code: 'PH-261020-A',
  seq: 1,
  status: 'CHECKED_IN',
  guestId: 'g1',
  propertyId: 'p1',
  roomTypeId: 'rt1',
  ratePlanId: 'rp1',
  channelId: 'ch1',
  checkIn: '2026-10-20',
  checkOut: '2026-10-22',
  nights: 2,
  adults: 2,
  children: 0,
  roomCount: 1,
  totalAmount: 3_000_000,
  depositPercent: 30,
  depositAmount: 900_000,
  paidAmount: 3_000_000,
  refundedAmount: 0,
  balanceDue: 0,
  penaltyAmount: 0,
  currency: 'VND',
  rescheduleCount: 0,
  holdExpiresAt: null,
  oversold: false,
  priceLocked: false,
  duplicateSuspected: false,
  channelPolicyCode: null,
  note: null,
  createdBy: 'u1',
  createdAt: '2026-10-01T00:00:00.000Z',
  ...over,
});

const http = (status: number, code: string, message = 'm') =>
  new ApiError({ kind: 'http', status, code, message });

test('departuresOf lists in-house stays due today or overdue, sorted by code', () => {
  const rows = departuresOf(
    [
      booking({ id: 'b2', code: 'PH-B' }),
      booking({ id: 'b1', code: 'PH-A', checkOut: '2026-10-21' }),
      booking({ id: 'x1', code: 'PH-C', checkOut: '2026-10-23' }),
      booking({ id: 'x2', code: 'PH-D', status: 'CONFIRMED' }),
      booking({ id: 'x3', code: 'PH-E', status: 'CHECKED_OUT' }),
    ],
    '2026-10-22',
  );
  expect(rows.map((r) => r.id)).toEqual(['b1', 'b2']);
});

test('isEarlyCheckOut only prefills the form: checkOut date after the business date', () => {
  expect(isEarlyCheckOut(booking({ checkOut: '2026-10-23' }), '2026-10-22')).toBe(true);
  expect(isEarlyCheckOut(booking({ checkOut: '2026-10-22' }), '2026-10-22')).toBe(false);
  expect(isEarlyCheckOut(booking({ checkOut: '2026-10-21' }), '2026-10-22')).toBe(false);
});

test('pinIssue accepts exactly six digits', () => {
  expect(pinIssue('123456')).toBeNull();
  expect(pinIssue('12345')).toBe('FORMAT');
  expect(pinIssue('1234567')).toBe('FORMAT');
  expect(pinIssue('12345a')).toBe('FORMAT');
});

test('amountIssue: whole positive VND, never above what the server says is due', () => {
  expect(amountIssue('2100000', 2_100_000)).toBeNull();
  expect(amountIssue(' 500000 ', 2_100_000)).toBeNull();
  expect(amountIssue('2100001', 2_100_000)).toBe('OVER');
  expect(amountIssue('0', 2_100_000)).toBe('POSITIVE');
  expect(amountIssue('12.5', 2_100_000)).toBe('FORMAT');
  expect(amountIssue('-1', 2_100_000)).toBe('FORMAT');
  expect(amountIssue('', 2_100_000)).toBe('FORMAT');
  expect(amountIssue('99999999999999999999', Number.MAX_SAFE_INTEGER)).toBe('FORMAT');
});

test('collectBody builds a BALANCE counter payment and omits a blank note', () => {
  expect(collectBody('b1', { method: 'CASH', amount: '2100000', note: '  ' })).toEqual({
    bookingId: 'b1',
    type: 'BALANCE',
    method: 'CASH',
    amount: 2_100_000,
  });
  expect(collectBody('b1', { method: 'BANK_TRANSFER', amount: '5', note: ' ck ' })).toEqual({
    bookingId: 'b1',
    type: 'BALANCE',
    method: 'BANK_TRANSFER',
    amount: 5,
    note: 'ck',
  });
  expect(() => collectBody('b1', { method: 'CASH', amount: 'x', note: '' })).toThrow(RangeError);
});

test('checkOutBody sends the early flag and never invents a late flag or extras', () => {
  expect(checkOutBody('b1', { early: false, note: '' })).toEqual({
    bookingId: 'b1',
    lateCheckOut: false,
    earlyCheckOut: false,
  });
  expect(checkOutBody('b1', { early: true, note: ' ok ' })).toEqual({
    bookingId: 'b1',
    lateCheckOut: false,
    earlyCheckOut: true,
    note: 'ok',
  });
});

test('stayFailure keeps PIN-required apart from plain 401 and flags the unsettled balance', () => {
  expect(stayFailure(http(401, 'E_AUTH_PIN_REQUIRED'))).toEqual({ kind: 'pinRequired' });
  expect(stayFailure(http(401, 'E_AUTH_TOKEN_EXPIRED'))).toEqual({ kind: 'forbidden' });
  const unsettled = stayFailure(http(422, 'E_PAY_AMOUNT_MISMATCH', 'Còn số dư'));
  expect(unsettled).toMatchObject({ kind: 'rejected', code: 'E_PAY_AMOUNT_MISMATCH', status: 422 });
  expect(isUnsettled(unsettled)).toBe(true);
  expect(isUnsettled(stayFailure(http(409, 'E_BOOK_INVALID_STATE')))).toBe(false);
  expect(stayFailure(http(502, 'X')).kind).toBe('unknownOutcome');
});

test('pinUnlockFailure separates wrong PIN, lockout and unavailability', () => {
  expect(pinUnlockFailure(http(401, 'E_AUTH_PIN_REQUIRED'))).toEqual({ kind: 'wrong' });
  expect(pinUnlockFailure(http(401, 'E_AUTH_INVALID_CREDENTIALS'))).toEqual({ kind: 'wrong' });
  expect(
    pinUnlockFailure(
      new ApiError({
        kind: 'http',
        status: 423,
        code: 'E_AUTH_PIN_LOCKED',
        message: 'x',
        retryAfterSeconds: 900,
      }),
    ),
  ).toEqual({ kind: 'locked', retryAfterSeconds: 900 });
  expect(pinUnlockFailure(http(401, 'E_AUTH_TOKEN_EXPIRED'))).toEqual({ kind: 'expired' });
  expect(pinUnlockFailure(http(500, 'E_SYS_INTERNAL'))).toEqual({ kind: 'unavailable' });
  expect(pinUnlockFailure(new Error('x'))).toEqual({ kind: 'unavailable' });
});

test('readFailure maps transport and status to a screen phase', () => {
  expect(readFailure(new ApiError({ kind: 'network', message: 'x' }))).toBe('offline');
  expect(readFailure(http(401, 'X'))).toBe('expired');
  expect(readFailure(http(403, 'X'))).toBe('forbidden');
  expect(readFailure(http(500, 'X'))).toBe('error');
  expect(readFailure(new Error('x'))).toBe('error');
});
