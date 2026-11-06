import {
  ApiClient,
  createAuthApi,
  createOverbookingApi,
  createRefundApi,
} from '@pinehill/api-client';
import { channelMappingsViewSchema } from '@pinehill/contracts';
import { POST as pinVerify } from '../../src/app/api/session/sys/auth/pin/verify/route';
import { PUT as putMapping } from '../../src/app/api/session/sys/channels/[id]/mappings/route';
import { GET as listRefunds } from '../../src/app/api/session/sys/refund-requests/route';
import { POST as approveMove } from '../../src/app/api/session/sys/room-moves/[id]/approve/route';
import {
  ORIGIN,
  done,
  fieldOf,
  errorBody,
  sample,
  startFake,
  type Reply,
  type Seen,
} from './harness';

/** Trình duyệt giả: `ApiClient` thật → BFF (route.ts thật) → API giả qua TCP; thêm `Origin` + `X-Session-Request` như `ops-session`. */
const handlers: Record<string, (request: Request) => Promise<Response>> = {
  'PUT /api/session/sys/channels/c1/mappings': putMapping,
  'POST /api/session/sys/room-moves/mv1/approve': approveMove,
  'GET /api/session/sys/refund-requests': listRefunds,
  'POST /api/session/sys/auth/pin/verify': pinVerify,
};
const fetchImpl: typeof fetch = async (input, init) => {
  const request = new Request(input, init);
  if (request.method !== 'GET') {
    request.headers.set('origin', ORIGIN);
    request.headers.set('x-session-request', '1');
  }
  const handler = handlers[`${request.method} ${new URL(request.url).pathname}`];
  return handler === undefined ? new Response('{}', { status: 404 }) : handler(request);
};

const applied = new Set<string>();
const fake = await startFake((seen: Seen): Reply => {
  const key = String(seen.headers['idempotency-key'] ?? '');
  if (seen.url.endsWith('/approve')) {
    // Lần đầu 503 (chưa áp dụng); lần gửi lại cùng khoá mới được áp dụng đúng một lần.
    if (!applied.has(`seen:${key}`)) {
      applied.add(`seen:${key}`);
      return { status: 503, body: errorBody('E_GEN_SERVICE_UNAVAILABLE') };
    }
    applied.add(key);
    return { status: 200, headers: { etag: '"8"' }, body: sample.roomMove };
  }
  if (seen.url.endsWith('/auth/pin/verify'))
    return { status: 401, body: errorBody('E_AUTH_INVALID_CREDENTIALS') };
  if (seen.url.includes('/refund-requests')) return { status: 200, body: sample.refundList };
  return {
    status: 200,
    headers: { etag: '"3"', 'idempotency-replayed': 'true' },
    body: sample.mappingsView,
  };
});

let reauthorized = 0;
const client = new ApiClient({
  baseUrl: `${ORIGIN}/api/session/sys`,
  getAccessToken: () => 'synthetic-access',
  getPinToken: () => 'synthetic-pin-token-0001',
  onUnauthorized: async () => {
    reauthorized += 1;
    return true;
  },
  fetchImpl,
  maxAttempts: 3,
  sleep: async () => undefined,
});
const KEY = 'babc0000-0000-4000-8000-0000000000aa';

const mapped = await client.request({
  method: 'PUT',
  path: '/channels/c1/mappings',
  body: { roomTypeId: 'rt1', providerRoomTypeCode: 'OTA-1', allotmentPct: 40 },
  ifMatch: '"2"',
  idempotencyKey: KEY,
  decoder: channelMappingsViewSchema,
});
const mappingSeen = fake.seen.filter((item) => item.url.endsWith('/mappings'));

const approved = await createOverbookingApi(client).approveMove(
  'mv1',
  { compensationAmount: 0, transportCost: 0 },
  { etag: '"7"', idempotencyKey: KEY },
);
const approveSeen = fake.seen.filter((item) => item.url.endsWith('/approve'));

const refunds = await createRefundApi(client).list({ status: 'PENDING' });
const refundSeen = fake.seen.find((item) => item.url.includes('/refund-requests'));

let pinStatus = 0;
try {
  await createAuthApi(client).pinVerify('123456', 'bk-1');
} catch (error) {
  pinStatus =
    error instanceof Error && 'status' in error && typeof error.status === 'number'
      ? error.status
      : -1;
}
const pinSeen = fake.seen.filter((item) => item.url.endsWith('/auth/pin/verify'));
await fake.close();
done({
  mapping: {
    calls: mappingSeen.length,
    key: mappingSeen[0]?.headers['idempotency-key'],
    tag: mappingSeen[0]?.headers['if-match'],
    etag: mapped.etag,
    replayed: mapped.replayed,
    version: mapped.data.version,
  },
  approve: {
    calls: approveSeen.length,
    sameKey:
      new Set(approveSeen.map((item) => item.headers['idempotency-key'])).size === 1 &&
      approveSeen[0]?.headers['idempotency-key'] === KEY,
    sameTag: approveSeen.every((item) => item.headers['if-match'] === '"7"'),
    sameBody: new Set(approveSeen.map((item) => item.body)).size === 1,
    pinInBody: approveSeen.every(
      (item) => fieldOf(item.body, 'pinToken') === 'synthetic-pin-token-0001',
    ),
    pinNotInUrl: approveSeen.every((item) => !item.url.includes('synthetic-pin-token')),
    appliedOnce: [...applied].filter((item) => !item.startsWith('seen:')).length,
    etag: approved.etag,
    status: approved.data.status,
  },
  refunds: { url: refundSeen?.url, total: refunds.data.meta.total },
  pin: {
    status: pinStatus,
    upstreamCalls: pinSeen.length,
    reauthorized,
    bodyHasPin: pinSeen[0]?.body.includes('123456') === true,
    pinTokenHeaderless: pinSeen.every(
      (item) => !JSON.stringify(item.headers).includes('synthetic-pin'),
    ),
  },
});
