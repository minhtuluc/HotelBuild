import { expect, test, vi } from 'vitest';
import { ApiError } from '@pinehill/api-client';
import type { BookingSummary, ListPage, RoomSummary } from '@pinehill/contracts';
import { OfflineError } from '../src/netinfo';
import { ArrivalsCache, ArrivalsReader, type ArrivalsPorts } from '../src/arrivals/reader';

// 2026-10-22 09:41 giờ VN = 02:41Z
const NOW = new Date('2026-10-22T02:41:00.000Z');

const booking = (id: string, over: Partial<BookingSummary> = {}): BookingSummary => ({
  id,
  code: `PH-261022-${id.toUpperCase()}`,
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

const room = (id: string): RoomSummary => ({
  id,
  propertyId: 'p1',
  roomTypeId: 'rt1',
  code: `CS01-${id}`,
  floor: 1,
  status: 'ACTIVE',
  connectingRoomId: null,
  version: 0,
});

const page = <T>(data: T[], extra: Partial<ListPage<T>['meta']> = {}): ListPage<T> => ({
  data,
  meta: { limit: 100, total: data.length, hasMore: false, nextCursor: null, ...extra },
});

function ports(over: Partial<ArrivalsPorts> = {}): ArrivalsPorts {
  return {
    now: () => NOW,
    bookings: async () => page([booking('b2'), booking('b1')]),
    rooms: async () => page([room('101')]),
    ...over,
  };
}

const down = () => new ApiError({ kind: 'network', message: 'down' });

test('first successful load lists arrivals sorted by code with the sync stamp and rooms', async () => {
  const reader = new ArrivalsReader(ports(), new ArrivalsCache());
  await reader.load('p1');
  expect(reader.state.phase).toBe('ready');
  expect(reader.state.date).toBe('2026-10-22');
  expect(reader.state.arrivals.map((b) => b.id)).toEqual(['b1', 'b2']);
  expect(reader.state.rooms.map((r) => r.id)).toEqual(['101']);
  expect(reader.state.syncedAt).toBe(NOW.toISOString());
  expect(reader.state.stale).toBe(false);
  expect(reader.state.notice).toBeNull();
});

test('queries the business date in Vietnam time, the selected property and exhausts cursor pages', async () => {
  const seen: unknown[] = [];
  const bookings = vi.fn(async (query: { cursor?: string }) => {
    seen.push(query);
    return query.cursor === undefined
      ? page([booking('b1')], { hasMore: true, nextCursor: 'c2' })
      : page([booking('b2')]);
  });
  const reader = new ArrivalsReader(ports({ bookings }), new ArrivalsCache());
  await reader.load('p1');
  expect(seen).toEqual([
    { propertyId: 'p1', from: '2026-10-22', to: '2026-10-22', limit: 100 },
    { propertyId: 'p1', from: '2026-10-22', to: '2026-10-22', limit: 100, cursor: 'c2' },
  ]);
  expect(reader.state.arrivals.map((b) => b.id)).toEqual(['b1', 'b2']);
  expect(reader.state.truncated).toBe(false);
});

test('a server that keeps returning more pages is capped and flagged truncated', async () => {
  const bookings = vi.fn(async () => page([booking('b1')], { hasMore: true, nextCursor: 'next' }));
  const reader = new ArrivalsReader(ports({ bookings }), new ArrivalsCache());
  await reader.load('p1');
  expect(bookings).toHaveBeenCalledTimes(10);
  expect(reader.state.truncated).toBe(true);
});

test('"no arrivals" is only reported after a successful load', async () => {
  const reader = new ArrivalsReader(ports({ bookings: async () => page([]) }), new ArrivalsCache());
  expect(reader.state.phase).toBe('idle');
  await reader.load('p1');
  expect(reader.state.phase).toBe('empty');
  expect(reader.state.syncedAt).toBe(NOW.toISOString());
});

test('offline with no cache is "no offline data", never an empty arrivals list', async () => {
  const reader = new ArrivalsReader(
    ports({
      bookings: async () => {
        throw new OfflineError();
      },
    }),
    new ArrivalsCache(),
  );
  await reader.load('p1');
  expect(reader.state.phase).toBe('offline');
  expect(reader.state.arrivals).toEqual([]);
  expect(reader.state.syncedAt).toBeNull();
});

test('offline refresh keeps the cached list with its original sync stamp (design 8.1 stale)', async () => {
  const cache = new ArrivalsCache();
  let fail = false;
  let now = NOW;
  const reader = new ArrivalsReader(
    ports({
      now: () => now,
      bookings: async () => {
        if (fail) throw down();
        return page([booking('b1')]);
      },
    }),
    cache,
  );
  await reader.load('p1');
  const stamp = reader.state.syncedAt;
  fail = true;
  now = new Date('2026-10-22T03:00:00.000Z');
  await reader.load('p1');
  expect(reader.state.phase).toBe('ready');
  expect(reader.state.stale).toBe(true);
  expect(reader.state.notice).toBe('offline');
  expect(reader.state.syncedAt).toBe(stamp);
  expect(reader.state.arrivals.map((b) => b.id)).toEqual(['b1']);
});

test('a new reader (screen reopened) reuses the shared cache while offline', async () => {
  const cache = new ArrivalsCache();
  await new ArrivalsReader(ports(), cache).load('p1');
  const reopened = new ArrivalsReader(
    ports({
      bookings: async () => {
        throw down();
      },
    }),
    cache,
  );
  await reopened.load('p1');
  expect(reopened.state.stale).toBe(true);
  expect(reopened.state.arrivals).toHaveLength(2);
});

test('cache from another property or another business day is never shown', async () => {
  const cache = new ArrivalsCache();
  await new ArrivalsReader(ports(), cache).load('p1');
  const offline = ports({
    bookings: async () => {
      throw down();
    },
  });
  const otherProperty = new ArrivalsReader(offline, cache);
  await otherProperty.load('p2');
  expect(otherProperty.state.phase).toBe('offline');
  expect(otherProperty.state.arrivals).toEqual([]);

  const nextDay = new ArrivalsReader(
    { ...offline, now: () => new Date('2026-10-23T02:41:00.000Z') },
    cache,
  );
  await nextDay.load('p1');
  expect(nextDay.state.phase).toBe('offline');
});

test('a server error on refresh also keeps stale data but flags error, not offline', async () => {
  const cache = new ArrivalsCache();
  await new ArrivalsReader(ports(), cache).load('p1');
  const reader = new ArrivalsReader(
    ports({
      bookings: async () => {
        throw new ApiError({ kind: 'http', status: 500, code: 'E_SYS_INTERNAL', message: 'x' });
      },
    }),
    cache,
  );
  await reader.load('p1');
  expect(reader.state.phase).toBe('ready');
  expect(reader.state.stale).toBe(true);
  expect(reader.state.notice).toBe('error');
});

test.each([
  [401, 'expired'],
  [403, 'forbidden'],
] as const)('HTTP %s drops cached PII and shows %s', async (status, phase) => {
  const cache = new ArrivalsCache();
  await new ArrivalsReader(ports(), cache).load('p1');
  const reader = new ArrivalsReader(
    ports({
      bookings: async () => {
        throw new ApiError({ kind: 'http', status, code: 'E_X', message: 'x' });
      },
    }),
    cache,
  );
  await reader.load('p1');
  expect(reader.state.phase).toBe(phase);
  expect(reader.state.arrivals).toEqual([]);
  expect(cache.get('p1', '2026-10-22')).toBeNull();
});

test('a failed rooms read is a failed load: the list is never shown without the rooms to assign', async () => {
  const reader = new ArrivalsReader(
    ports({
      rooms: async () => {
        throw new ApiError({ kind: 'http', status: 500, code: 'E_SYS_INTERNAL', message: 'x' });
      },
    }),
    new ArrivalsCache(),
  );
  await reader.load('p1');
  expect(reader.state.phase).toBe('error');
  expect(reader.state.arrivals).toEqual([]);
});

test('a late response from an older load never overwrites the newest one', async () => {
  const gates: Array<() => void> = [];
  let call = 0;
  const reader = new ArrivalsReader(
    ports({
      bookings: async () => {
        const mine = ++call;
        await new Promise<void>((resolve) => gates.push(resolve));
        return page([booking(mine === 1 ? 'old' : 'new')]);
      },
    }),
    new ArrivalsCache(),
  );
  const first = reader.load('p1');
  const second = reader.load('p1');
  gates[1]!();
  await second;
  gates[0]!();
  await first;
  expect(reader.state.arrivals.map((b) => b.id)).toEqual(['new']);
});

test('invalidate and dispose drop in-flight results and notify no one after dispose', async () => {
  let release: () => void = () => undefined;
  const reader = new ArrivalsReader(
    ports({
      bookings: async () => {
        await new Promise<void>((resolve) => {
          release = resolve;
        });
        return page([booking('b1')]);
      },
    }),
    new ArrivalsCache(),
  );
  const listener = vi.fn();
  reader.subscribe(listener);
  const pending = reader.load('p1');
  reader.invalidate();
  expect(reader.state.phase).toBe('idle');
  release();
  await pending;
  expect(reader.state.phase).toBe('idle');
  reader.dispose();
  listener.mockClear();
  await reader.load('p1');
  expect(listener).not.toHaveBeenCalled();
});

test('ArrivalsCache.clear removes everything (logout path)', async () => {
  const cache = new ArrivalsCache();
  await new ArrivalsReader(ports(), cache).load('p1');
  expect(cache.get('p1', '2026-10-22')).not.toBeNull();
  cache.clear();
  expect(cache.get('p1', '2026-10-22')).toBeNull();
});
