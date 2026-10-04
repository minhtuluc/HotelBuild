/** HB-070: hợp đồng F4 qua HTTP thật — availability, quotes, bookings, confirm, holds. */
import { createServer, type IncomingHttpHeaders, type Server } from 'node:http';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ApiClient } from '../src/client.js';
import { createBookingApi, createQuoteApi } from '../src/booking.js';
import { createInventoryApi } from '../src/f2.js';

interface Recorded {
  method: string;
  url: string;
  headers: IncomingHttpHeaders;
  bodyText: string;
}

interface Outcome {
  status: number;
  body?: unknown;
}

const requests: Recorded[] = [];
let handler: (request: Recorded) => Outcome;

const QUOTE = {
  quoteId: 'q1',
  channelCode: 'WEB',
  ratePlanCode: 'FLEX7',
  checkIn: '2026-12-24',
  checkOut: '2026-12-26',
  nights: [
    {
      date: '2026-12-24',
      basePrice: 650_000,
      seasonMultiplier: 2,
      weekendMultiplier: 1,
      occupancyMultiplier: 1.15,
      losMultiplier: 0.95,
      channelMultiplier: 1,
      clamped: false,
      nightlyPrice: 1_421_000,
    },
  ],
  subtotal: 1_421_000,
  discountAmount: 0,
  total: 1_421_000,
  currency: 'VND',
  warnings: [],
  depositPercent: 30,
  depositAmount: 426_300,
  engineVersion: 'pricing-1.0.0',
  quotedAt: '2026-09-19T03:12:44Z',
  expiresAt: '2026-09-19T03:27:44Z',
};

const BOOKING = {
  id: 'b1',
  code: 'PH-260919-K7M2Q',
  seq: 1042,
  status: 'HELD',
  guestId: 'g1',
  propertyId: 'p1',
  roomTypeId: 'rt1',
  ratePlanId: 'rp1',
  channelId: 'c1',
  checkIn: '2026-12-24',
  checkOut: '2026-12-26',
  nights: 2,
  adults: 2,
  children: 0,
  roomCount: 1,
  totalAmount: 2_842_000,
  depositPercent: 30,
  depositAmount: 852_600,
  paidAmount: 0,
  refundedAmount: 0,
  balanceDue: 2_842_000,
  penaltyAmount: 0,
  currency: 'VND',
  rescheduleCount: 0,
  holdExpiresAt: '2026-09-19T03:34:02Z',
  oversold: false,
  priceLocked: false,
  duplicateSuspected: false,
  channelPolicyCode: null,
  note: null,
  createdBy: 'u1',
  createdAt: '2026-09-19T03:14:02Z',
};

const HOLD = {
  holdId: 'h1',
  bookingId: 'b1',
  bookingCode: 'PH-260919-R4T8X',
  bookingStatus: 'HELD',
  status: 'ACTIVE',
  channelId: 'c1',
  releasedAt: null,
  expiresAt: '2026-09-19T03:34:02Z',
  holdExpiresAt: '2026-09-19T03:34:02Z',
  quotedTotal: 2_842_000,
  createdAt: '2026-09-19T03:14:02Z',
};

const AVAILABILITY = {
  checkIn: '2026-12-24',
  checkOut: '2026-12-26',
  nights: 2,
  channelCode: 'WEB',
  data: [
    {
      propertyId: 'p1',
      roomTypeId: 'rt1',
      roomTypeCode: 'STD',
      roomTypeName: 'Standard',
      capacityAdults: 2,
      availableCount: 4,
      soldOut: false,
      minNights: 1,
      maxNights: 30,
      nightlyFrom: 1_421_000,
      totalFrom: 2_842_000,
    },
  ],
  meta: { limit: 20, nextCursor: null, hasMore: false, total: 1 },
};

const QUOTE_INPUT = {
  propertyId: 'p1',
  roomTypeId: 'rt1',
  channelCode: 'WEB' as const,
  ratePlanCode: 'FLEX7' as const,
  checkIn: '2026-12-24',
  checkOut: '2026-12-26',
  adults: 2,
  children: 0,
  roomCount: 1,
  promotionCodes: ['EARLY10'],
};

const BOOKING_INPUT = {
  propertyId: 'p1',
  roomTypeId: 'rt1',
  ratePlanCode: 'FLEX7' as const,
  channelCode: 'WEB' as const,
  quoteId: 'q1',
  guest: { fullName: 'Nguyễn Văn A', phone: '0901234567' },
  checkIn: '2026-12-24',
  checkOut: '2026-12-26',
  adults: 2,
  children: 0,
  roomCount: 1,
};

const ROUTES: Record<string, (request: Recorded) => Outcome> = {
  'POST /api/v1/quotes': () => ({ status: 201, body: QUOTE }),
  'POST /api/v1/bookings': () => ({ status: 201, body: BOOKING }),
  'GET /api/v1/bookings?limit=20': () => ({
    status: 200,
    body: { data: [BOOKING], meta: { limit: 20, nextCursor: null, hasMore: false, total: 1 } },
  }),
  'GET /api/v1/bookings/b1': () => ({ status: 200, body: BOOKING }),
  'POST /api/v1/bookings/b1/confirm': () => ({
    status: 200,
    body: { ...BOOKING, status: 'CONFIRMED' },
  }),
  'POST /api/v1/holds': () => ({ status: 201, body: HOLD }),
  'DELETE /api/v1/holds/h1?reason=Kh%C3%A1ch+%C4%91%E1%BB%95i+k%E1%BA%BF+ho%E1%BA%A1ch': () => ({
    status: 204,
  }),
  'GET /api/v1/inventory/availability?propertyId=p1&checkIn=2026-12-24&checkOut=2026-12-26&adults=2&children=0&roomCount=1&channelCode=WEB':
    () => ({ status: 200, body: AVAILABILITY }),
};

