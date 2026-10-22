import { expect, test } from 'vitest';
import { ApiError } from '@pinehill/api-client';
import type { BookingSummary, RoomSummary } from '@pinehill/contracts';
import {
  actionFailure,
  arrivalsOf,
  checkInBody,
  filterArrivals,
  parseBookingCodeFromScan,
  roomChoices,
  roomSelectionIssue,
  suggestRooms,
} from '../src/arrivals/model';

const booking = (over: Partial<BookingSummary> = {}): BookingSummary => ({
  id: 'b1',
  code: 'PH-261022-A7K2M',
  seq: 1,
  status: 'CONFIRMED',
  guestId: 'g1',
  propertyId: 'p1',
  roomTypeId: 'rt1',
  ratePlanId: 'rp1',
  channelId: 'ch1',
  checkIn: '2026-10-22',
  checkOut: '2026-10-24',
  nights: 2,
  adults: 2,
  children: 0,
  roomCount: 1,
  totalAmount: 3_000_000,
  depositPercent: 30,
  depositAmount: 900_000,
  paidAmount: 900_000,
  refundedAmount: 0,
  balanceDue: 2_100_000,
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

const room = (over: Partial<RoomSummary> = {}): RoomSummary => ({
  id: 'r1',
  propertyId: 'p1',
  roomTypeId: 'rt1',
  code: 'CS01-101',
  floor: 1,
  status: 'ACTIVE',
  connectingRoomId: null,
  version: 0,
  ...over,
});

test('arrivalsOf keeps only arrivals of the business date and sorts by code', () => {
  const rows = arrivalsOf(
    [
      booking({ id: 'b2', code: 'PH-261022-B' }),
      booking({ id: 'b1', code: 'PH-261022-A' }),
      booking({ id: 'x1', code: 'PH-261021-X', checkIn: '2026-10-21' }),
      booking({ id: 'x2', code: 'PH-261022-C', status: 'CANCELLED' }),
      booking({ id: 'x3', code: 'PH-261022-D', status: 'CHECKED_IN' }),
      booking({ id: 'h1', code: 'PH-261022-E', status: 'HELD' }),
      booking({ id: 'p1', code: 'PH-261022-F', status: 'PENDING_PAYMENT' }),
    ],
    '2026-10-22',
  );
  expect(rows.map((row) => row.id)).toEqual(['b1', 'b2', 'h1', 'p1']);
});

test('filterArrivals matches a booking code fragment case-insensitively and ignores dashes/spaces', () => {
  const rows = [
    booking({ id: 'b1', code: 'PH-261022-A7K2M' }),
    booking({ id: 'b2', code: 'PH-261022-C4D8' }),
  ];
  expect(filterArrivals(rows, '').map((r) => r.id)).toEqual(['b1', 'b2']);
  expect(filterArrivals(rows, '  ').map((r) => r.id)).toEqual(['b1', 'b2']);
  expect(filterArrivals(rows, 'a7k').map((r) => r.id)).toEqual(['b1']);
  expect(filterArrivals(rows, 'PH 261022 C4').map((r) => r.id)).toEqual(['b2']);
  expect(filterArrivals(rows, 'zzz')).toEqual([]);
});

test('parseBookingCodeFromScan extracts a booking code from a raw code or an embedding URL', () => {
  expect(parseBookingCodeFromScan('PH-261022-A7K2M')).toBe('PH-261022-A7K2M');
  expect(parseBookingCodeFromScan('  ph-261022-a7k2m\n')).toBe('PH-261022-A7K2M');
  expect(parseBookingCodeFromScan('https://pinehill.example/b/PH-261022-A7K2M?x=1')).toBe(
    'PH-261022-A7K2M',
  );
  expect(parseBookingCodeFromScan('hello')).toBeNull();
  expect(parseBookingCodeFromScan('')).toBeNull();
  expect(parseBookingCodeFromScan('x'.repeat(5000))).toBeNull();
});

test('roomChoices keeps ACTIVE rooms of the booking property and room type, sorted by code', () => {
  const rooms = [
    room({ id: 'r3', code: 'CS01-103' }),
    room({ id: 'r1', code: 'CS01-101' }),
    room({ id: 'r2', code: 'CS01-102', status: 'MAINTENANCE' }),
    room({ id: 'r4', code: 'CS01-104', roomTypeId: 'rt2' }),
    room({ id: 'r5', code: 'CS02-101', propertyId: 'p2' }),
  ];
  expect(roomChoices(rooms, booking()).map((r) => r.id)).toEqual(['r1', 'r3']);
});

test('suggestRooms preselects exactly roomCount rooms so a one-room check-in needs no extra tap', () => {
  const choices = [
    room({ id: 'r1' }),
    room({ id: 'r2', code: 'CS01-102' }),
    room({ id: 'r3', code: 'CS01-103' }),
  ];
  expect(suggestRooms(choices, booking({ roomCount: 1 }))).toEqual(['r1']);
  expect(suggestRooms(choices, booking({ roomCount: 2 }))).toEqual(['r1', 'r2']);
  expect(suggestRooms(choices.slice(0, 1), booking({ roomCount: 2 }))).toEqual(['r1']);
});

test('roomSelectionIssue reports COUNT for wrong size and TYPE for foreign/duplicate rooms', () => {
  const choices = [room({ id: 'r1' }), room({ id: 'r2', code: 'CS01-102' })];
  expect(roomSelectionIssue(['r1'], booking({ roomCount: 1 }), choices)).toBeNull();
  expect(roomSelectionIssue([], booking({ roomCount: 1 }), choices)).toBe('COUNT');
  expect(roomSelectionIssue(['r1', 'r2'], booking({ roomCount: 1 }), choices)).toBe('COUNT');
  expect(roomSelectionIssue(['zz'], booking({ roomCount: 1 }), choices)).toBe('TYPE');
  expect(roomSelectionIssue(['r1', 'r1'], booking({ roomCount: 2 }), choices)).toBe('TYPE');
});

test('checkInBody trims optional text and omits it when blank', () => {
  expect(
    checkInBody('b1', { roomIds: ['r1'], earlyCheckIn: false, idNumber: '  ', note: '' }),
  ).toEqual({ bookingId: 'b1', actualRoomIds: ['r1'], earlyCheckIn: false });
  expect(
    checkInBody('b1', {
      roomIds: ['r1', 'r2'],
      earlyCheckIn: true,
      idNumber: ' 0123 ',
      note: ' ok ',
    }),
  ).toEqual({
    bookingId: 'b1',
    actualRoomIds: ['r1', 'r2'],
    earlyCheckIn: true,
    idNumber: '0123',
    note: 'ok',
  });
});

const http = (status: number, code: string, message = 'm') =>
  new ApiError({ kind: 'http', status, code, message });

test('actionFailure separates certain rejections, conflicts, forbidden and unknown outcomes', () => {
  expect(actionFailure(http(409, 'E_FO_CHECKIN_NOT_ALLOWED', 'Còn nợ'))).toEqual({
    kind: 'rejected',
    code: 'E_FO_CHECKIN_NOT_ALLOWED',
    status: 409,
    reason: 'Còn nợ',
  });
  expect(actionFailure(http(403, 'E_RBAC_FORBIDDEN'))).toEqual({ kind: 'forbidden' });
  expect(actionFailure(http(401, 'E_AUTH_EXPIRED'))).toEqual({ kind: 'forbidden' });
  expect(actionFailure(http(412, 'E_GEN_VERSION_CONFLICT'))).toEqual({ kind: 'conflict' });
  expect(actionFailure(http(409, 'E_SYS_IDEMPOTENCY_KEY_REUSED'))).toEqual({ kind: 'conflict' });
  expect(actionFailure(http(500, 'E_SYS_INTERNAL')).kind).toBe('unknownOutcome');
  expect(actionFailure(new ApiError({ kind: 'network', message: 'down' })).kind).toBe(
    'unknownOutcome',
  );
  expect(actionFailure(new Error('boom')).kind).toBe('unknownOutcome');
});
