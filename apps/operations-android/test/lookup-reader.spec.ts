import { expect, test, vi } from 'vitest';
import { ApiError } from '@pinehill/api-client';
import type { BookingSummary, GuestSummary, ListPage, UserMe } from '@pinehill/contracts';
import { OfflineError } from '../src/netinfo';
import { LookupReader, type LookupPorts } from '../src/lookup/reader';

const actor = (role: UserMe['role']): UserMe => ({
  userId: 'u1',
  username: 'synthetic',
  fullName: 'Synthetic',
  role,
  propertyScope: ['p1'],
  hasPin: true,
  mustChangePassword: false,
});

const guest: GuestSummary = {
  id: 'g1',
  fullName: 'Nguyễn Văn An',
  phone: '+84912345678',
  email: 'an@example.com',
  loyaltyTier: 'GOLD',
  loyaltyPoints: 120,
  totalStays: 7,
  blacklisted: true,
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

function page<T>(data: readonly T[], hasMore = false): ListPage<T> {
  return { data, meta: { limit: 20, total: data.length, hasMore, nextCursor: null } };
}

function setup(role: UserMe['role'] = 'FRONT_DESK') {
  let current = actor(role);
  const guestCalls: unknown[] = [];
  const bookingCalls: unknown[] = [];
  const ports: LookupPorts = {
    actor: async () => current,
    guests: async (query) => {
      guestCalls.push(query);
      return page([guest]);
    },
    bookings: async (query) => {
      bookingCalls.push(query);
      return page([booking]);
    },
  };
  return {
    reader: new LookupReader(ports),
    ports,
    guestCalls,
    bookingCalls,
    role: (next: UserMe['role']) => {
      current = actor(next);
    },
  };
}

test('booking code queries only the booking route and joins the returned guest hit', async () => {
  const s = setup();
  await s.reader.load('PH-261101-REP01', 'p1');
  expect(s.reader.state.phase).toBe('ready');
  expect(s.bookingCalls).toEqual([{ q: 'PH-261101-REP01', limit: 20, propertyId: 'p1' }]);
  expect(s.guestCalls).toEqual([]);
  const row = s.reader.state.rows[0];
  expect(row?.kind).toBe('booking');
  if (row?.kind === 'booking') {
    expect(row.booking.guestName).toBeNull();
    expect(row.booking.blacklisted).toBeNull();
  }
});

test('name queries only guest profiles and exposes the blacklist flag', async () => {
  const s = setup();
  await s.reader.load('Nguyễn Văn An', 'p1');
  expect(s.guestCalls).toEqual([{ q: 'Nguyễn Văn An', limit: 20, propertyId: 'p1' }]);
  expect(s.bookingCalls).toEqual([]);
  const row = s.reader.state.rows[0];
  expect(row?.kind).toBe('guest');
  if (row?.kind === 'guest') {
    expect(row.guest.blacklisted).toBe(true);
    expect(row.guest.history).toBeNull();
    expect(row.guest.email).toBe('****.com');
  }
});

test('phone queries both routes and joins booking to guest by guestId', async () => {
  const s = setup('MANAGER');
  await s.reader.load('0912 345 678');
  expect(s.guestCalls).toEqual([{ q: '+84912345678', limit: 20 }]);
  expect(s.bookingCalls).toEqual([{ q: '+84912345678', limit: 20 }]);
  const first = s.reader.state.rows[0];
  if (first?.kind !== 'booking') throw Error('booking first');
  expect(first.booking.guestName).toBe('Nguyễn Văn An');
  expect(first.booking.blacklisted).toBe(true);
  const guestRow = s.reader.state.rows[1];
  if (guestRow?.kind !== 'guest') throw Error('guest second');
  expect(guestRow.guest.email).toBe('an@example.com');
  expect(guestRow.guest.history).toEqual({ tier: 'GOLD', points: 120, totalStays: 7 });
});

test('roles outside the four lookup roles are rejected before any request', async () => {
  const s = setup('HOUSEKEEPING');
  await s.reader.load('Nguyễn Văn An');
  expect(s.reader.state.phase).toBe('forbidden');
  expect(s.guestCalls).toEqual([]);
  expect(s.bookingCalls).toEqual([]);
});

test('empty and one-character terms make no request', async () => {
  const s = setup();
  await s.reader.load('   ');
  expect(s.reader.state.phase).toBe('idle');
  await s.reader.load('a');
  expect(s.reader.state.phase).toBe('invalid');
  expect(s.guestCalls).toEqual([]);
  expect(s.bookingCalls).toEqual([]);
});

test('empty resolved pages have their own state and truncation is reported', async () => {
  const s = setup();
  s.ports.guests = async () => page([], false);
  await s.reader.load('Không Có Ai');
  expect(s.reader.state.phase).toBe('empty');
  s.ports.guests = async () => page([guest], true);
  await s.reader.load('Nguyễn Văn An');
  expect(s.reader.state.phase).toBe('ready');
  expect(s.reader.state.truncated).toBe(true);
});

test.each<[unknown, string]>([
  [
    new ApiError({ kind: 'http', status: 403, code: 'E_AUTH_FORBIDDEN', message: 'denied' }),
    'forbidden',
  ],
  [
    new ApiError({ kind: 'http', status: 401, code: 'E_AUTH_EXPIRED', message: 'expired' }),
    'expired',
  ],
  [new ApiError({ kind: 'network', message: 'offline' }), 'offline'],
  [new OfflineError(), 'offline'],
  [new Error('boom'), 'error'],
])('failure %# maps to %s', async (error, phase) => {
  const s = setup();
  s.ports.guests = async () => {
    throw error;
  };
  await s.reader.load('Nguyễn Văn An');
  expect(s.reader.state.phase).toBe(phase);
});

test('a late response from a superseded search never overwrites the newer result', async () => {
  const s = setup();
  const slow = Promise.withResolvers<ListPage<GuestSummary>>();
  const firstCalled = Promise.withResolvers<void>();
  let call = 0;
  s.ports.guests = async () => {
    call += 1;
    if (call === 1) {
      firstCalled.resolve();
      return slow.promise;
    }
    return page([{ ...guest, id: 'g2', fullName: 'Nguyễn Văn Bình' }]);
  };
  const first = s.reader.load('Nguyễn Văn An');
  await firstCalled.promise;
  await s.reader.load('Nguyễn Văn Bình');
  slow.resolve(page([guest]));
  await first;
  expect(s.reader.state.phase).toBe('ready');
  const row = s.reader.state.rows[0];
  if (row?.kind !== 'guest') throw Error('guest row');
  expect(row.guest.fullName).toBe('Nguyễn Văn Bình');
});

test('invalidate clears a resolved search and ignores in-flight responses', async () => {
  const s = setup();
  const pending = Promise.withResolvers<ListPage<GuestSummary>>();
  s.ports.guests = async () => pending.promise;
  const load = s.reader.load('Nguyễn Văn An');
  s.reader.invalidate();
  expect(s.reader.state.phase).toBe('idle');
  pending.resolve(page([guest]));
  await load;
  expect(s.reader.state.phase).toBe('idle');
});

test('subscribe notifies on loading and terminal state; dispose stops notifications', async () => {
  const s = setup();
  const listener = vi.fn();
  const unsubscribe = s.reader.subscribe(listener);
  await s.reader.load('Nguyễn Văn An');
  expect(listener).toHaveBeenCalledTimes(2);
  unsubscribe();
  await s.reader.load('Nguyễn Văn Bình');
  expect(listener).toHaveBeenCalledTimes(2);
});
