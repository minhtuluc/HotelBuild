/** HB-140: hợp đồng F7 qua HTTP thật — tiền sảnh, buồng phòng, khách, chốt đối soát. */
import { createServer, type IncomingHttpHeaders, type Server } from 'node:http';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ApiClient } from '../src/client.js';
import {
  createFrontOfficeApi,
  createGuestApi,
  createHousekeepingApi,
} from '../src/front-office.js';

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

const CHECK_IN = {
  bookingId: 'b1',
  status: 'CHECKED_IN',
  roomIds: ['r1'],
  checkedInAt: '2026-12-24T07:00:00Z',
  earlyCheckInFee: 0,
};

const CHECK_OUT = {
  bookingId: 'b1',
  status: 'CHECKED_OUT',
  checkedOutAt: '2026-12-27T04:00:00Z',
  extrasAmount: 20_000,
  feeAmount: 0,
  balanceDue: 0,
  housekeepingTaskIds: ['t1'],
};

const NO_SHOW = {
  bookingId: 'b1',
  status: 'NO_SHOW',
  markedAt: '2026-12-24T16:59:00Z',
  penaltyAmount: 0,
  refundRequestId: null,
};

const RECONCILIATION = {
  propertyId: 'p1',
  businessDate: '2026-12-27',
  expectedCash: 4_600_000,
  countedCash: 4_500_000,
  difference: -100_000,
  managerNotified: true,
  auditLogId: 'a1',
  closedAt: '2026-12-27T11:00:00Z',
};

const TASK = {
  id: 't1',
  roomId: 'r1',
  roomCode: '101',
  businessDate: '2026-12-27',
  status: 'IN_PROGRESS',
  assignedTo: 'u1',
  note: 'Đang dọn',
  completedAt: null,
  version: 4,
};

const GUEST = {
  id: 'g1',
  fullName: 'Nguyễn Văn A',
  phone: '+84901234567',
  email: null,
  loyaltyTier: 'GUEST',
  loyaltyPoints: 0,
  totalStays: 1,
  blacklisted: false,
  consentMarketing: false,
  createdAt: '2026-11-12T07:00:00Z',
};

