/** HB-090: hợp đồng F5 qua HTTP thật — payments, refund-requests, huỷ/đổi ngày/xoá booking. */
import { createServer, type IncomingHttpHeaders, type Server } from 'node:http';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ApiClient } from '../src/client.js';
import { createBookingApi } from '../src/booking.js';
import { createPaymentApi, createRefundApi } from '../src/payment.js';

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

const PAYMENT = {
  paymentId: 'pay1',
  bookingId: 'b1',
  type: 'DEPOSIT',
  method: 'CASH',
  amount: 1_305_000,
  status: 'SUCCEEDED',
  providerTxnId: null,
  paymentUrl: null,
  expiresAt: null,
  paidAt: '2026-09-19T03:14:02Z',
  createdAt: '2026-09-19T03:14:02Z',
};

const PAYMENT_STATUS = {
  paymentId: 'pay1',
  bookingId: 'b1',
  status: 'SUCCEEDED',
  amount: 1_305_000,
  providerTxnId: 'vnp-1',
  paidAt: '2026-09-19T03:14:02Z',
};

const BALANCE = {
  bookingId: 'b1',
  currency: 'VND',
  totalAmount: 4_348_000,
  paidAmount: 1_305_000,
  refundedAmount: 0,
  reservedRefundAmount: 0,
  balanceDue: 3_043_000,
};

const REFUND = {
  id: 'r1',
  bookingId: 'b1',
  paymentId: 'pay1',
  policyId: 'p1',
  hoursBeforeCheckIn: 96,
  appliedTierId: 't1',
  refundPercent: 50,
  requestedAmount: 652_000,
  approvedAmount: null,
  refundFee: 0,
  status: 'PENDING',
  isForceMajeure: false,
  reason: 'GUEST_REQUEST',
  evidenceRefs: [],
  requestedBy: 'u1',
  approvedBy: null,
  decidedAt: null,
  paidAt: null,
  createdAt: '2026-09-19T03:20:11Z',
};

const DECISION = {
  id: 'r1',
  status: 'APPROVED',
  requestedAmount: 652_000,
  approvedAmount: 652_000,
  refundPercent: 50,
  requestedBy: 'u1',
  approvedBy: 'u2',
  decidedAt: '2026-09-19T04:02:37Z',
  auditLogId: 'a1',
  payoutDeadline: '2026-09-26T04:02:37Z',
};

const CANCEL_PREVIEW = {
  bookingId: 'b1',
  currency: 'VND',
  cancellation: {
    policyId: 'p1',
    appliedTierId: 't1',
    hoursBeforeCheckIn: 96,
    refundPercent: 50,
    paidAmount: 1_305_000,
    requestedAmount: 652_000,
    penaltyAmount: 0,
    refundFee: 0,
  },
};

const CANCEL_RESPONSE = {
  bookingId: 'b1',
  status: 'CANCELLED',
  cancelledAt: '2026-09-19T04:00:00Z',
  cancelReason: 'GUEST_REQUEST',
  releasedAssignmentCount: 1,
  cancellation: CANCEL_PREVIEW.cancellation,
  refundRequest: { id: 'r1', status: 'PENDING', approvedAmount: null },
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
  rescheduleCount: 1,
  holdExpiresAt: null,
  oversold: false,
  priceLocked: false,
  duplicateSuspected: false,
  channelPolicyCode: null,
  note: null,
  createdBy: 'u1',
  createdAt: '2026-09-19T03:14:02Z',
};

const ROUTES: Record<string, (request: Recorded) => Outcome> = {
  'POST /api/v1/payments': () => ({ status: 201, body: PAYMENT }),
  'POST /api/v1/payments/online': () => ({
    status: 201,
    body: { ...PAYMENT, method: 'VNPAY', status: 'PENDING', paidAt: null },
  }),
  'GET /api/v1/payments/pay1/status': () => ({ status: 200, body: PAYMENT_STATUS }),
  'GET /api/v1/bookings/b1/balance': () => ({ status: 200, body: BALANCE }),
  'POST /api/v1/refund-requests': () => ({ status: 201, body: REFUND }),
  'GET /api/v1/refund-requests?limit=20': () => ({
    status: 200,
    body: { data: [REFUND], meta: { limit: 20, nextCursor: null, hasMore: false, total: 1 } },
  }),
  'POST /api/v1/refund-requests/r1/approve': () => ({ status: 200, body: DECISION }),
  'POST /api/v1/refund-requests/r1/reject': () => ({
    status: 200,
    body: { ...REFUND, status: 'REJECTED' },
  }),
  'POST /api/v1/refund-requests/r1/cancel': () => ({
    status: 200,
    body: { ...REFUND, status: 'CANCELLED' },
  }),
  'POST /api/v1/refund-requests/r1/pay': () => ({
    status: 200,
    body: { ...REFUND, status: 'PAID' },
  }),
  'POST /api/v1/bookings/b1/cancel-preview': () => ({ status: 200, body: CANCEL_PREVIEW }),
  'POST /api/v1/bookings/b1/cancel': () => ({ status: 200, body: CANCEL_RESPONSE }),
  'POST /api/v1/bookings/b1/reschedule': () => ({ status: 200, body: BOOKING }),
  'DELETE /api/v1/bookings/b1?reason=Kh%C3%B4ng%20d%C3%B9ng%20n%E1%BB%AFa': () => ({ status: 204 }),
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
    getPinToken: () => 'pin-token-aaaaaaaaaaaaaaaaaaaaaaaaaa',
  });
}

