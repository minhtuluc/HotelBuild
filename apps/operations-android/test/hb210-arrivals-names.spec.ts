import { isValidElement } from 'react';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { Session } from '../src/session';
import { memoryStorage } from '../src/storage';
import { sendCheckIn } from '../src/arrivals/ports';
import { ArrivalsCache } from '../src/arrivals/reader';
import { ArrivalsScreen } from '../src/arrivals/screen';
import { CheckInWriter } from '../src/arrivals/writer';
import { createHarness } from './ui-harness';

vi.mock('react', async (original) =>
  (await import('./ui-harness')).mockReact(await original<typeof import('react')>()),
);
vi.mock('react-native', async () => (await import('./ui-harness')).reactNativeMock);

const ui = createHarness(isValidElement);
const { byId, press, settle, textOf } = ui;

const tokens = {
  tokenType: 'Bearer',
  accessToken: 'synthetic-access-aaaaaaaaaaaaaaaaaaaa',
  expiresInSeconds: 900,
  refreshToken: 'synthetic-refresh-bbbbbbbbbbbbbbbbbbb',
  refreshExpiresInSeconds: 604800,
};

const booking = (id: string, guestId: string) => ({
  id,
  code: `PH-261022-${id.toUpperCase()}`,
  seq: 1,
  status: 'CONFIRMED',
  guestId,
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
});
const room = {
  id: 'r1',
  propertyId: 'p1',
  roomTypeId: 'rt1',
  code: 'CS01-101',
  floor: 1,
  status: 'ACTIVE',
  connectingRoomId: null,
  version: 0,
};
const meta = { limit: 100, total: 1, hasMore: false, nextCursor: null };

interface Wire {
  guestReads: string[];
  guest: (id: string) => Response;
}

const guestOk = (id: string) =>
  Response.json({
    id,
    fullName: 'Nguyễn Văn An',
    phone: '+84912345678',
    email: 'an@example.com',
    loyaltyTier: 'GUEST',
    loyaltyPoints: 0,
    totalStays: 0,
    blacklisted: false,
    consentMarketing: false,
    createdAt: '2026-10-01T00:00:00.000Z',
  });
const notFound = () =>
  Response.json(
    { code: 'E_GEN_NOT_FOUND', message: 'x', traceId: 't', timestamp: 'x', path: 'x' },
    { status: 404 },
  );
const checkedIn = () =>
  Response.json(
    {
      bookingId: 'b1',
      status: 'CHECKED_IN',
      roomIds: ['r1'],
      checkedInAt: '2026-10-22T07:00:00.000Z',
      earlyCheckInFee: 0,
    },
    { status: 201 },
  );

function route(wire: Wire, bookings: unknown[], pathname: string): Response {
  if (pathname.endsWith('/login')) return Response.json(tokens);
  if (pathname.endsWith('/bookings')) return Response.json({ data: bookings, meta });
  if (pathname.endsWith('/rooms')) return Response.json({ data: [room], meta });
  const id = /\/guests\/([^/]+)$/.exec(pathname)?.[1];
  if (id === undefined) return checkedIn();
  wire.guestReads.push(id);
  return wire.guest(id);
}

async function mount(
  wire: Wire,
  bookings: unknown[],
  extra: { onWalkIn?: () => void } = {},
): Promise<Session> {
  const session = new Session({
    storage: memoryStorage(),
    baseUrl: 'https://synthetic.test/api/v1',
    createId: () => '00000000-0000-4000-8000-000000000000',
    netInfo: { getConnected: async () => true },
    fetchImpl: async (input) => route(wire, bookings, new URL(String(input)).pathname),
  });
  await session.login('synthetic', 'Synthetic-password');
  session.selectProperty('p1');
  const writer = new CheckInWriter({
    online: async () => true,
    createId: () => 'key-1',
    send: (body, key) => sendCheckIn(session, body, key),
  });
  const cache = new ArrivalsCache();
  ui.setElement(() =>
    ArrivalsScreen({
      session,
      cache,
      createWriter: () => writer,
      onBack: () => undefined,
      ...extra,
    }),
  );
  await settle();
  return session;
}

beforeEach(() => {
  ui.reset();
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-10-22T02:41:00.000Z'));
});
afterEach(() => {
  vi.useRealTimers();
});

test('cards show the guest name read by id, one request per distinct guest, and keep no other PII', async () => {
  const wire: Wire = { guestReads: [], guest: guestOk };
  await mount(wire, [booking('b1', 'g1'), booking('b2', 'g1'), booking('b3', 'g2')]);
  expect(wire.guestReads.slice().sort()).toEqual(['g1', 'g2']);
  expect(byId('arrival-name-b1')?.text).toBe('Nguyễn Văn An');
  expect(byId('arrival-name-b3')?.text).toBe('Nguyễn Văn An');
  expect(byId('arrival-b1')?.props.accessibilityLabel).toContain('Nguyễn Văn An');
  expect(textOf()).not.toContain('+84912345678');
  expect(textOf()).not.toContain('an@example.com');
});

test('a missing guest never hides the card or blocks check-in', async () => {
  const wire: Wire = { guestReads: [], guest: notFound };
  await mount(wire, [booking('b1', 'g1')]);
  expect(byId('arrival-b1')).toBeDefined();
  expect(byId('arrival-name-b1')).toBeUndefined();
  press('arrival-b1');
  await settle();
  press('check-in-submit');
  await settle();
  expect(byId('check-in-done')).toBeDefined();
});

test('names are dropped when the working property changes and read again for the new context', async () => {
  const wire: Wire = { guestReads: [], guest: guestOk };
  const session = await mount(wire, [booking('b1', 'g1')]);
  expect(byId('arrival-name-b1')?.text).toBe('Nguyễn Văn An');
  wire.guestReads = [];
  session.selectProperty('p2');
  await settle();
  expect(wire.guestReads).toEqual(['g1']);
});

test('"+ Khách vãng lai" appears only when the parent wires walk-in, and hands over control', async () => {
  const wire: Wire = { guestReads: [], guest: guestOk };
  await mount(wire, [booking('b1', 'g1')]);
  expect(byId('arrivals-walk-in')).toBeUndefined();
  ui.reset();
  const opened: string[] = [];
  await mount(wire, [booking('b1', 'g1')], {
    onWalkIn: () => {
      opened.push('walk-in');
    },
  });
  expect(byId('arrivals-walk-in')?.props.accessibilityLabel).toBe('+ Khách vãng lai');
  press('arrivals-walk-in');
  expect(opened).toEqual(['walk-in']);
});
