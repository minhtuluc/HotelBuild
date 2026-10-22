import { expect, test } from 'vitest';
import { Session } from '../src/session';
import { memoryStorage } from '../src/storage';
import { arrivalsPorts, sendCheckIn } from '../src/arrivals/ports';
import { ArrivalsCache, ArrivalsReader } from '../src/arrivals/reader';
import { checkInBody, roomChoices, suggestRooms } from '../src/arrivals/model';
import { CheckInWriter } from '../src/arrivals/writer';

const tokens = {
  tokenType: 'Bearer',
  accessToken: 'synthetic-access-aaaaaaaaaaaaaaaaaaaa',
  expiresInSeconds: 900,
  refreshToken: 'synthetic-refresh-bbbbbbbbbbbbbbbbbbb',
  refreshExpiresInSeconds: 604800,
};

const bookingJson = {
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
};
const roomJson = (id: string, code: string) => ({
  id,
  propertyId: 'p1',
  roomTypeId: 'rt1',
  code,
  floor: 1,
  status: 'ACTIVE',
  connectingRoomId: null,
  version: 0,
});
const meta = { limit: 100, total: 1, hasMore: false, nextCursor: null };

interface Seen {
  method: string;
  path: string;
  search: string;
  key: string | null;
  body: unknown;
}

function setup(
  checkInHandler: (n: number) => Response = () =>
    Response.json(
      {
        bookingId: 'b1',
        status: 'CHECKED_IN',
        roomIds: ['r1'],
        checkedInAt: '2026-10-22T07:00:00.000Z',
        earlyCheckInFee: 0,
      },
      { status: 201 },
    ),
) {
  const seen: Seen[] = [];
  let checkIns = 0;
  const session = new Session({
    storage: memoryStorage(),
    baseUrl: 'https://synthetic.test/api/v1',
    createId: () => '00000000-0000-4000-8000-000000000000',
    netInfo: { getConnected: async () => true },
    fetchImpl: async (input, init) => {
      const url = new URL(String(input));
      const headers = new Headers(init?.headers);
      seen.push({
        method: init?.method ?? 'GET',
        path: url.pathname.replace('/api/v1', ''),
        search: url.search,
        key: headers.get('idempotency-key'),
        body: typeof init?.body === 'string' ? JSON.parse(init.body) : undefined,
      });
      if (url.pathname.endsWith('/login')) return Response.json(tokens);
      if (url.pathname.endsWith('/bookings')) return Response.json({ data: [bookingJson], meta });
      if (url.pathname.endsWith('/rooms'))
        return Response.json({
          data: [roomJson('r2', 'CS01-102'), roomJson('r1', 'CS01-101')],
          meta,
        });
      if (url.pathname.endsWith('/front-office/check-in')) return checkInHandler(++checkIns);
      return new Response('{}', { status: 404 });
    },
  });
  return { session, seen };
}

test('3-tap path: list → open card (suggested room) → confirm sends one correct request', async () => {
  const { session, seen } = setup();
  await session.login('synthetic', 'Synthetic-password');
  session.selectProperty('p1');
  const reader = new ArrivalsReader(
    { ...arrivalsPorts(session), now: () => new Date('2026-10-22T02:41:00.000Z') },
    new ArrivalsCache(),
  );
  await reader.load('p1');
  expect(reader.state.phase).toBe('ready');
  expect(seen.filter((s) => s.path === '/bookings')[0]?.search).toBe(
    '?propertyId=p1&from=2026-10-22&to=2026-10-22&limit=100',
  );
  expect(seen.filter((s) => s.path === '/rooms')[0]?.search).toBe(
    '?propertyId=p1&status=ACTIVE&limit=100',
  );

  // tap 1 = open the card: rooms are preselected, so no further selection tap is needed.
  const booking = reader.state.arrivals[0]!;
  const roomIds = suggestRooms(roomChoices(reader.state.rooms, booking), booking);
  expect(roomIds).toEqual(['r1']);

  // tap 2 = confirm.
  const writer = new CheckInWriter({
    online: async () => true,
    createId: () => 'idem-1',
    send: (body, key) => sendCheckIn(session, body, key),
  });
  const outcome = await writer.submit(
    checkInBody(booking.id, { roomIds, earlyCheckIn: false, idNumber: '', note: '' }),
  );
  expect(outcome.kind).toBe('done');
  const post = seen.filter((s) => s.path === '/front-office/check-in');
  expect(post).toHaveLength(1);
  expect(post[0]).toMatchObject({
    method: 'POST',
    key: 'idem-1',
    body: { bookingId: 'b1', actualRoomIds: ['r1'], earlyCheckIn: false },
  });
});

