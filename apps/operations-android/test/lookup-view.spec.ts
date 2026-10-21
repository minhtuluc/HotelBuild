import { expect, test } from 'vitest';
import type { BookingSummary, GuestSummary, UserRole } from '@pinehill/contracts';
import {
  buildRows,
  formatStay,
  formatVnd,
  guestIndex,
  lookupAccess,
  maskPii,
  toBookingView,
  toGuestView,
} from '../src/lookup/view';

const guest: GuestSummary = {
  id: 'g1',
  fullName: 'Nguyễn Văn An',
  phone: '+84912345678',
  email: 'an@example.com',
  loyaltyTier: 'GOLD',
  loyaltyPoints: 120,
  totalStays: 7,
  blacklisted: false,
  consentMarketing: true,
  createdAt: '2026-10-01T00:00:00.000Z',
};

const booking: BookingSummary = {
  id: 'b1',
  code: 'PH-261101-REP01',
  seq: 1,
  status: 'CONFIRMED',
  guestId: 'g1',
  propertyId: 'p1',
  roomTypeId: 'rt1',
  ratePlanId: 'rp1',
  channelId: 'ch1',
  checkIn: '2026-11-01',
  checkOut: '2026-11-03',
  nights: 2,
  adults: 2,
  children: 0,
  roomCount: 1,
  totalAmount: 1_234_000,
  depositPercent: 30,
  depositAmount: 400_000,
  paidAmount: 400_000,
  refundedAmount: 0,
  balanceDue: 834_000,
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
};

test.each<[UserRole, string]>([
  ['OWNER', 'full'],
  ['MANAGER', 'full'],
  ['FRONT_DESK', 'operational'],
  ['RESERVATION_AGENT', 'operational'],
  ['ACCOUNTANT', 'denied'],
  ['HOUSEKEEPING', 'denied'],
  ['SYSADMIN', 'denied'],
])('role %s sees %s projection', (role, expected) => {
  expect(lookupAccess(role)).toBe(expected);
});

test('masking keeps the leading asterisks contract and the last four characters', () => {
  expect(maskPii('+84912345678')).toBe('****5678');
  expect(maskPii('12', 4)).toBe('****');
  expect(maskPii('1234', 4)).toBe('****');
});

test('front desk gets operational fields only; management gets CRM history', () => {
  const operational = toGuestView(guest, 'operational');
  expect(operational).toEqual({
    id: 'g1',
    fullName: 'Nguyễn Văn An',
    phone: '+84912345678',
    email: '****.com',
    blacklisted: false,
    history: null,
  });
  const full = toGuestView(guest, 'full');
  expect(full.email).toBe('an@example.com');
  expect(full.history).toEqual({ tier: 'GOLD', points: 120, totalStays: 7 });
});

test('guest view is a whitelist: extra PII columns never reach the UI model', () => {
  const leaky = { ...guest, idNumber: '012345678901', dob: '1990-01-01' };
  expect(Object.keys(toGuestView(leaky, 'operational')).sort()).toEqual([
    'blacklisted',
    'email',
    'fullName',
    'history',
    'id',
    'phone',
  ]);
});

test('blacklist flag is copied from the server projection, not derived locally', () => {
  expect(toGuestView({ ...guest, blacklisted: true }, 'operational').blacklisted).toBe(true);
  expect(toGuestView({ ...guest, blacklisted: false }, 'full').blacklisted).toBe(false);
});

test('a booking joins the guest hit only when the guest profile was returned', () => {
  const joined = toBookingView(
    booking,
    guestIndex([toGuestView({ ...guest, blacklisted: true }, 'operational')]),
  );
  expect(joined.guestName).toBe('Nguyễn Văn An');
  expect(joined.blacklisted).toBe(true);
  const alone = toBookingView(booking, guestIndex([]));
  expect(alone.guestName).toBeNull();
  expect(alone.blacklisted).toBeNull();
});

test('rows list bookings before guest profiles', () => {
  const rows = buildRows([toGuestView(guest, 'full')], [toBookingView(booking, guestIndex([]))]);
  expect(rows.map((row) => row.kind)).toEqual(['booking', 'guest']);
});

test('money and stay formatting keep VND integers and calendar dates', () => {
  expect(formatVnd(1_234_567)).toBe('1.234.567 ₫');
  expect(() => formatVnd(-1)).toThrow(RangeError);
  expect(() => formatVnd(1.5)).toThrow(RangeError);
  expect(formatStay('2026-11-01', '2026-11-03', 2)).toBe('01/11/2026 → 03/11/2026 · 2 đêm');
});
