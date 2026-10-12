import { createServer, type Server } from 'node:http';
import { beforeAll, afterAll, beforeEach, expect, test } from 'vitest';
import { systemSettingUpdateRequestSchema } from '@pinehill/contracts';
import { createJourneyHandler } from '../src/server.js';
let server: Server;
let baseUrl = '';
const calls: {
  tag: string | undefined;
  key: string | undefined;
  body: string;
  auth: string | undefined;
}[] = [];
beforeAll(async () => {
  server = createServer((req, res) => {
    void (async () => {
      let body = '';
      for await (const chunk of req) body += chunk;
      calls.push({
        tag: req.headers['if-match']?.toString(),
        key: req.headers['idempotency-key']?.toString(),
        body,
        auth: req.headers.authorization,
      });
      res.writeHead(204, {
        etag: '"5"',
        'idempotency-replayed': 'true',
        'set-cookie': 'private=secret',
      });
      res.end();
    })().catch(() => res.destroy());
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const a = server.address();
  if (!a || typeof a === 'string') throw Error('TCP');
  baseUrl = 'http://127.0.0.1:' + a.port + '/api/v1';
});
afterAll(() => new Promise<void>((r, j) => server.close((e) => (e ? j(e) : r()))));
beforeEach(() => {
  calls.length = 0;
});
const id = '7ed2bdb1-c3e0-467f-89e0-058f08173141';
function request(
  patch: Record<string, string> = {},
  body: unknown = { value: '25', reason: 'synthetic reason' },
) {
  return new Request('https://ops.test/api/session/sys/system-settings/pricing.maxDiscountPct', {
    method: 'PUT',
    headers: {
      origin: 'https://ops.test',
      'x-session-request': '1',
      authorization: 'Bearer synthetic-access',
      'idempotency-key': id,
      'if-match': '"4"',
      'content-type': 'application/json',
      ...patch,
    },
    body: JSON.stringify(body),
  });
}
function handler() {
  return createJourneyHandler({
    baseUrl,
    origin: 'https://ops.test',
    routeResolver: (req) =>
      req.method === 'PUT' &&
      new URL(req.url).pathname === '/api/session/sys/system-settings/pricing.maxDiscountPct'
        ? {
            method: 'PUT',
            path: '/system-settings/pricing.maxDiscountPct',
            protected: true,
            body: systemSettingUpdateRequestSchema,
          }
        : undefined,
  });
}
test('staff settings PUT forwards original version/key/body once and preserves receipt headers', async () => {
  const response = await handler()(request());
  expect(response.status).toBe(204);
  expect(await response.text()).toBe('');
  expect(response.headers.get('etag')).toBe('"5"');
  expect(response.headers.get('idempotency-replayed')).toBe('true');
  expect(response.headers.get('set-cookie')).toBeNull();
  expect(calls).toEqual([
    {
      tag: '"4"',
      key: id,
      body: JSON.stringify({ value: '25', reason: 'synthetic reason' }),
      auth: 'Bearer synthetic-access',
    },
  ]);
});
test('CSRF, bearer, key and body validation reject before mutation', async () => {
  for (const patch of [
    { origin: 'https://foreign.test' },
    { authorization: '' },
    { 'idempotency-key': '' },
  ])
    expect((await handler()(request(patch))).status).toBeGreaterThanOrEqual(400);
  expect((await handler()(request({}, { value: '25', reason: '' }))).status).toBe(400);
  expect(calls).toHaveLength(0);
});