const ROUTES: Record<string, (request: Recorded) => Outcome> = {
  'POST /api/v1/front-office/check-in': () => ({ status: 201, body: CHECK_IN }),
  'POST /api/v1/front-office/check-out': () => ({ status: 200, body: CHECK_OUT }),
  'POST /api/v1/front-office/no-show': () => ({ status: 200, body: NO_SHOW }),
  'POST /api/v1/reconciliation/daily/close': () => ({ status: 201, body: RECONCILIATION }),
  'GET /api/v1/housekeeping/tasks': () => ({
    status: 200,
    body: { data: [TASK], meta: { limit: 50, nextCursor: null, hasMore: false, total: 1 } },
  }),
  'PATCH /api/v1/housekeeping/tasks/t1': () => ({ status: 200, body: TASK }),
  'GET /api/v1/guests': () => ({
    status: 200,
    body: { data: [GUEST], meta: { limit: 20, nextCursor: null, hasMore: false, total: 1 } },
  }),
  'POST /api/v1/guests': () => ({ status: 201, body: GUEST }),
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

describe('hợp đồng F7 qua HTTP thật', () => {
  it('check-in gửi phòng thực tế, không cần PIN', async () => {
    const result = await createFrontOfficeApi(client()).checkIn({
      bookingId: 'b1',
      actualRoomIds: ['r1'],
      earlyCheckIn: false,
    });
    expect(result.data.status).toBe('CHECKED_IN');
    const seen = recorded(0);
    expect(seen.url).toBe('/api/v1/front-office/check-in');
    expect(seen.bodyText).toContain('"actualRoomIds":["r1"]');
    expect(seen.bodyText).not.toContain('pinToken');
    expect(seen.headers['idempotency-key']).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('check-out chèn pinToken và gửi extras', async () => {
    const result = await createFrontOfficeApi(client()).checkOut({
      bookingId: 'b1',
      extras: [{ description: 'Nước suối', amount: 20_000 }],
      lateCheckOut: false,
      earlyCheckOut: false,
    });
    expect(result.data.status).toBe('CHECKED_OUT');
    expect(recorded(0).bodyText).toContain('"pinToken":"pin-token-aaaaaaaaaaaaaaaaaaaaaaaaaa"');
  });

  it('no-show và chốt đối soát đi đúng tuyến; chốt đối soát có PIN', async () => {
    const api = createFrontOfficeApi(client());
    await api.noShow({ bookingId: 'b1', reason: 'Khách không đến sau 23:59' });
    const closed = await api.closeReconciliation({
      propertyId: 'p1',
      businessDate: '2026-12-27',
      countedCash: 4_500_000,
    });
    expect(closed.data.managerNotified).toBe(true);
    expect(recorded(1).url).toBe('/api/v1/reconciliation/daily/close');
    expect(recorded(1).bodyText).toContain('"pinToken"');
  });

  it('buồng phòng: đọc theo ngày và cập nhật kèm If-Match', async () => {
    const api = createHousekeepingApi(client());
    const page = await api.listTasks({ propertyId: 'p1', businessDate: '2026-12-27' });
    expect(page.data.data[0]?.roomCode).toBe('101');
    expect(recorded(0).url).toBe(
      '/api/v1/housekeeping/tasks?propertyId=p1&businessDate=2026-12-27',
    );
    const updated = await api.updateTask('t1', { status: 'IN_PROGRESS', note: 'Đang dọn' }, '"4"');
    expect(updated.data.status).toBe('IN_PROGRESS');
    expect(recorded(1).headers['if-match']).toBe('"4"');
  });

  it('khách: tra cứu và tạo mới', async () => {
    const api = createGuestApi(client());
    const list = await api.list({ q: '0901' });
    expect(list.data.data[0]?.phone).toBe('+84901234567');
    expect(recorded(0).url).toBe('/api/v1/guests?q=0901');
    await api.create({
      fullName: 'Nguyễn Văn A',
      phone: '+84901234567',
      consentMarketing: false,
      consentVersion: '2026-10',
    });
    expect(recorded(1).method).toBe('POST');
    expect(recorded(1).bodyText).toContain('"consentVersion":"2026-10"');
  });
});

describe('hợp đồng bổ sung mẻ 13 (HB-204) qua HTTP thật', () => {
  const PREVIEW_NO_SHOW = {
    bookingId: 'b1',
    penaltyAmount: 600_000,
    expectedRefundAmount: 0,
    markableFrom: '2026-12-24T16:59:00Z',
    computedAt: '2026-12-24T08:00:00Z',
  };
  const PREVIEW_CHECK_OUT = {
    bookingId: 'b1',
    feeAmount: 550_000,
    extrasAmount: 20_000,
    balanceDue: 570_000,
    computedAt: '2026-12-27T05:00:00Z',
  };

  it('tạo/ghi nhận kiểm phòng: POST /housekeeping/tasks, 201, không If-Match', async () => {
    handler = () => ({ status: 201, body: { ...TASK, status: 'INSPECTED', version: 0 } });
    const result = await createHousekeepingApi(client()).createTask({
      roomId: 'r1',
      businessDate: '2026-12-27',
      status: 'INSPECTED',
      reason: 'Lễ tân kiểm phòng',
    });
    expect(result.data.status).toBe('INSPECTED');
    const seen = recorded(0);
    expect(seen.method).toBe('POST');
    expect(seen.url).toBe('/api/v1/housekeeping/tasks');
    expect(seen.headers['idempotency-key']).toMatch(/^[0-9a-f-]{36}$/);
    expect(seen.headers['if-match']).toBeUndefined();
    expect(seen.bodyText).toContain('"reason":"Lễ tân kiểm phòng"');
  });

  it('tạo kiểm phòng chặn thân sai ngay ở client (trạng thái DONE), không gửi gì', () => {
    const api = createHousekeepingApi(client());
    expect(() =>
      api.createTask({
        roomId: 'r1',
        businessDate: '2026-12-27',
        // @ts-expect-error DONE không thuộc tập trạng thái được tạo
        status: 'DONE',
        reason: 'x',
      }),
    ).toThrow();
    expect(requests).toHaveLength(0);
  });

  it('đọc khách theo id: GET /guests/{guestId}, mã hoá id', async () => {
    handler = () => ({ status: 200, body: GUEST });
    const result = await createGuestApi(client()).get('g 1/x');
    expect(result.data.fullName).toBe('Nguyễn Văn A');
    expect(recorded(0).method).toBe('GET');
    expect(recorded(0).url).toBe('/api/v1/guests/g%201%2Fx');
  });

  it('xem trước no-show: không PIN, thân chỉ có bookingId', async () => {
    handler = () => ({ status: 200, body: PREVIEW_NO_SHOW });
    const result = await createFrontOfficeApi(client()).noShowPreview({ bookingId: 'b1' });
    expect(result.data.penaltyAmount).toBe(600_000);
    expect(recorded(0).url).toBe('/api/v1/front-office/no-show/preview');
    expect(recorded(0).bodyText).toBe('{"bookingId":"b1"}');
  });

  it('xem trước trả phòng: gửi extras/cờ, KHÔNG chèn pinToken dù client có PIN', async () => {
    handler = () => ({ status: 200, body: PREVIEW_CHECK_OUT });
    const result = await createFrontOfficeApi(client()).checkOutPreview({
      bookingId: 'b1',
      extras: [{ description: 'Nước suối', amount: 20_000 }],
      lateCheckOut: true,
      earlyCheckOut: false,
    });
    expect(result.data.balanceDue).toBe(570_000);
    expect(recorded(0).url).toBe('/api/v1/front-office/check-out/preview');
    expect(recorded(0).bodyText).toContain('"lateCheckOut":true');
    expect(recorded(0).bodyText).not.toContain('pinToken');
  });
});
