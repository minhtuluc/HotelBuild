import { expect, test, vi } from 'vitest';
import { ApiError } from '@pinehill/api-client';
import type { BookingBalance, BookingSummary, ListPage } from '@pinehill/contracts';
import { BalanceReader, DeparturesReader, type DeparturesPorts } from '../src/stay/reader';

const NOW = new Date('2026-10-22T02:41:00.000Z'); // 09:41 giờ VN

const booking = (id: string, over: Partial<BookingSummary> = {}): BookingSummary => ({
  id,
  code: `PH-261020-${id.toUpperCase()}`,
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
const page = <T>(data: T[], extra: Partial<ListPage<T>['meta']> = {}): ListPage<T> => ({
  data,
  meta: { limit: 100, total: data.length, hasMore: false, nextCursor: null, ...extra },
});
const down = () => new ApiError({ kind: 'network', message: 'down' });
const http = (status: number) => new ApiError({ kind: 'http', status, code: 'E_X', message: 'x' });

function ports(over: Partial<DeparturesPorts> = {}): DeparturesPorts {
  return {
    now: () => NOW,
    bookings: async () =>
      page([booking('b2'), booking('b1'), booking('x', { checkOut: '2026-10-25' })]),
    ...over,
  };
}

test('lists in-house stays due today, queried as CHECKED_IN in the selected property', async () => {
  const seen: unknown[] = [];
  const reader = new DeparturesReader(
    ports({
      bookings: async (query) => {
        seen.push(query);
        return page([booking('b2'), booking('b1'), booking('x', { checkOut: '2026-10-25' })]);
      },
    }),
  );
  await reader.load('p1');
  expect(seen).toEqual([{ propertyId: 'p1', status: 'CHECKED_IN', limit: 100 }]);
  expect(reader.state.phase).toBe('ready');
  expect(reader.state.departures.map((b) => b.id)).toEqual(['b1', 'b2']);
  expect(reader.state.date).toBe('2026-10-22');
  expect(reader.state.syncedAt).toBe(NOW.toISOString());
});

test('empty only after a successful load; offline first load is "no data"', async () => {
  const empty = new DeparturesReader(ports({ bookings: async () => page([]) }));
  expect(empty.state.phase).toBe('idle');
  await empty.load('p1');
  expect(empty.state.phase).toBe('empty');
  const offline = new DeparturesReader(
    ports({
      bookings: async () => {
        throw down();
      },
    }),
  );
  await offline.load('p1');
  expect(offline.state.phase).toBe('offline');
  expect(offline.state.departures).toEqual([]);
});

test('a failed refresh keeps the previous list as stale with the old stamp; 401/403 drop it', async () => {
  let mode: 'ok' | 'down' | 401 | 403 = 'ok';
  let now = NOW;
  const reader = new DeparturesReader(
    ports({
      now: () => now,
      bookings: async () => {
        if (mode === 'down') throw down();
        if (mode === 401 || mode === 403) throw http(mode);
        return page([booking('b1')]);
      },
    }),
  );
  await reader.load('p1');
  const stamp = reader.state.syncedAt;
  mode = 'down';
  now = new Date('2026-10-22T03:00:00.000Z');
  await reader.load('p1');
  expect(reader.state).toMatchObject({
    phase: 'ready',
    stale: true,
    notice: 'offline',
    syncedAt: stamp,
  });
  mode = 401;
  await reader.load('p1');
  expect(reader.state).toMatchObject({ phase: 'expired', departures: [] });
  mode = 'ok';
  await reader.load('p1');
  mode = 403;
  await reader.load('p1');
  expect(reader.state).toMatchObject({ phase: 'forbidden', departures: [] });
});

test('never shows another property or another day from memory', async () => {
  let fail = false;
  let now = NOW;
  const reader = new DeparturesReader(
    ports({
      now: () => now,
      bookings: async () => {
        if (fail) throw down();
        return page([booking('b1')]);
      },
    }),
  );
  await reader.load('p1');
  fail = true;
  await reader.load('p2');
  expect(reader.state.phase).toBe('offline');
  await reader.load('p1');
  expect(reader.state.stale).toBe(true);
  now = new Date('2026-10-23T02:41:00.000Z');
  await reader.load('p1');
  expect(reader.state.phase).toBe('offline');
});

test('exhausts pages up to a cap and flags truncation; late responses never win', async () => {
  const many = vi.fn(async () => page([booking('b1')], { hasMore: true, nextCursor: 'n' }));
  const capped = new DeparturesReader(ports({ bookings: many }));
  await capped.load('p1');
  expect(many).toHaveBeenCalledTimes(10);
  expect(capped.state.truncated).toBe(true);

  const gates: Array<() => void> = [];
  let call = 0;
  const reader = new DeparturesReader(
    ports({
      bookings: async () => {
        const mine = ++call;
        await new Promise<void>((resolve) => gates.push(resolve));
        return page([booking(mine === 1 ? 'old' : 'new')]);
      },
    }),
  );
  const first = reader.load('p1');
  const second = reader.load('p1');
  gates[1]!();
  await second;
  gates[0]!();
  await first;
  expect(reader.state.departures.map((b) => b.id)).toEqual(['new']);
  reader.invalidate();
  expect(reader.state.phase).toBe('idle');
  reader.dispose();
  await reader.load('p1');
  expect(reader.state.phase).toBe('idle');
});

const balance = (over: Partial<BookingBalance> = {}): BookingBalance => ({
  bookingId: 'b1',
  currency: 'VND',
  totalAmount: 3_000_000,
  paidAmount: 900_000,
  refundedAmount: 0,
  reservedRefundAmount: 0,
  balanceDue: 2_100_000,
  ...over,
});

test('BalanceReader shows only the server number and drops it on any failure', async () => {
  let mode: 'ok' | 'down' | 403 | 500 = 'ok';
  const reader = new BalanceReader({
    balance: async () => {
      if (mode === 'down') throw down();
      if (mode === 403 || mode === 500) throw http(mode);
      return balance();
    },
  });
  expect(reader.state).toEqual({ phase: 'idle', balance: null });
  await reader.load('b1');
  expect(reader.state).toEqual({ phase: 'ready', balance: balance() });
  mode = 'down';
  await reader.load('b1');
  expect(reader.state).toEqual({ phase: 'offline', balance: null });
  mode = 403;
  await reader.load('b1');
  expect(reader.state.phase).toBe('forbidden');
  mode = 500;
  await reader.load('b1');
  expect(reader.state.phase).toBe('error');
});

test('BalanceReader rejects a balance for another booking and ignores stale responses', async () => {
  const wrong = new BalanceReader({ balance: async () => balance({ bookingId: 'zz' }) });
  await wrong.load('b1');
  expect(wrong.state).toEqual({ phase: 'error', balance: null });

  const gates: Array<() => void> = [];
  let call = 0;
  const reader = new BalanceReader({
    balance: async () => {
      const mine = ++call;
      await new Promise<void>((resolve) => gates.push(resolve));
      return balance({ balanceDue: mine === 1 ? 1 : 2 });
    },
  });
  const a = reader.load('b1');
  const b = reader.load('b1');
  gates[1]!();
  await b;
  gates[0]!();
  await a;
  expect(reader.state.balance?.balanceDue).toBe(2);
  reader.dispose();
  await reader.load('b1');
  expect(reader.state.balance?.balanceDue).toBe(2);
});