let server: Server;
let baseUrl = '';

beforeAll(async () => {
  server = createServer((request, response) => {
    void (async () => {
      const chunks: Buffer[] = [];
      request.on('data', (chunk: Buffer) => chunks.push(chunk));
      const done = Promise.withResolvers<void>();
      request.on('end', done.resolve);
      await done.promise;
      const recorded: Recorded = {
        method: request.method ?? 'GET',
        url: request.url ?? '/',
        headers: request.headers,
        bodyText: Buffer.concat(chunks).toString('utf8'),
      };
      const outcome = handler(recorded);
      requests.push(recorded);
      response.writeHead(outcome.status, { 'content-type': 'application/json' });
      response.end(outcome.body === undefined ? '' : JSON.stringify(outcome.body));
    })();
  });
  const listening = Promise.withResolvers<void>();
  server.listen(0, '127.0.0.1', listening.resolve);
  await listening.promise;
  const address = server.address();
  if (address === null || typeof address === 'string')
    throw new Error('không lấy được cổng fixture');
  baseUrl = `http://127.0.0.1:${address.port}/api/v1`;
});

afterAll(async () => {
  const closed = Promise.withResolvers<void>();
  server.close(() => closed.resolve());
  await closed.promise;
});

beforeEach(() => {
  requests.length = 0;
  handler = (request) =>
    ROUTES[`${request.method} ${request.url}`]?.(request) ?? { status: 200, body: {} };
});

function client(): ApiClient {
  return new ApiClient({
    baseUrl,
    fetchImpl: fetch,
    sleep: async () => undefined,
    getAccessToken: () => 'access-token-aaaaaaaaaaaaaaaaaaaaaaaaaa',
  });
}

function recorded(index: number): Recorded {
  const item = requests.at(index);
  if (item === undefined) throw new Error(`chưa nhận yêu cầu thứ ${index}`);
  return item;
}

describe('hợp đồng F4 qua HTTP thật', () => {
  it('báo giá gửi đúng thân và đọc lại từng đêm kèm hệ số', async () => {
    const quote = await createQuoteApi(client()).quote(QUOTE_INPUT);
    expect(quote.data.nights[0]?.nightlyPrice).toBe(1_421_000);
    const seen = recorded(0);
    expect(seen.method).toBe('POST');
    expect(seen.url).toBe('/api/v1/quotes');
    expect(seen.bodyText).toBe(JSON.stringify(QUOTE_INPUT));
    expect(seen.headers['idempotency-key']).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('tạo booking, đọc danh sách, chi tiết và xác nhận', async () => {
    const api = createBookingApi(client());
    const created = await api.create(BOOKING_INPUT);
    expect(created.data.status).toBe('HELD');
    const list = await api.list({ limit: 20 });
    expect(list.data.data[0]?.id).toBe('b1');
    const detail = await api.get('b1');
    expect(detail.data.code).toBe('PH-260919-K7M2Q');
    const confirmed = await api.confirm('b1', { paymentId: 'pay1' });
    expect(confirmed.data.status).toBe('CONFIRMED');
    expect(recorded(3).url).toBe('/api/v1/bookings/b1/confirm');
  });

  it('giữ chỗ và giải phóng hold gửi lý do qua query', async () => {
    const api = createBookingApi(client());
    const hold = await api.createHold({
      propertyId: 'p1',
      roomTypeId: 'rt1',
      channelCode: 'WEB',
      checkIn: '2026-12-24',
      checkOut: '2026-12-26',
      adults: 2,
      children: 0,
      roomCount: 1,
      quoteId: 'q1',
    });
    expect(hold.data.status).toBe('ACTIVE');
    await api.releaseHold('h1', 'Khách đổi kế hoạch');
    const seen = recorded(1);
    expect(seen.method).toBe('DELETE');
    expect(decodeURIComponent(seen.url.replace(/\+/g, ' '))).toContain('reason=Khách đổi kế hoạch');
    expect(seen.headers['idempotency-key']).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('tìm phòng trống chỉ đọc, không cần Idempotency-Key, trả meta phân trang', async () => {
    const result = await createInventoryApi(client()).availability({
      propertyId: 'p1',
      checkIn: '2026-12-24',
      checkOut: '2026-12-26',
      adults: 2,
      children: 0,
      roomCount: 1,
      channelCode: 'WEB',
    });
    expect(result.data.data[0]?.availableCount).toBe(4);
    expect(result.data.meta.hasMore).toBe(false);
    const seen = recorded(0);
    expect(seen.method).toBe('GET');
    expect(seen.headers['idempotency-key']).toBeUndefined();
  });
});
