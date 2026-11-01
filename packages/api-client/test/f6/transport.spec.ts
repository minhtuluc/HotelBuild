/**
 * HB-120 AC4/AC10/AC11/AC12/AC13: client F6 qua HTTP server kiểm soát được — kiểm body/header/mã lỗi
 * thật, giữ nguyên `Idempotency-Key` khi retry cùng payload, `If-Match` + `ETag` cho lệnh sửa.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createChannelApi } from '../../src/channel.js';
import { ApiError } from '../../src/errors.js';
import { createSystemApi } from '../../src/f2.js';
import { createOverbookingApi, type OverbookingApi } from '../../src/overbooking.js';
import {
  ALERTS,
  COMPENSATION,
  COMPENSATION_VIEW,
  createClient,
  DELIVERY,
  errorBody,
  idempotencyUuid,
  withIdempotency,
  idempotencyUuid2,
  MOVE,
  MOVE_CREATE,
  MOVE_VIEW,
  MERGE_VIEW,
  OPERATION_REF,
  OPERATION_STATUS,
  OTA_BOOKING,
  PIN,
  RELOCATION_OPTIONS,
  requests,
  resetRequests,
  respond,
  startServer,
  stopServer,
  SYNC_STATUS,
  type Outcome,
} from './harness.js';

const ROUTES: Record<string, Outcome> = {
  'POST /api/v1/channels/ch1/sync': {
    status: 202,
    body: OPERATION_REF,
    headers: { location: '/api/v1/operations/op1' },
  },
  'GET /api/v1/operations/op1': { status: 200, body: OPERATION_STATUS },
  'GET /api/v1/channels/ch1/sync-status': { status: 200, body: SYNC_STATUS },
  'GET /api/v1/channels/ch1/outbox-deliveries?status=DEAD_LETTER&limit=20': {
    status: 200,
    body: { data: [DELIVERY], meta: { limit: 20, nextCursor: null, hasMore: false, total: 1 } },
  },
  'POST /api/v1/channels/ch1/outbox-deliveries/d1/retry': { status: 202, body: OPERATION_REF },
  'GET /api/v1/channels/ch1/ota-bookings?q=BK-778812': {
    status: 200,
    body: { data: [OTA_BOOKING], meta: { limit: 20, nextCursor: null, hasMore: false, total: 1 } },
  },
  'POST /api/v1/channels/ch1/ota-bookings/inb1/duplicate-flag': { status: 200, body: OTA_BOOKING },
  'POST /api/v1/room-moves': { status: 201, body: MOVE },
  [`GET /api/v1/room-moves/m1?idempotencyKey=${idempotencyUuid}`]: {
    status: 200,
    body: MOVE_VIEW,
  },
  'POST /api/v1/room-moves/m1/approve': {
    status: 200,
    body: {
      ...MOVE,
      status: 'APPROVED',
      approvedBy: 'u2',
      approvedAt: '2026-12-01T02:00:00Z',
      version: 2,
    },
  },
  'POST /api/v1/room-moves/m1/execute': {
    status: 200,
    body: { ...MOVE, status: 'EXECUTED', assignmentIds: ['as1'], version: 3 },
  },
  'GET /api/v1/room-merges/mg1': { status: 200, body: MERGE_VIEW },
  'GET /api/v1/bookings/b1/relocation-options?overbookingCaseId=c1': {
    status: 200,
    body: RELOCATION_OPTIONS,
  },
  'GET /api/v1/overbooking-alerts': { status: 200, body: ALERTS },
  'GET /api/v1/room-moves/m1/compensation-payments': { status: 200, body: COMPENSATION_VIEW },
};

beforeAll(startServer);
afterAll(stopServer);
beforeEach(() => {
  resetRequests();
  respond(ROUTES);
});

async function assertVersionedApprove(api: OverbookingApi): Promise<void> {
  await api.approveMove(
    'm1',
    { compensationAmount: 250_000, transportCost: 0 },
    { etag: 'W/"1"', ...withIdempotency(idempotencyUuid) },
  );
  const approve = requests.at(-1);
  expect(approve?.headers['if-match']).toBe('W/"1"');
  expect(approve?.headers['idempotency-key']).toBe(idempotencyUuid);
  expect(approve?.bodyText).toBe(
    JSON.stringify({ compensationAmount: 250_000, transportCost: 0, pinToken: PIN }),
  );
}

async function assertRetryReusesKey(api: OverbookingApi): Promise<void> {
  // Retry sau 503 dùng lại đúng key + payload.
  respond({
    'POST /api/v1/room-moves/m1/execute': [
      { status: 503, body: errorBody('E_GEN_SERVICE_UNAVAILABLE', 'Tạm thời gián đoạn') },
      { status: 200, body: { ...MOVE, status: 'EXECUTED' } },
    ],
  });
  const executed = await api.executeMove('m1', {
    etag: 'W/"2"',
    ...withIdempotency(idempotencyUuid2),
  });
  expect(executed.data.status).toBe('EXECUTED');
  const tried = requests.filter((request) => request.url === '/api/v1/room-moves/m1/execute');
  expect(tried).toHaveLength(2);
  expect(tried[0]?.headers['idempotency-key']).toBe(idempotencyUuid2);
  expect(tried[1]?.headers['idempotency-key']).toBe(idempotencyUuid2);
  expect(tried[0]?.bodyText).toBe(tried[1]?.bodyText);
}

async function assertVersionErrors(api: OverbookingApi): Promise<void> {
  // Thiếu version → 428.
  respond({
    'POST /api/v1/room-moves/m1/approve': {
      status: 428,
      body: errorBody('E_GEN_PRECONDITION_REQUIRED', 'Cần phiên bản'),
    },
  });
  await expect(
    api.approveMove('m1', { compensationAmount: 0, transportCost: 0 }, { etag: 'W/"1"' }),
  ).rejects.toMatchObject({ status: 428, code: 'E_GEN_PRECONDITION_REQUIRED' });
  // Lệch version → 412.
  respond({
    'POST /api/v1/room-moves/m1/approve': {
      status: 412,
      body: errorBody('E_GEN_VERSION_CONFLICT', 'Dữ liệu đã đổi'),
    },
  });
  await expect(
    api.approveMove('m1', { compensationAmount: 0, transportCost: 0 }, { etag: 'W/"1"' }),
  ).rejects.toBeInstanceOf(ApiError);
  // Dùng lại key với payload khác → 409.
  respond({
    'POST /api/v1/room-moves': {
      status: 409,
      body: errorBody('E_SYS_IDEMPOTENCY_KEY_REUSED', 'Khoá đã dùng'),
    },
  });
  await expect(
    api.createMove(MOVE_CREATE, { ...withIdempotency(idempotencyUuid) }),
  ).rejects.toMatchObject({
    status: 409,
    code: 'E_SYS_IDEMPOTENCY_KEY_REUSED',
  });
  // Tạo mới chưa có version: KHÔNG gửi If-Match.
  respond({ 'POST /api/v1/room-moves': { status: 201, body: MOVE } });
  await api.createMove(MOVE_CREATE, { ...withIdempotency(idempotencyUuid) });
  expect(requests.at(-1)?.headers['if-match']).toBeUndefined();
  expect(requests.at(-1)?.headers['idempotency-key']).toBe(idempotencyUuid);
}

describe('F6 transport', () => {
  it('idempotency-and-version-headers', async () => {
    const api = createOverbookingApi(createClient());
    await assertVersionedApprove(api);
    await assertRetryReusesKey(api);
    await assertVersionErrors(api);
  });

  it('http-client-and-async-operation', async () => {
    const client = createClient();
    const sync = await createChannelApi(client).sync('ch1', {
      scope: 'RANGE',
      from: '2026-12-24',
      to: '2026-12-25',
    });
    expect(sync.status).toBe(202);
    expect(sync.data).toEqual(OPERATION_REF);
    const posted = requests.at(-1);
    expect(posted?.headers['idempotency-key']).toBeTruthy();
    expect(JSON.parse(posted?.bodyText ?? '{}')).toEqual({
      scope: 'RANGE',
      from: '2026-12-24',
      to: '2026-12-25',
    });
    // Dùng lại route đọc operation có kiểm quyền.
    const status = await createSystemApi(client).operation(sync.data.operationId);
    expect(status.data.status).toBe('SUCCEEDED');
    expect(requests.at(-1)?.url).toBe('/api/v1/operations/op1');
  });

  it('operations-channel-clients', async () => {
    const channels = createChannelApi(createClient());
    expect((await channels.syncStatus('ch1')).data.syncStatus).toBe('OK');
    const deliveries = await channels.outboxDeliveries('ch1', { status: 'DEAD_LETTER', limit: 20 });
    expect(deliveries.data.data[0]?.consumerKey).toBe('ota:booking');
    await channels.retryDelivery('ch1', 'd1', { ...withIdempotency(idempotencyUuid) });
    const retried = requests.at(-1);
    expect(retried?.url).toBe('/api/v1/channels/ch1/outbox-deliveries/d1/retry');
    expect(retried?.headers['idempotency-key']).toBe(idempotencyUuid);
    // Không body: không thể đổi `eventId`/`consumerKey` khi retry.
    expect(retried?.bodyText).toBe('');

    const bookings = await channels.otaBookings('ch1', { q: 'BK-778812' });
    expect(bookings.data.data[0]?.flagged).toBe(true);
    const flagged = await channels.flagOtaBooking(
      'ch1',
      'inb1',
      { flagged: true, reason: 'Nghi trùng mã OTA' },
      'W/"2"',
    );
    expect(flagged.data.version).toBe(2);
    const flagRequest = requests.at(-1);
    expect(flagRequest?.headers['if-match']).toBe('W/"2"');
    expect(flagRequest?.bodyText).toBe(
      JSON.stringify({ flagged: true, reason: 'Nghi trùng mã OTA' }),
    );
  });

  it('handoff_and_unknown_result_reads', async () => {
    const api = createOverbookingApi(createClient());
    const move = await api.getMove('m1', { ...withIdempotency(idempotencyUuid) });
    expect(requests.at(-1)?.url).toBe(`/api/v1/room-moves/m1?idempotencyKey=${idempotencyUuid}`);
    expect(move.data.writeIntent?.state).toBe('SUCCEEDED');
    expect(move.data.allowedActions).toContain('APPROVE');
    // GET không phải lệnh ghi: không sinh Idempotency-Key mới.
    expect(requests.at(-1)?.headers['idempotency-key']).toBeUndefined();

    const merge = await api.getMerge('mg1');
    expect(merge.data.moveType).toBe('MERGE_SHARE');
    expect(merge.data.allowedActions).toContain('RECORD_CONSENT');

    const options = await api.relocationOptions('b1', { overbookingCaseId: 'c1' });
    expect(options.data.options).toEqual([]);
    expect(options.data).not.toHaveProperty('keepScore');

    const alerts = await api.alerts();
    expect(alerts.data.data).toHaveLength(1);
    expect(alerts.data.meta.scan.scanStatus).toBe('OK');
  });

  it('compensation_intent_and_status', async () => {
    const api = createOverbookingApi(createClient());
    respond({
      'POST /api/v1/room-moves/m1/compensation-payments': [
        { status: 200, body: { ...COMPENSATION, state: 'PENDING' } },
        {
          status: 200,
          body: {
            ...COMPENSATION,
            state: 'SUCCEEDED',
            paymentStatus: 'SUCCEEDED',
            paidAt: '2026-12-01T02:00:00Z',
          },
        },
        { status: 200, body: { ...COMPENSATION, state: 'UNKNOWN', paymentStatus: 'PENDING' } },
      ],
      'GET /api/v1/room-moves/m1/compensation-payments': { status: 200, body: COMPENSATION_VIEW },
    });

    const pending = await api.createCompensation(
      'm1',
      { method: 'BANK_TRANSFER', bankReference: 'FT26-0001' },
      { etag: 'W/"1"', ...withIdempotency(idempotencyUuid) },
    );
    expect(pending.data.state).toBe('PENDING');
    const posted = requests.at(-1);
    expect(posted?.headers['if-match']).toBe('W/"1"');
    expect(posted?.headers['idempotency-key']).toBe(idempotencyUuid);
    // Số tiền lấy từ quyết định đã duyệt: client KHÔNG gửi `amount`.
    expect(posted?.bodyText).not.toContain('"amount"');
    expect(posted?.bodyText).toBe(
      JSON.stringify({ method: 'BANK_TRANSFER', bankReference: 'FT26-0001', pinToken: PIN }),
    );

    const succeeded = await api.createCompensation(
      'm1',
      { method: 'BANK_TRANSFER', bankReference: 'FT26-0002' },
      { etag: 'W/"1"', ...withIdempotency(idempotencyUuid2) },
    );
    expect(succeeded.data.state).toBe('SUCCEEDED');
    const unknown = await api.createCompensation(
      'm1',
      { method: 'CASH', note: 'Chi tay có biên nhận' },
      { etag: 'W/"1"' },
    );
    expect(unknown.data.state).toBe('UNKNOWN');
    expect(unknown.data.operationId).toBe('op-comp-1');

    // Tra lại theo payment/operation ID bền, không tạo lần chi mới.
    const view = await api.listCompensations('m1');
    expect(view.data.approvedAmount).toBe(1_500_000);
    expect(view.data.payments[0]?.type).toBe('COMPENSATION');
  });
});
