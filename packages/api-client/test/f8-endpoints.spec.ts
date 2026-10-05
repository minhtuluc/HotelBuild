/** HB-160: hợp đồng F8 qua HTTP thật — báo cáo, xuất báo cáo, thông báo, CRM quản trị. */
import { createServer, type IncomingHttpHeaders, type Server } from 'node:http';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ApiClient } from '../src/client.js';
import { createGuestApi } from '../src/front-office.js';
import { createNotificationApi, createReportApi } from '../src/report.js';

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

const OCCUPANCY = {
  groupBy: 'DAY',
  from: '2026-12-01',
  to: '2026-12-02',
  rows: [
    {
      key: '2026-12-01',
      businessDate: '2026-12-01',
      soldUnits: 20,
      availableUnits: 40,
      occupancyPct: 50,
    },
  ],
};

const ADR = {
  groupBy: 'DAY',
  from: '2026-12-01',
  to: '2026-12-02',
  rows: [
    {
      key: '2026-12-01',
      businessDate: '2026-12-01',
      roomNightsSold: 20,
      roomNightsAvailable: 40,
      netRevenue: 22_000_000,
      adr: 1_100_000,
      revpar: 550_000,
    },
  ],
};

const REVENUE = {
  from: '2026-12-01',
  to: '2026-12-31',
  rows: [
    {
      channelCode: 'WEB',
      grossAmount: 3_000_000,
      commissionAmount: 0,
      netAmount: 3_000_000,
      bookings: 2,
    },
  ],
};

const CANCELLATIONS = {
  from: '2026-12-01',
  to: '2026-12-31',
  cancellationRate: 0.1,
  rows: [
    { ratePlanCode: 'FLEX7', appliedTierOffsetHours: 168, cancellations: 1, refundAmount: 500_000 },
  ],
};

const FORCE_MAJEURE = {
  from: '2026-12-01',
  to: '2026-12-31',
  rows: [
    {
      bookingId: 'b1',
      propertyId: 'p1',
      cancelledAt: '2026-12-20T07:00:00Z',
      refundAmount: 1_000_000,
      note: 'Bão',
    },
  ],
};

const OVERBOOKING = {
  from: '2026-12-01',
  to: '2026-12-31',
  rows: [
    {
      caseId: 'c1',
      propertyId: 'p1',
      roomTypeId: 'rt1',
      businessDate: '2026-12-24',
      status: 'OPEN',
      detectedAt: '2026-12-23T07:00:00Z',
      resolvedAt: null,
      mergeDiscountAmount: 0,
      walkOutCompensationAmount: 0,
      transportSupportAmount: 0,
      totalCost: 0,
    },
  ],
};

const OPERATION = { operationId: 'op1', status: 'RUNNING', statusUrl: '/api/v1/operations/op1' };

const NOTIFICATION = {
  id: 'n1',
  bookingId: 'b1',
  channel: 'EMAIL',
  template: 'booking-confirmed',
  status: 'PENDING',
  recipientMasked: 'a***@example.com',
  retryCount: 1,
  errorMessage: null,
  sentAt: null,
  createdAt: '2026-12-24T07:00:00Z',
};

const GUEST = {
  id: 'g1',
  fullName: 'Nguyễn Văn A',
  phone: '+84901234567',
  email: null,
  loyaltyTier: 'GOLD',
  loyaltyPoints: 1200,
  totalStays: 19,
  blacklisted: true,
  consentMarketing: false,
  createdAt: '2026-11-12T07:00:00Z',
};

const LOYALTY = {
  guestId: 'g1',
  loyaltyTier: 'GOLD',
  loyaltyPoints: 1200,
  staysLast12Months: 6,
  totalStays: 19,
  updatedAt: '2026-12-24T07:00:00Z',
};

