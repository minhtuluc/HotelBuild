import { createServer, type Server } from 'node:http';
import { beforeAll, afterAll, beforeEach, expect, test } from 'vitest';
import { auditLogQuerySchema, auditLogEntrySchema, listResponseSchema } from '@pinehill/contracts';
import { createJourneyHandler } from '../src/server.js';
let server: Server;
let baseUrl = '';
let redirect = false;
const calls: { path: string; authorized: boolean }[] = [];
const page = { data: [], meta: { limit: 50, total: 0, nextCursor: null, hasMore: false } };
beforeAll(async () => {
  server = createServer((req, res) => {
    calls.push({
      path: req.url ?? '',
      authorized: req.headers.authorization === 'Bearer synthetic-access',
    });
    if (redirect) {
      res.writeHead(302, { location: '/api/v1/hidden' });
      res.end();
      return;
    }
    res.writeHead(200, {
      'content-type': 'application/json',
      'set-cookie': 'synthetic-upstream-cookie=private',
    });
    res.end(JSON.stringify(page));
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const a = server.address();
  if (!a || typeof a === 'string') throw Error('TCP port');
  baseUrl = 'http://127.0.0.1:' + a.port + '/api/v1';
});
afterAll(() => new Promise<void>((r, j) => server.close((e) => (e ? j(e) : r()))));
beforeEach(() => {
  calls.length = 0;
  redirect = false;
});
function request(path = '/api/session/sys/audit-logs', authorization = 'Bearer synthetic-access') {
  return new Request('https://ops.test' + path, { headers: { authorization } });
}
const resolve = (request: Request) =>
  request.method === 'GET' && new URL(request.url).pathname === '/api/session/sys/audit-logs'
    ? {
        method: 'GET' as const,
        path: '/audit-logs',
        protected: true,
        decoder: listResponseSchema(auditLogEntrySchema),
        query: (input: Record<string, string>) => auditLogQuerySchema.parse(input),
      }
    : undefined;
function handler() {
  return createJourneyHandler({ baseUrl, routeResolver: resolve });
}
test('trusted resolver serves staff audit over real TCP and strips private upstream headers', async () => {
  const response = await handler()(request('/api/session/sys/audit-logs?actorId=u1&limit=50'));
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual(page);
  expect(calls).toEqual([{ path: '/api/v1/audit-logs?actorId=u1&limit=50', authorized: true }]);
  expect(response.headers.get('set-cookie')).toBeNull();
  expect(response.headers.get('cache-control')).toBe('no-store');
});
test('staff resolver is strict and never falls back to guest journeys', async () => {
  expect((await handler()(request('/api/session/journey/bookings/b1'))).status).toBe(404);
  expect((await createJourneyHandler({ baseUrl })(request())).status).toBe(404);
  expect(calls).toHaveLength(0);
});
test('missing bearer rejects before upstream', async () => {
  expect((await handler()(request(undefined, ''))).status).toBe(401);
  expect(calls).toHaveLength(0);
});
test('unknown or repeated query keys reject before upstream', async () => {
  for (const path of [
    '/api/session/sys/audit-logs?secret=bad',
    '/api/session/sys/audit-logs?limit=1&limit=2',
  ])
    expect((await handler()(request(path))).status).toBe(400);
  expect(calls).toHaveLength(0);
});
test('upstream redirects are rejected rather than followed', async () => {
  redirect = true;
  expect((await handler()(request())).status).toBe(502);
  expect(calls).toHaveLength(1);
  expect(calls[0]?.path).not.toContain('hidden');
});
