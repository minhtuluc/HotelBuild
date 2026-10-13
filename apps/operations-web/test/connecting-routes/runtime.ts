import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { ApiClient, ApiError } from '@pinehill/api-client';
import { adminPorts } from '../../src/app/(ops)/admin-commands/api';
import { GET } from '../../src/app/api/session/sys/rooms/route';
import { PUT } from '../../src/app/api/session/sys/rooms/[id]/connecting-room/route';
delete process.env.SESSION_APP_ORIGIN;
const key = 'babc0000-0000-4000-8000-000000000001';
const room = {
  id: 'r1',
  propertyId: 'p1',
  roomTypeId: 'rt1',
  code: 'CS01-101',
  floor: 1,
  status: 'ACTIVE',
  connectingRoomId: 'r2',
  version: 1789876543123456,
};
let status = 200;
const writes: { key: unknown; tag: unknown; body: unknown; path: string }[] = [];
const server = createServer((req, res) => {
  void (async () => {
    assert.equal(req.headers.authorization, 'Bearer synthetic-access');
    const chunks: Buffer[] = [];
    for await (const chunk of req) {
      if (!(chunk instanceof Uint8Array)) throw Error('bad chunk');
      chunks.push(Buffer.from(chunk));
    }
    if (req.method === 'PUT')
      writes.push({
        key: req.headers['idempotency-key'],
        tag: req.headers['if-match'],
        body: JSON.parse(Buffer.concat(chunks).toString()),
        path: req.url ?? '',
      });
    res.writeHead(status, {
      'content-type': 'application/json',
      'set-cookie': 'synthetic-private=hidden',
    });
    res.end(
      JSON.stringify(
        status === 200
          ? req.method === 'PUT'
            ? room
            : { data: [room], meta: { limit: 100, total: 1, hasMore: false, nextCursor: null } }
          : {
              code: 'E_AUTH_INVALID_CREDENTIALS',
              message: 'synthetic-private',
              traceId: 'synthetic-private-trace',
              timestamp: '2026-10-13T00:00:00Z',
              path: '/rooms/r1/connecting-room',
            },
      ),
    );
  })().catch((e) => {
    res.destroy(e instanceof Error ? e : undefined);
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
    return req.method === 'PUT' ? PUT(req) : GET(req);
  };
  const client = new ApiClient({
    baseUrl: 'https://ops.test/api/session/sys',
    getAccessToken: () => 'synthetic-access',
    fetchImpl,
    maxAttempts: 4,
  });
  const ports = adminPorts(client, 'connecting');
  const command = {
    kind: 'connecting-update' as const,
    targetId: 'r1',
    tag: '"1789876543123450"',
    body: { connectingRoomId: 'r2' },
  };
  const receipt = await ports.write(command, key, new AbortController().signal);
  assert.equal(receipt.kind, 'connecting-update');
  assert.equal(receipt.data.version, room.version);
  assert.deepEqual(writes, [
    { key, tag: command.tag, body: command.body, path: '/api/v1/rooms/r1/connecting-room' },
  ]);
  const invalid = new Request('https://ops.test/api/session/sys/rooms/r1/connecting-room', {
    method: 'PUT',
    headers: {
      origin: 'https://ops.test',
      authorization: 'Bearer synthetic-access',
      'idempotency-key': key,
    },
    body: JSON.stringify(command.body),
  });
  assert.equal((await PUT(invalid)).status, 403);
  assert.equal(writes.length, 1);
  const request = new Request('https://ops.test/api/session/sys/rooms?limit=100', {
    headers: { authorization: 'Bearer synthetic-access' },
  });
  const listed = await GET(request);
  assert.equal(listed.status, 200);
  assert.equal(listed.headers.get('set-cookie'), null);
  assert.equal(listed.headers.get('cache-control'), 'no-store');
  status = 401;
  await assert.rejects(
    () => ports.write(command, key, new AbortController().signal),
    (e) => e instanceof ApiError && e.status === 401,
  );
  assert.equal(writes.length, 2);
  const denied = await GET(
    new Request('https://ops.test/api/session/sys/rooms', {
      headers: { authorization: 'Bearer synthetic-access' },
    }),
  );
  assert.ok(!(await denied.text()).includes('synthetic-private'));
  process.stdout.write(
    JSON.stringify({
      wholeTransport: true,
      oneWrite: true,
      csrf: true,
      keyAndVersion: true,
      safeRoomVersion: true,
      privateDataStripped: true,
    }),
  );
} finally {
  await new Promise<void>((r, j) => server.close((e) => (e ? j(e) : r())));
}
