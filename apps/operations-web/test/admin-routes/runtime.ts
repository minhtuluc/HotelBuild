import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { ApiClient, ApiError } from '@pinehill/api-client';
import { adminPorts } from '../../src/app/(ops)/admin-commands/api';
import { PATCH } from '../../src/app/api/session/sys/properties/[id]/route';
import { POST } from '../../src/app/api/session/sys/room-types/route';
import { GET as properties } from '../../src/app/api/session/sys/properties/route';
delete process.env.SESSION_APP_ORIGIN;
const key = 'babc0000-0000-4000-8000-000000000001';
const property = {
  id: 'p1',
  name: 'Synthetic property',
  status: 'ACTIVE',
  activeRoomCount: 1,
  overbookLimitPct: 5,
  checkInTime: '14:00',
  checkOutTime: '12:00',
  version: 4,
};
const type = {
  id: 'rt1',
  propertyId: 'p1',
  code: 'STD2',
  capacityAdults: 2,
  capacityChildren: 0,
  basePrice: 900000,
  minPrice: 700000,
  maxPrice: 1400000,
  allowShared: false,
  bedCount: 2,
  version: 1,
};
const { id: _id, version: _version, ...typeInput } = type;
let status = 200;
const writes: { path: string; key: unknown; tag: unknown; body: unknown }[] = [];
const server = createServer((req, res) => {
  void (async () => {
    assert.equal(req.headers.authorization, 'Bearer synthetic-access');
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(Buffer.from(chunk));
    if (req.method !== 'GET')
      writes.push({
        path: req.url ?? '',
        key: req.headers['idempotency-key'],
        tag: req.headers['if-match'],
        body: JSON.parse(Buffer.concat(chunks).toString()),
      });
    res.writeHead(status, {
      'content-type': 'application/json',
      'set-cookie': 'synthetic-private=hidden',
      etag: '"4"',
    });
    res.end(
      JSON.stringify(
        status === 200
          ? req.method === 'GET'
            ? { data: [property], meta: { limit: 100, total: 1, hasMore: false, nextCursor: null } }
            : req.url?.endsWith('/room-types')
              ? type
              : property
          : {
              code: 'E_RATE_CONFIGURATION_INVALID',
              message: 'synthetic-private-upstream',
              traceId: 'synthetic-private-trace',
              timestamp: '2026-10-13T00:00:00Z',
              path: '/api/v1/room-types',
              details: [{ field: 'minPrice', issue: 'ABOVE_CEILING' }],
            },
      ),
    );
  })().catch((error) => {
    res.destroy(error instanceof Error ? error : undefined);
  });
});
await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
try {
  const address = server.address();
  if (!address || typeof address === 'string') throw Error('TCP');
  process.env.NEXT_PUBLIC_API_BASE_URL = 'http://127.0.0.1:' + address.port + '/api/v1';
  const fetchImpl: typeof fetch = async (input, init) => {
    const req = new Request(input, init);
    if (req.method !== 'GET') req.headers.set('origin', 'https://ops.test');
    return req.method === 'PATCH'
      ? PATCH(req)
      : req.method === 'POST'
        ? POST(req)
        : properties(req);
  };
  const client = new ApiClient({
    baseUrl: 'https://ops.test/api/session/sys',
    getAccessToken: () => 'synthetic-access',
    fetchImpl,
    maxAttempts: 4,
  });
  const ports = adminPorts(client, 'property');
  const signal = new AbortController().signal;
  assert.equal((await ports.read(signal)).properties[0]?.version, 4);
  const body = { name: 'Synthetic property', reason: '  nguyên văn  ' };
  assert.equal(
    (await ports.write({ kind: 'property-update', targetId: 'p1', tag: '"3"', body }, key, signal))
      .kind,
    'property-update',
  );
  assert.deepEqual(writes[0], { path: '/api/v1/properties/p1', key, tag: '"3"', body });
  const forbidden = new Request('https://ops.test/api/session/sys/properties/p1', {
    method: 'PATCH',
    headers: {
      authorization: 'Bearer synthetic-access',
      origin: 'https://ops.test',
      'idempotency-key': key,
    },
    body: JSON.stringify(body),
  });
  assert.equal((await PATCH(forbidden)).status, 403);
  assert.equal(writes.length, 1);
  status = 401;
  await assert.rejects(
    () => ports.write({ kind: 'property-update', targetId: 'p1', tag: '"3"', body }, key, signal),
    (e) => e instanceof ApiError && e.status === 401,
  );
  assert.equal(writes.length, 2);
  status = 422;
  const error = await adminPorts(client, 'room-type')
    .write({ kind: 'room-type-create', body: typeInput }, key, signal)
    .then(
      () => {
        throw Error('expected rejection');
      },
      (e) => e,
    );
  assert.ok(error instanceof ApiError);
  assert.equal(error.status, 422);
  assert.deepEqual(error.details, [{ field: 'minPrice', issue: 'ABOVE_CEILING' }]);
  assert.equal(writes.length, 3);
  const response = await POST(
    new Request('https://ops.test/api/session/sys/room-types', {
      method: 'POST',
      headers: {
        authorization: 'Bearer synthetic-access',
        origin: 'https://ops.test',
        'x-session-request': '1',
        'idempotency-key': key,
      },
      body: JSON.stringify(typeInput),
    }),
  );
  assert.equal(response.headers.get('set-cookie'), null);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.ok(!(await response.text()).includes('synthetic-private'));
  process.stdout.write(
    JSON.stringify({
      wholeTransport: true,
      oneWrite: true,
      csrf: true,
      keyAndVersion: true,
      validationFields: true,
      privateDataStripped: true,
    }),
  );
} finally {
  await new Promise<void>((r, j) => server.close((e) => (e ? j(e) : r())));
}
