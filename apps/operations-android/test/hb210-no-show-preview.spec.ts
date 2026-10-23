import { isValidElement } from 'react';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import type { BookingSummary } from '@pinehill/contracts';
import { Session } from '../src/session';
import { memoryStorage } from '../src/storage';
import { NoShowScreen } from '../src/no-show/screen';
import { sendNoShow } from '../src/no-show/ports';
import { NoShowWriter } from '../src/no-show/writer';
import { createHarness } from './ui-harness';

vi.mock('react', async (original) =>
  (await import('./ui-harness')).mockReact(await original<typeof import('react')>()),
);
vi.mock('react-native', async () => (await import('./ui-harness')).reactNativeMock);

const ui = createHarness(isValidElement);
const { byId, press, settle } = ui;

const tokens = {
  tokenType: 'Bearer',
  accessToken: 'synthetic-access-aaaaaaaaaaaaaaaaaaaa',
  expiresInSeconds: 900,
  refreshToken: 'synthetic-refresh-bbbbbbbbbbbbbbbbbbb',
  refreshExpiresInSeconds: 604800,
};

const booking: BookingSummary = {
  id: 'b1',
  code: 'PH-261022-B1',
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
};

interface Wire {
  online: boolean;
  preview: () => Response;
  previews: unknown[];
}

const previewWith = (markableFrom: string, penaltyAmount = 600_000) =>
  Response.json({
    bookingId: 'b1',
    penaltyAmount,
    expectedRefundAmount: 0,
    markableFrom,
    computedAt: '2026-10-22T09:40:00.000Z',
  });
const server500 = () =>
  Response.json(
    { code: 'E_SYS_INTERNAL', message: 'x', traceId: 't', timestamp: 'x', path: 'x' },
    { status: 500 },
  );
const marked = () =>
  Response.json(
    {
      bookingId: 'b1',
      status: 'NO_SHOW',
      markedAt: '2026-10-22T17:00:00.000Z',
      penaltyAmount: 600_000,
      refundRequestId: null,
    },
    { status: 201 },
  );

async function mount(wire: Wire): Promise<void> {
  const session = new Session({
    storage: memoryStorage(),
    baseUrl: 'https://synthetic.test/api/v1',
    createId: () => '00000000-0000-4000-8000-000000000000',
    netInfo: { getConnected: async () => wire.online },
    fetchImpl: async (input, init) => {
      const url = new URL(String(input));
      if (url.pathname.endsWith('/login')) return Response.json(tokens);
      if (url.pathname.endsWith('/no-show/preview')) {
        wire.previews.push(typeof init?.body === 'string' ? JSON.parse(init.body) : null);
        return wire.preview();
      }
      return marked();
    },
  });
  const startOnline = wire.online;
  wire.online = true;
  await session.login('synthetic', 'Synthetic-password');
  wire.online = startOnline;
  const writer = new NoShowWriter({
    online: async () => wire.online,
    createId: () => 'key-1',
    send: (body, key) => sendNoShow(session, body, key),
  });
  ui.setElement(() =>
    NoShowScreen({
      session,
      booking,
      writer,
      now: () => Date.now(),
      onChanged: () => undefined,
      onClose: () => undefined,
    }),
  );
  await settle();
}

beforeEach(() => {
  ui.reset();
  // 16:40 giờ VN.
  vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'] });
  vi.setSystemTime(new Date('2026-10-22T09:40:00.000Z'));
});
afterEach(() => {
  vi.useRealTimers();
});

test('SCR-64 asks the server for the preview of this booking and shows its numbers as a read', async () => {
  const wire: Wire = {
    online: true,
    previews: [],
    preview: () => previewWith('2026-10-22T16:59:00.000Z'),
  };
  await mount(wire);
  expect(wire.previews).toEqual([{ bookingId: 'b1' }]);
  expect(byId('no-show-preview-penalty')?.text).toContain('600.000');
  expect(byId('no-show-preview-refund')?.text).toContain('0 ₫');
  expect(byId('no-show-preview-time')?.text).toContain('không ràng buộc');
  expect(byId('no-show-preview-time')?.text).toContain('giờ VN');
  expect(byId('no-show-countdown')?.text).toContain('07:19:00');
});

test('the countdown follows the mark the server returns, not a client-side 23:59 rule', async () => {
  await mount({
    online: true,
    previews: [],
    preview: () => previewWith('2026-10-22T12:00:00.000Z'),
  });
  expect(byId('no-show-countdown')?.text).toContain('02:20:00');
});

test('a free-of-charge no-show (server says 0) is shown as 0 only when the server said so', async () => {
  await mount({
    online: true,
    previews: [],
    preview: () => previewWith('2026-10-22T16:59:00.000Z', 0),
  });
  expect(byId('no-show-preview-penalty')?.text).toContain('0 ₫');
});

test('without a preview there is no number and no deadline, yet the command is still allowed', async () => {
  await mount({ online: true, previews: [], preview: server500 });
  expect(byId('no-show-preview-penalty')).toBeUndefined();
  expect(byId('no-show-preview-status')?.text).toContain('Chưa có số xem trước');
  expect(byId('no-show-preview-status')?.text).toContain('không phải 0');
  expect(byId('no-show-countdown')?.text).toContain('Chưa có mốc');
  expect(byId('no-show-submit')?.props.accessibilityState).toMatchObject({ disabled: false });
  press('no-show-submit');
  await settle();
  expect(byId('no-show-done')).toBeDefined();
});

test('offline at open sends no preview request; retry works once the network is back', async () => {
  const wire: Wire = {
    online: false,
    previews: [],
    preview: () => previewWith('2026-10-22T16:59:00.000Z'),
  };
  await mount(wire);
  expect(wire.previews).toEqual([]);
  expect(byId('no-show-preview-status')?.text).toContain('Cần kết nối mạng');
  expect(byId('no-show-preview-penalty')).toBeUndefined();
  wire.online = true;
  press('no-show-preview-status-retry');
  await settle();
  expect(byId('no-show-preview-penalty')?.text).toContain('600.000');
});

test('a preview for another booking is never shown', async () => {
  await mount({
    online: true,
    previews: [],
    preview: () =>
      Response.json({
        bookingId: 'other',
        penaltyAmount: 1,
        expectedRefundAmount: 0,
        markableFrom: '2026-10-22T16:59:00.000Z',
        computedAt: '2026-10-22T09:40:00.000Z',
      }),
  });
  expect(byId('no-show-preview-penalty')).toBeUndefined();
  expect(byId('no-show-preview-status')?.text).toContain('Chưa có số xem trước');
});
