import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { ApiClient, ApiError } from '@pinehill/api-client';
import { adminPorts } from '../../src/app/(ops)/admin-commands/api';
import { GET, PUT } from '../../src/app/api/session/sys/channel-allotments/route';
import { GET as channels } from '../../src/app/api/session/sys/channels/route';
import type { AdminCommand } from '../../src/app/(ops)/admin-commands/intent';
delete process.env.SESSION_APP_ORIGIN;
const key = '7ed2bdb1-c3e0-467f-89e0-000000000001';
const command: Extract<AdminCommand, { kind: 'allotment-put' }> = {
  kind: 'allotment-put',
  tag: '"9007199254740993"',
  range: { from: '2026-11-01', to: '2026-11-03' },
  body: { channelId: 'c1', roomTypeId: 'rt1', items: [{ date: '2026-11-01', allotment: 1 }] },
};
let status = 204;
const writes: { key: unknown; tag: unknown; body: unknown }[] = [];
function responseBody(get: boolean, url: string | undefined) {
  const channel = {
    id: 'c1',
    code: 'OTA_BOOKING',
    name: 'Synthetic',
    multiplier: 1,
    commissionPct: 15,
    holdMinutes: 30,
    overbookAllowed: false,
    version: 1,
  };
  const data = url?.startsWith('/api/v1/channels')
    ? [channel]
    : [{ date: '2026-11-01', allotment: 1, used: 2 }];
  return get
    ? { data, meta: { limit: 31, total: data.length, hasMore: false, nextCursor: null } }
    : {
        code: status === 409 ? 'E_INV_ALLOTMENT_EXCEEDS_ROOMS' : 'E_AUTH_TOKEN_EXPIRED',
        message: 'synthetic-private',
        traceId: 'synthetic',
        timestamp: '2026-11-01T00:00:00Z',
        path: '/channel-allotments',
        details: [
          { field: 'items[2026-11-01].allotment', issue: 'EXCEEDS_ACTIVE_SUPPLY' },
          { field: 'items[2026-11-02].allotment', issue: 'EXCEEDS_ACTIVE_SUPPLY' },
          { field: 'password', issue: 'SECRET' },
          { field: 'items[2026-11-01].allotment', issue: 'synthetic-private' },
        ],
      };
}
const server = createServer((req, res) => {
  void (async () => {
    assert.equal(req.headers.authorization, 'Bearer synthetic-access');
    const chunks: Buffer[] = [];
    for await (const chunk of req) {
      if (!(chunk instanceof Uint8Array)) throw Error('Bad chunk');
      chunks.push(Buffer.from(chunk));
    }
    if (req.method === 'PUT')
      writes.push({
        key: req.headers['idempotency-key'],
        tag: req.headers['if-match'],
        body: JSON.parse(Buffer.concat(chunks).toString()),
      });
    const get = req.method === 'GET';
    res.writeHead(get ? 200 : status, {
      'content-type': 'application/json',
      etag: get ? command.tag : '"9007199254740994"',
      'set-cookie': 'synthetic-private=hidden',
    });
    if (!get && status === 204) {
      res.end();
      return;
    }
    res.end(JSON.stringify(responseBody(get, req.url)));
  })().catch(() => {
    res.writeHead(500);
    res.end();
  });
});
await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
const address = server.address();
if (!address || typeof address === 'string') throw Error('TCP port');
process.env.NEXT_PUBLIC_API_BASE_URL = 'http://127.0.0.1:' + address.port + '/api/v1';
const client = new ApiClient({
  baseUrl: 'https://ops.test/api/session/sys',
  getAccessToken: () => 'synthetic-access',
  maxAttempts: 1,
  fetchImpl: async (input, init) => {
    const headers = new Headers(init?.headers);
    if (init?.method === 'PUT') headers.set('origin', 'https://ops.test');
    const request = new Request(String(input), { ...init, headers });
    return request.method === 'PUT' ? PUT(request) : GET(request);
  },
});
try {
  const receipt = await adminPorts(client, 'allotment').write(
    command,
    key,
    new AbortController().signal,
  );
  assert.deepEqual(receipt, {
    kind: 'allotment-put',
    channelId: 'c1',
    roomTypeId: 'rt1',
    tag: '"9007199254740994"',
  });
  assert.deepEqual(writes, [{ key, tag: command.tag, body: command.body }]);
  status = 409;
  let caught: unknown;
  try {
    await adminPorts(client, 'allotment').write(command, key, new AbortController().signal);
  } catch (error) {
    caught = error;
  }
  assert(caught instanceof ApiError);
  assert.equal(caught.status, 409);
  assert.deepEqual(caught.details, [
    { field: 'items[2026-11-01].allotment', issue: 'EXCEEDS_ACTIVE_SUPPLY' },
  ]);
  assert(!JSON.stringify(caught).includes('synthetic-private'));
  status = 401;
  await assert.rejects(
    () => adminPorts(client, 'allotment').write(command, key, new AbortController().signal),
    (error) => error instanceof ApiError && error.status === 401,
  );
  assert.equal(writes.length, 3);
  const req = (suffix: string) =>
    new Request('https://ops.test/api/session/sys/' + suffix, {
      headers: { authorization: 'Bearer synthetic-access' },
    });
  const read = await GET(
    req('channel-allotments?channelId=c1&roomTypeId=rt1&from=2026-11-01&to=2026-11-03'),
  );
  assert.equal(read.status, 200);
  assert.equal(read.headers.get('etag'), command.tag);
  assert.equal(read.headers.get('cache-control'), 'no-store');
  assert.equal(read.headers.get('set-cookie'), null);
  assert.equal((await channels(req('channels?limit=100'))).status, 200);
  for (const query of [
    'channelId=c1&roomTypeId=rt1&from=2026-02-30&to=2026-03-01',
    'channelId=c1&roomTypeId=rt1&from=2026-11-01&to=2026-11-03&secret=x',
    'channelId=c1&channelId=c2&roomTypeId=rt1&from=2026-11-01&to=2026-11-03',
  ])
    assert.equal((await GET(req('channel-allotments?' + query))).status, 400);
  const write = new Request('https://ops.test/api/session/sys/channel-allotments', {
    method: 'PUT',
    headers: {
      authorization: 'Bearer synthetic-access',
      'idempotency-key': key,
      'content-type': 'application/json',
    },
    body: JSON.stringify(command.body),
  });
  assert.equal((await PUT(write)).status, 403);
  assert.equal(writes.length, 3);
  assert.equal(
    (await GET(new Request('https://ops.test/api/session/sys/channel-allotments'))).status,
    401,
  );
  process.stdout.write(
    JSON.stringify({
      wholeTransport: true,
      exactTagAndKey: true,
      quotaDatesWhitelist: true,
      one401Write: true,
      csrf: true,
      strictQuery: true,
      privateDataStripped: true,
    }) + '\n',
  );
} finally {
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
}
