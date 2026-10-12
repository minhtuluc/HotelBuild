import { createServer, type Server } from 'node:http';
import { afterAll, beforeAll, beforeEach, expect, test } from 'vitest';
import { ApiClient } from '@pinehill/api-client';
import { settingsPorts } from '../src/app/(ops)/system-settings/api';
let server: Server,
  baseUrl = '';
const calls: {
  path: string;
  method: string;
  tag: string | undefined;
  key: string | undefined;
  auth: string | undefined;
  body: string;
}[] = [];
let drop = false;
beforeAll(async () => {
  server = createServer((req, res) => {
    void (async () => {
      let body = '';
      for await (const chunk of req) body += chunk;
      calls.push({
        path: req.url ?? '',
        method: req.method ?? '',
        tag: req.headers['if-match']?.toString(),
        key: req.headers['idempotency-key']?.toString(),
        auth: req.headers.authorization,
        body,
      });
      if (req.method === 'PUT') {
        if (drop) {
          req.socket.destroy();
          return;
        }
        res.writeHead(204, { etag: '"5"' });
        res.end();
        return;
      }
      res.writeHead(200, { 'content-type': 'application/json' });
      if (req.url?.includes('/auth/me'))
        res.end(
          JSON.stringify({
            userId: 'owner1',
            username: 'synthetic-owner',
            fullName: 'Synthetic',
            role: 'OWNER',
            propertyScope: [],
            hasPin: false,
            mustChangePassword: false,
          }),
        );
      else
        res.end(
          JSON.stringify({
            data: [],
            meta: { total: 0, hasMore: false, nextCursor: null, limit: 100 },
          }),
        );
    })().catch(() => res.destroy());
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const a = server.address();
  if (!a || typeof a === 'string') throw Error('TCP');
  baseUrl = 'http://127.0.0.1:' + a.port + '/api/session/sys';
});
afterAll(() => new Promise<void>((r, j) => server.close((e) => (e ? j(e) : r()))));
beforeEach(() => {
  calls.length = 0;
  drop = false;
});
const key = '7ed2bdb1-c3e0-467f-89e0-058f08173141';
function ports() {
  return settingsPorts(
    new ApiClient({ baseUrl, getAccessToken: () => 'synthetic-access', maxAttempts: 3 }),
  );
}
test('real TCP staff identity/list and204 PUT carry bearer stable key/version and original payload', async () => {
  const p = ports(),
    signal = new AbortController().signal;
  expect((await p.actor(signal)).role).toBe('OWNER');
  expect(await p.list(signal)).toEqual([]);
  await p.write(
    'pricing.maxDiscountPct',
    { value: '25', reason: 'synthetic reason' },
    '"4"',
    key,
    signal,
  );
  expect(calls).toHaveLength(3);
  expect(calls.every((c) => c.auth === 'Bearer synthetic-access')).toBe(true);
  expect(calls[2]).toMatchObject({
    method: 'PUT',
    tag: '"4"',
    key,
    body: JSON.stringify({ value: '25', reason: 'synthetic reason' }),
  });
});
test('lost PUT response never triggers automatic retry despite client default', async () => {
  drop = true;
  await expect(
    ports().write(
      'pricing.maxDiscountPct',
      { value: '25', reason: 'synthetic reason' },
      '"4"',
      key,
      new AbortController().signal,
    ),
  ).rejects.toMatchObject({ kind: 'network' });
  expect(calls).toHaveLength(1);
});