function recorded(index: number): Recorded {
  const item = requests.at(index);
  if (item === undefined) throw new Error(`chưa nhận yêu cầu thứ ${index}`);
  return item;
}

describe('hợp đồng F5 qua HTTP thật', () => {
  it('thu tiền tại quầy chèn pinToken và mang Idempotency-Key', async () => {
    const payment = await createPaymentApi(client()).create({
      bookingId: 'b1',
      type: 'DEPOSIT',
      method: 'CASH',
      amount: 1_305_000,
    });
    expect(payment.data.paymentId).toBe('pay1');
    const seen = recorded(0);
    expect(seen.url).toBe('/api/v1/payments');
    expect(seen.bodyText).toContain('"pinToken":"pin-token-aaaaaaaaaaaaaaaaaaaaaaaaaa"');
    expect(seen.headers['idempotency-key']).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('khởi tạo thanh toán trực tuyến, đọc trạng thái và số dư booking', async () => {
    const api = createPaymentApi(client());
    const online = await api.createOnline({
      bookingId: 'b1',
      type: 'DEPOSIT',
      method: 'VNPAY',
      amount: 1_305_000,
      returnUrl: 'https://pinehill.vn/dat-phong/ket-qua',
    });
    expect(online.data.status).toBe('PENDING');
    const status = await api.status('pay1');
    expect(status.data.providerTxnId).toBe('vnp-1');
    const balance = await api.balance('b1');
    expect(balance.data.balanceDue).toBe(3_043_000);
    expect(recorded(0).headers['idempotency-key']).toBeDefined();
    expect(recorded(2).headers['idempotency-key']).toBeUndefined();
  });

  it('hoàn tiền: lập, liệt kê, duyệt (PIN), từ chối (PIN), rút, chi (PIN)', async () => {
    const api = createRefundApi(client());
    const created = await api.create({
      bookingId: 'b1',
      paymentId: 'pay1',
      reason: 'GUEST_REQUEST',
      isForceMajeure: false,
      evidenceRefs: [],
      note: 'Khách huỷ trước 4 ngày',
    });
    expect(created.data.status).toBe('PENDING');
    expect(recorded(0).bodyText).toContain('"evidenceRefs":[]');

    const list = await api.list({ limit: 20 });
    expect(list.data.data[0]?.id).toBe('r1');

    const approved = await api.approve('r1', { approvedAmount: 652_000, note: 'Hoàn 50%' });
    expect(approved.data.status).toBe('APPROVED');
    expect(recorded(2).bodyText).toContain('"pinToken":"pin-token-aaaaaaaaaaaaaaaaaaaaaaaaaa"');

    await api.reject('r1', { note: 'Thiếu minh chứng' });
    await api.cancel('r1', { reason: 'Khách rút yêu cầu' });
    await api.pay('r1', { method: 'BANK_TRANSFER', bankNote: 'CK 652000' });
    expect(recorded(5).bodyText).toContain('"pinToken"');
    expect(recorded(4).bodyText).not.toContain('pinToken');
  });

  it('huỷ, đổi ngày và xoá booking đi đúng tuyến', async () => {
    const api = createBookingApi(client());
    const preview = await api.cancelPreview('b1', {
      reason: 'GUEST_REQUEST',
      isForceMajeure: false,
    });
    expect(preview.data.cancellation.requestedAmount).toBe(652_000);
    const cancelled = await api.cancel('b1', {
      reason: 'GUEST_REQUEST',
      isForceMajeure: false,
    });
    expect(cancelled.data.status).toBe('CANCELLED');
    const moved = await api.reschedule('b1', { checkIn: '2026-12-25', checkOut: '2026-12-27' });
    expect(moved.data.rescheduleCount).toBe(1);
    await api.deleteBooking('b1', 'Không dùng nữa');
    const seen = recorded(3);
    expect(seen.method).toBe('DELETE');
    expect(decodeURIComponent(seen.url.replace(/\+/g, ' '))).toContain('reason=Không dùng nữa');
  });
});