test('server rejection is shown verbatim with its code; the retry is a new intent with a new key', async () => {
  const { session, seen } = setup((n) =>
    n === 1
      ? Response.json(
          {
            code: 'E_FO_CHECKIN_NOT_ALLOWED',
            message: 'Còn nợ vượt ngưỡng; cần quản lý hoặc chủ sở hữu duyệt cho nợ.',
            traceId: 't',
            timestamp: '2026-10-22T07:00:00Z',
            path: '/front-office/check-in',
          },
          { status: 409 },
        )
      : Response.json(
          {
            bookingId: 'b1',
            status: 'CHECKED_IN',
            roomIds: ['r1'],
            checkedInAt: '2026-10-22T07:00:00.000Z',
            earlyCheckInFee: 0,
          },
          { status: 201 },
        ),
  );
  await session.login('synthetic', 'Synthetic-password');
  let n = 0;
  const writer = new CheckInWriter({
    online: async () => true,
    createId: () => `k${++n}`,
    send: (body, key) => sendCheckIn(session, body, key),
  });
  const body = { bookingId: 'b1', actualRoomIds: ['r1'], earlyCheckIn: false };
  const first = await writer.submit(body);
  expect(first).toEqual({
    kind: 'failed',
    failure: {
      kind: 'rejected',
      code: 'E_FO_CHECKIN_NOT_ALLOWED',
      status: 409,
      reason: 'Còn nợ vượt ngưỡng; cần quản lý hoặc chủ sở hữu duyệt cho nợ.',
    },
  });
  expect((await writer.submit(body)).kind).toBe('done');
  expect(seen.filter((s) => s.path === '/front-office/check-in').map((s) => s.key)).toEqual([
    'k1',
    'k2',
  ]);
});

test('a lost response (5xx) is unknown and the retry replays the same Idempotency-Key', async () => {
  const { session, seen } = setup((n) =>
    n === 1
      ? new Response('upstream', { status: 502 })
      : Response.json(
          {
            bookingId: 'b1',
            status: 'CHECKED_IN',
            roomIds: ['r1'],
            checkedInAt: '2026-10-22T07:00:00.000Z',
            earlyCheckInFee: 0,
          },
          { status: 201 },
        ),
  );
  await session.login('synthetic', 'Synthetic-password');
  let n = 0;
  const writer = new CheckInWriter({
    online: async () => true,
    createId: () => `k${++n}`,
    send: (body, key) => sendCheckIn(session, body, key),
  });
  const body = { bookingId: 'b1', actualRoomIds: ['r1'], earlyCheckIn: false };
  const first = await writer.submit(body);
  expect(first.kind === 'failed' && first.failure.kind).toBe('unknownOutcome');
  expect((await writer.submit(body)).kind).toBe('done');
  expect(seen.filter((s) => s.path === '/front-office/check-in').map((s) => s.key)).toEqual([
    'k1',
    'k1',
  ]);
});

test('offline on the device: no request leaves the app and nothing is queued', async () => {
  const { session, seen } = setup();
  await session.login('synthetic', 'Synthetic-password');
  const before = seen.length;
  const writer = new CheckInWriter({
    online: async () => false,
    createId: () => 'k',
    send: (body, key) => sendCheckIn(session, body, key),
  });
  expect(
    await writer.submit({ bookingId: 'b1', actualRoomIds: ['r1'], earlyCheckIn: false }),
  ).toEqual({ kind: 'offline' });
  expect(seen).toHaveLength(before);
});
