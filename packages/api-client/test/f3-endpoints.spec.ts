/** HB-050: hợp đồng F3 qua HTTP thật (RATE + gói giá + chính sách huỷ). */
import { createServer, type IncomingHttpHeaders, type Server } from 'node:http';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ApiClient } from '../src/client.js';
import { createRateApi } from '../src/rate.js';

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

const CALENDAR = {
  roomTypeId: 'rt1',
  from: '2026-12-24',
  to: '2026-12-25',
  entries: [
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
};

const POLICY = {
  id: 'cp1',
  name: 'Linh hoạt',
  status: 'ACTIVE',
  tiers: [{ hoursBeforeCheckIn: 168, refundPercent: 100 }],
  earlyCheckoutFreeHours: 24,
  earlyCheckoutRefundPct: 50,
  version: 2,
};

const ROUTES: Record<string, (request: Recorded) => Outcome> = {
  'GET /api/v1/room-types/rt1/rate-calendar?from=2026-12-24&to=2026-12-25': () => ({
    status: 200,
    body: CALENDAR,
  }),
  'PUT /api/v1/room-types/rt1/rate-calendar': () => ({ status: 200, body: CALENDAR }),
  'POST /api/v1/seasons': () => ({ status: 201 }),
  'PATCH /api/v1/channels/c1': () => ({ status: 204 }),
  'POST /api/v1/promotions': () => ({ status: 201 }),
  'POST /api/v1/quotes/multi-channel': () => ({
    status: 200,
    body: {
      roomTypeId: 'rt1',
      checkIn: '2026-12-24',
      checkOut: '2026-12-26',
      options: [
        { channelCode: 'WEB', nightlyFrom: 1_421_000, totalFrom: 2_842_000, warnings: [] },
        {
          channelCode: 'OTA_BOOKING',
          nightlyFrom: 1_500_000,
          totalFrom: 3_000_000,
          warnings: ['OTA thấp hơn WEB'],
        },
      ],
    },
  }),
  'GET /api/v1/rate-plans?propertyId=p1': () => ({
    status: 200,
    body: {
      data: [
        {
          code: 'FLEX7',
          name: 'Linh hoạt 7 ngày',
          minNights: 1,
          maxNights: 30,
          depositPercent: 30,
        },
      ],
      meta: { limit: 50, nextCursor: null, hasMore: false, total: 1 },
    },
  }),
  'PUT /api/v1/rate-plans/rp1': () => ({ status: 204 }),
  'GET /api/v1/cancellation-policies?status=ACTIVE': () => ({
    status: 200,
    body: { data: [POLICY], meta: { limit: 50, nextCursor: null, hasMore: false, total: 1 } },
  }),
  'PUT /api/v1/cancellation-policies/cp1': () => ({ status: 200, body: POLICY }),
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

describe('hợp đồng F3 qua HTTP thật', () => {
  it('đọc lịch giá theo ngày kèm hệ số và giá từng đêm', async () => {
    const calendar = await createRateApi(client()).rateCalendar('rt1', {
      from: '2026-12-24',
      to: '2026-12-25',
    });
    expect(calendar.data.entries[0]?.nightlyPrice).toBe(1_421_000);
    expect(recorded(0).url).toContain('/room-types/rt1/rate-calendar');
  });

  it('ghi đè lịch giá giữ nguyên số nguyên VND và gửi yêu cầu OWNER xác nhận khi vượt ±20%', async () => {
    await createRateApi(client()).putRateCalendar('rt1', {
      items: [{ date: '2026-12-24', price: 1_500_000 }],
      priority: 10,
      reason: 'Cao điểm lễ',
      confirmOwnerOverride: true,
    });
    const seen = recorded(0);
    expect(seen.method).toBe('PUT');
    expect(seen.bodyText).toBe(
      '{"items":[{"date":"2026-12-24","price":1500000}],"priority":10,"reason":"Cao điểm lễ","confirmOwnerOverride":true}',
    );
  });

  it('tạo mùa, kênh và khuyến mãi đi đúng tuyến; kênh gửi If-Match', async () => {
    const api = createRateApi(client());
    await api.createSeason({
      propertyId: 'p1',
      name: 'Cao điểm hè',
      startDate: '2026-06-01',
      endDate: '2026-08-31',
      multiplier: 1.4,
      priority: 5,
      weekendSurchargeEnabled: true,
    });
    await api.updateChannel('c1', { commissionPct: 18, overbookAllowed: false }, '"4"');
    await api.createPromotion({
      code: 'SUMMER10',
      type: 'PERCENT',
      value: 10,
      minNights: 2,
      channelScope: ['WEB'],
      roomTypeScope: ['rt1'],
      validFrom: '2026-06-01T00:00:00.000Z',
      validTo: '2026-08-31T23:59:59.000Z',
      stackable: false,
    });
    expect(recorded(0).url).toBe('/api/v1/seasons');
    expect(recorded(1).headers['if-match']).toBe('"4"');
    expect(recorded(2).url).toBe('/api/v1/promotions');
  });

  it('báo giá đa kênh trả từng kênh kèm cảnh báo OTA thấp hơn WEB', async () => {
    const quote = await createRateApi(client()).quoteMultiChannel({
      roomTypeId: 'rt1',
      checkIn: '2026-12-24',
      checkOut: '2026-12-26',
      channelCodes: ['WEB', 'OTA_BOOKING'],
    });
    expect(quote.data.options).toHaveLength(2);
    expect(quote.data.options[1]?.warnings[0]).toContain('OTA');
  });

  it('gói giá cho khách chỉ trả điều khoản hiển thị, không lộ cấu hình nội bộ', async () => {
    const plans = await createRateApi(client()).listRatePlans({ propertyId: 'p1' });
    expect(plans.data.data[0]?.code).toBe('FLEX7');
    expect(Object.keys(plans.data.data[0] ?? {}).sort()).toEqual([
      'code',
      'depositPercent',
      'maxNights',
      'minNights',
      'name',
    ]);
    await createRateApi(client()).updateRatePlan(
      'rp1',
      { depositPercent: 40, reason: 'Chính sách mới' },
      '"9"',
    );
    expect(recorded(1).headers['if-match']).toBe('"9"');
  });

  it('chính sách huỷ: đọc toàn bộ bậc và ghi lại cả danh sách kèm If-Match', async () => {
    const api = createRateApi(client());
    const policies = await api.listCancellationPolicies({ status: 'ACTIVE' });
    expect(policies.data.data[0]?.tiers[0]?.refundPercent).toBe(100);
    const updated = await api.updateCancellationPolicy(
      'cp1',
      {
        tiers: [
          { hoursBeforeCheckIn: 720, refundPercent: 100 },
          { hoursBeforeCheckIn: 24, refundPercent: 0 },
        ],
        earlyCheckoutFreeHours: 24,
        earlyCheckoutRefundPct: 50,
        reason: 'Chốt bậc mới',
      },
      '"2"',
    );
    expect(updated.data.version).toBe(2);
    const seen = recorded(1);
    expect(seen.headers['if-match']).toBe('"2"');
    expect(seen.bodyText).toContain('"hoursBeforeCheckIn":720');
  });
});
