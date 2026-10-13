import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { ApiClient, ApiError } from '@pinehill/api-client';
import { adminPorts } from '../../src/app/(ops)/admin-commands/api';
import { GET, POST } from '../../src/app/api/session/sys/room-blocks/route';
import { DELETE } from '../../src/app/api/session/sys/room-blocks/[id]/route';
delete process.env.SESSION_APP_ORIGIN;
const key = 'babc0000-0000-4000-8000-000000000001';
const body = {
  roomId: 'r1',
  startDate: '2026-11-01',
  endDate: '2026-11-04',
  reason: 'MAINTENANCE' as const,
};
const block = { ...body, id: 'b1', note: null };
let denied = false;
const writes: { key: unknown; tag: unknown; body: unknown; path: string }[] = [];
function responseBody(status: number, method?: string) {
  if (status === 204) return undefined;
  if (denied)
    return JSON.stringify({
      code: 'E_AUTH_INVALID_CREDENTIALS',
      message: 'synthetic-private',
      traceId: 'synthetic-private-trace',
      timestamp: '2026-10-13T00:00:00Z',
      path: '/room-blocks',
    });
  return JSON.stringify(
    method === 'POST'
      ? { ...block, syntheticPrivate: 'synthetic-private' }
      : { data: [block], meta: { limit: 100, total: 1, hasMore: false, nextCursor: null } },
  );
}
const server = createServer((req, res) => {
  void (async () => {
    assert.equal(req.headers.authorization, 'Bearer synthetic-access');
    const chunks: Buffer[] = [];
    for await (const chunk of req) {
      if (!(chunk instanceof Uint8Array)) throw Error('bad chunk');
      chunks.push(Buffer.from(chunk));
    }
    if (req.method !== 'GET')
      writes.push({
        key: req.headers['idempotency-key'],
        tag: req.headers['if-match'],
        body: chunks.length ? JSON.parse(Buffer.concat(chunks).toString()) : undefined,
        path: req.url ?? '',
      });
    const status = denied ? 401 : req.method === 'POST' ? 201 : req.method === 'DELETE' ? 204 : 200;
    res.writeHead(status, {
      'content-type': 'application/json',
      'set-cookie': 'synthetic-private=hidden',
    });
    res.end(responseBody(status, req.method));
  })().catch((error: unknown) => res.destroy(error instanceof Error ? error : undefined));
});
await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
try {
  const address = server.address();
  if (!address || typeof address === 'string') throw Error('TCP');
  process.env.NEXT_PUBLIC_API_BASE_URL = 'http://127.0.0.1:' + address.port + '/api/v1';
  const fetchImpl: typeof fetch = async (input, init) => {
    const req = new Request(input, init);
    if (req.method !== 'GET') req.headers.set('origin', 'https://ops.test');
    return req.method === 'POST' ? POST(req) : req.method === 'DELETE' ? DELETE(req) : GET(req);
  };
  const client = new ApiClient({
    baseUrl: 'https://ops.test/api/session/sys',
    getAccessToken: () => 'synthetic-access',
    fetchImpl,
    maxAttempts: 4,
  });
  const ports = adminPorts(client, 'room-block');
  assert.deepEqual(
    await ports.write({ kind: 'room-block-create', body }, key, new AbortController().signal),
    { kind: 'room-block-create', data: block },
  );
  assert.deepEqual(writes, [{ key, tag: undefined, body, path: '/api/v1/room-blocks' }]);
  const reason = 'Synthetic repaired & checked';
  assert.deepEqual(
    await ports.write(
      { kind: 'room-block-delete', targetId: block.id, reason },
      key,
      new AbortController().signal,
    ),
    { kind: 'room-block-delete', id: block.id },
  );
  assert.equal(writes.length, 2);
  assert.equal(writes[1]?.key, key);
  assert.equal(writes[1]?.body, undefined);
  assert.equal(
    new URL('http://synthetic.test' + writes[1]?.path).searchParams.get('reason'),
    reason,
  );
  const headers = {
    authorization: 'Bearer synthetic-access',
    origin: 'https://ops.test',
    'idempotency-key': key,
  };
  assert.equal(
    (
      await POST(
        new Request('https://ops.test/api/session/sys/room-blocks', {
          method: 'POST',
          headers,
          body: JSON.stringify(body),
        }),
      )
    ).status,
    403,
  );
  for (const query of ['', '?reason=', '?reason=a&reason=b', '?reason=ok&extra=private']) {
    assert.equal(
      (
        await DELETE(
          new Request('https://ops.test/api/session/sys/room-blocks/b1' + query, {
            method: 'DELETE',
            headers: { ...headers, 'x-session-request': '1' },
          }),
        )
      ).status,
      400,
    );
  }
  assert.equal(writes.length, 2);
  const listed = await GET(
    new Request('https://ops.test/api/session/sys/room-blocks?limit=100', { headers }),
  );
  assert.equal(listed.status, 200);
  assert.equal(listed.headers.get('set-cookie'), null);
  assert.equal(listed.headers.get('cache-control'), 'no-store');
  denied = true;
  await assert.rejects(
    () => ports.write({ kind: 'room-block-create', body }, key, new AbortController().signal),
    (error) => error instanceof ApiError && error.status === 401,
  );
  assert.equal(writes.length, 3);
  const readDenied = await GET(
    new Request('https://ops.test/api/session/sys/room-blocks', { headers }),
  );
  assert.ok(!(await readDenied.text()).includes('synthetic-private'));
  process.stdout.write(
    JSON.stringify({
      wholeTransport: true,
      oneWrite: true,
      csrf: true,
      keyAndQuery: true,
      typedCreateAndVoidDelete: true,
      privateDataStripped: true,
    }),
  );
} finally {
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
}
