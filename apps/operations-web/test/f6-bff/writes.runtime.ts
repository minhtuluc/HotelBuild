import { F6_CATALOGUE, f6Handler } from '../../src/app/api/session/sys/f6-route';
import {
  BEARER,
  KEY,
  browser,
  done,
  errorBody,
  jsonOf,
  sample,
  startFake,
  type Reply,
} from './harness';

const fake = await startFake();
const writes = F6_CATALOGUE.filter((entry) => entry.method !== 'GET');
const pathOf = (pattern: string): string => pattern.replaceAll(/:\w+/g, 'x1');

/** AC2: thiếu CSRF/khoá/phiên bị chặn **trước** khi gọi upstream, cho cả 19 lệnh ghi. */
const gates: Record<'csrf' | 'noKey' | 'badKey' | 'noSession', number[]> = {
  csrf: [],
  noKey: [],
  badKey: [],
  noSession: [],
};
for (const entry of writes) {
  const handle = f6Handler(entry.id);
  const path = pathOf(entry.pattern);
  gates.csrf.push((await handle(browser(entry.method, path, { body: {}, csrf: false }))).status);
  gates.noKey.push((await handle(browser(entry.method, path, { body: {}, key: null }))).status);
  gates.badKey.push(
    (await handle(browser(entry.method, path, { body: {}, key: 'not-a-uuid' }))).status,
  );
  gates.noSession.push(
    (await handle(browser(entry.method, path, { body: {}, bearer: false }))).status,
  );
}
const gateCalls = fake.seen.length;

interface Case {
  id: string;
  method: string;
  path: string;
  upstream: string;
  body?: unknown;
  tag?: string;
  reply: Reply;
}
const headers = { etag: '"4"', 'idempotency-replayed': 'true' };
const cases: Case[] = [
  {
    id: 'mappings.put',
    method: 'PUT',
    path: '/channels/c1/mappings',
    upstream: '/api/v1/channels/c1/mappings',
    body: { roomTypeId: 'rt1', providerRoomTypeCode: 'OTA-1', allotmentPct: 40 },
    tag: '"3"',
    reply: { status: 200, headers, body: sample.mappingsView },
  },
  {
    id: 'deliveries.retry',
    method: 'POST',
    path: '/channels/c1/outbox-deliveries/d1/retry',
    upstream: '/api/v1/channels/c1/outbox-deliveries/d1/retry',
    reply: { status: 202, headers, body: sample.operationRef },
  },
  {
    id: 'cases.resolve',
    method: 'POST',
    path: '/overbooking-cases/k1/resolve',
    upstream: '/api/v1/overbooking-cases/k1/resolve',
    body: { resolutionNote: 'ok' },
    tag: '"3"',
    reply: { status: 200, headers, body: sample.resolved },
  },
  {
    id: 'moves.execute',
    method: 'POST',
    path: '/room-moves/mv1/execute',
    upstream: '/api/v1/room-moves/mv1/execute',
    body: { pinToken: 'synthetic-pin-token-0001' },
    tag: '"7"',
    reply: { status: 200, headers, body: sample.roomMove },
  },
  {
    id: 'pin.verify',
    method: 'POST',
    path: '/auth/pin/verify',
    upstream: '/api/v1/auth/pin/verify',
    body: { pin: '123456', bookingId: 'bk-1' },
    reply: { status: 200, body: sample.pinToken },
  },
];
const passes: Record<string, boolean> = {};
for (const item of cases) {
  fake.seen.length = 0;
  fake.reply = () => item.reply;
  const response = await f6Handler(item.id)(
    browser(item.method, item.path, {
      body: item.body,
      ...(item.tag === undefined ? {} : { tag: item.tag }),
    }),
  );
  const seen = fake.seen[0];
  const text = JSON.stringify(await jsonOf(response.clone()));
  passes[item.id] =
    fake.seen.length === 1 &&
    seen?.method === item.method &&
    seen.url === item.upstream &&
    seen.headers['idempotency-key'] === KEY &&
    seen.headers['if-match'] === item.tag &&
    seen.headers.authorization === BEARER &&
    (item.body === undefined
      ? seen.body === ''
      : JSON.parse(seen.body) === undefined ||
        JSON.stringify(JSON.parse(seen.body)) === JSON.stringify(item.body)) &&
    response.status === item.reply.status &&
    response.headers.get('etag') === (item.reply.headers?.etag ?? null) &&
    response.headers.get('idempotency-replayed') ===
      (item.reply.headers === undefined ? null : 'true') &&
    response.headers.get('set-cookie') === null &&
    response.headers.get('cache-control') === 'no-store' &&
    !text.includes('synthetic-private');
}

/** AC5: thân sai schema/quá lớn/không phải JSON/thiếu ⇒ 400 mã chung và không gọi upstream. */
fake.seen.length = 0;
const mapping = f6Handler('mappings.put');
const bad = [
  await mapping(
    browser('PUT', '/channels/c1/mappings', {
      body: { roomTypeId: 'rt1', providerRoomTypeCode: 'x', allotmentPct: 140 },
    }),
  ),
  await mapping(browser('PUT', '/channels/c1/mappings', { rawBody: '{not json' })),
  await mapping(
    browser('PUT', '/channels/c1/mappings', {
      rawBody: JSON.stringify({
        roomTypeId: 'rt1',
        providerRoomTypeCode: 'x'.repeat(20_000),
        allotmentPct: 1,
      }),
    }),
  ),
  await mapping(browser('PUT', '/channels/c1/mappings', {})),
];
const bodies = await Promise.all(bad.map(async (response) => jsonOf(response)));
fake.reply = () => ({
  status: 422,
  body: errorBody('E_GEN_VALIDATION_FAILED', {
    details: [
      { field: 'providerRoomTypeCode', issue: 'DUPLICATE' },
      { field: 'secret', issue: 'LEAK' },
    ],
  }),
});
const upstreamInvalid = await jsonOf(
  await mapping(
    browser('PUT', '/channels/c1/mappings', {
      body: { roomTypeId: 'rt1', providerRoomTypeCode: 'x', allotmentPct: 1 },
    }),
  ),
);
await fake.close();
done({
  writes: writes.length,
  gates,
  gateCalls,
  passes,
  invalidStatuses: bad.map((response) => response.status),
  invalidCodes: bodies.map((body) => body.code),
  noUpstreamForInvalid: fake.seen.length === 1,
  details: upstreamInvalid.details,
});