const ROUTES: Record<string, (request: Recorded) => Outcome> = {
  'GET /api/v1/reports/occupancy': () => ({ status: 200, body: OCCUPANCY }),
  'GET /api/v1/reports/adr-revpar': () => ({ status: 200, body: ADR }),
  'GET /api/v1/reports/revenue-by-channel': () => ({ status: 200, body: REVENUE }),
  'GET /api/v1/reports/cancellations': () => ({ status: 200, body: CANCELLATIONS }),
  'GET /api/v1/reports/force-majeure': () => ({ status: 200, body: FORCE_MAJEURE }),
  'GET /api/v1/reports/overbooking': () => ({ status: 200, body: OVERBOOKING }),
  'POST /api/v1/reports/export': () => ({ status: 202, body: OPERATION }),
  'GET /api/v1/notifications': () => ({
    status: 200,
    body: { data: [NOTIFICATION], meta: { limit: 20, nextCursor: null, hasMore: false, total: 1 } },
  }),
  'POST /api/v1/notifications/n1/resend': () => ({ status: 202, body: NOTIFICATION }),
  'POST /api/v1/guests/g1/anonymize': () => ({ status: 200, body: GUEST }),
  'GET /api/v1/guests/g1/loyalty': () => ({ status: 200, body: LOYALTY }),
  'POST /api/v1/guests/g1/blacklist': () => ({ status: 201, body: GUEST }),
  'DELETE /api/v1/guests/g1/blacklist': () => ({ status: 204 }),
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
  handler = (request) => {
    const path = request.url.split('?')[0] ?? request.url;
    return ROUTES[`${request.method} ${path}`]?.(request) ?? { status: 200, body: {} };
  };
});

function client(): ApiClient {
  return new ApiClient({
    baseUrl,
    fetchImpl: fetch,
    sleep: async () => undefined,
    getAccessToken: () => 'access-token-aaaaaaaaaaaaaaaaaaaaaaaaaa',
    getPinToken: () => 'pin-token-aaaaaaaaaaaaaaaaaaaaaaaaaa',
  });
}

function recorded(index: number): Recorded {
  const item = requests.at(index);
  if (item === undefined) throw new Error(`chưa nhận yêu cầu thứ ${index}`);
  return item;
}

describe('hợp đồng F8 qua HTTP thật', () => {
  it('đọc sáu báo cáo vận hành/tài chính đi đúng tuyến', async () => {
    const api = createReportApi(client());
    await api.occupancy({ from: '2026-12-01', to: '2026-12-02', groupBy: 'DAY' });
    await api.adrRevpar({ from: '2026-12-01', to: '2026-12-02' });
    await api.revenueByChannel({ from: '2026-12-01', to: '2026-12-31' });
    const cancelled = await api.cancellations({ from: '2026-12-01', to: '2026-12-31' });
    await api.forceMajeure({ from: '2026-12-01', to: '2026-12-31' });
    const over = await api.overbooking({ from: '2026-12-01', to: '2026-12-31' });
    expect(cancelled.data.cancellationRate).toBeCloseTo(0.1);
    expect(over.data.rows[0]?.status).toBe('OPEN');
    expect(recorded(0).url).toContain(
      '/reports/occupancy?from=2026-12-01&to=2026-12-02&groupBy=DAY',
    );
  });

  it('xuất báo cáo trả 202 kèm tham chiếu tác vụ và mang Idempotency-Key', async () => {
    const result = await createReportApi(client()).export({
      report: 'occupancy',
      format: 'CSV',
      params: { from: '2026-12-01', to: '2026-12-31' },
    });
    expect(result.data.operationId).toBe('op1');
    expect(recorded(0).headers['idempotency-key']).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('thông báo: danh sách giữ người nhận đã che, gửi lại có lý do', async () => {
    const api = createNotificationApi(client());
    const list = await api.list({ status: 'PENDING' });
    expect(list.data.data[0]?.recipientMasked).toBe('a***@example.com');
    const resent = await api.resend('n1', { reason: 'Khách xin gửi lại' });
    expect(resent.data.retryCount).toBe(1);
    expect(recorded(1).bodyText).toContain('Khách xin gửi lại');
  });

  it('CRM quản trị: ẩn danh hoá, hạng/điểm, danh sách đen (thêm và gỡ)', async () => {
    const api = createGuestApi(client());
    const anonymized = await api.anonymize('g1', {
      reason: 'Khách yêu cầu xoá dữ liệu',
      requestedAt: '2026-12-01T02:00:00Z',
    });
    expect(anonymized.data.id).toBe('g1');
    const loyalty = await api.loyalty('g1');
    expect(loyalty.data.staysLast12Months).toBe(6);
    await api.addBlacklist('g1', { blacklistReason: 'Phá phòng' });
    await api.removeBlacklist('g1', 'Đã xin lỗi');
    const seen = recorded(3);
    expect(seen.method).toBe('DELETE');
    expect(decodeURIComponent((seen.url.split('?')[1] ?? '').replace(/\+/g, ' '))).toContain(
      'reason=Đã xin lỗi',
    );
  });
});
