import { createServer, type Server, type IncomingMessage, type ServerResponse } from 'node:http';
import { beforeAll, afterAll, beforeEach, expect, test } from 'vitest';
import { ApiClient } from '@pinehill/api-client';
import { systemSettingUpdateRequestSchema } from '@pinehill/contracts';
import { settingsPorts } from '../../../apps/operations-web/src/app/(ops)/system-settings/api.js';
import { createJourneyHandler } from '../src/server.js';
let upstream: Server,
  bff: Server,
  baseUrl = '',
  origin = '';
const sends: { key: string | undefined; tag: string | undefined; body: string }[] = [];
async function listen(server: Server) {
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const a = server.address();
  if (!a || typeof a === 'string') throw Error('TCP');
  return 'http://127.0.0.1:' + a.port;
}
async function proxy(req: IncomingMessage, res: ServerResponse) {
  let body = '';
  for await (const chunk of req) body += chunk;
  const headers = new Headers();
  for (const [key, value] of Object.entries(req.headers))
    if (typeof value === 'string') headers.set(key, value);
  const request = new Request(origin + (req.url ?? ''), {
    method: req.method ?? 'PUT',
    headers,
    body,
  });
  const result = await createJourneyHandler({
    baseUrl,
    origin,
    routeResolver: (r) =>
      r.method === 'PUT' &&
      new URL(r.url).pathname === '/api/session/sys/system-settings/pricing.maxDiscountPct'
        ? {
            method: 'PUT',
            path: '/system-settings/pricing.maxDiscountPct',
            protected: true,
            body: systemSettingUpdateRequestSchema,
          }
        : undefined,
  })(request);
  const responseHeaders: Record<string, string> = {};
  result.headers.forEach((value, key) => {
    responseHeaders[key] = value;
  });
  res.writeHead(result.status, responseHeaders);
  res.end(await result.text());
}
beforeAll(async () => {
  upstream = createServer((req, res) => {
    void (async () => {
      let body = '';
      for await (const chunk of req) body += chunk;
      sends.push({
        key: req.headers['idempotency-key']?.toString(),
        tag: req.headers['if-match']?.toString(),
        body,
      });
      res.writeHead(204, { etag: '"5"' });
      res.end();
    })().catch(() => res.destroy());
  });
  baseUrl = (await listen(upstream)) + '/api/v1';
  bff = createServer((req, res) => {
    void proxy(req, res).catch(() => res.destroy());
  });
  origin = await listen(bff);
});
afterAll(async () => {
  for (const server of [bff, upstream])
    await new Promise<void>((r, j) => server.close((e) => (e ? j(e) : r())));
});
beforeEach(() => {
  sends.length = 0;
});
const id = '7ed2bdb1-c3e0-467f-89e0-058f08173141';
function client(browserOrigin = origin) {
  return new ApiClient({
    baseUrl: origin + '/api/session/sys',
    getAccessToken: () => 'synthetic-access',
    fetchImpl: (input, init) => {
      const headers = new Headers(init?.headers);
      headers.set('origin', browserOrigin);
      return fetch(input, { ...init, headers });
    },
    maxAttempts: 3,
  });
}
test('production settings client reaches actual BFF CSRF guard and writes upstream exactly once', async () => {
  await settingsPorts(client()).write(
    'pricing.maxDiscountPct',
    { value: '25', reason: 'synthetic reason' },
    '"4"',
    id,
    new AbortController().signal,
  );
  expect(sends).toEqual([
    { key: id, tag: '"4"', body: JSON.stringify({ value: '25', reason: 'synthetic reason' }) },
  ]);
});
test('production marker cannot bypass a foreign origin at real BFF', async () => {
  await expect(
    settingsPorts(client('https://foreign.test')).write(
      'pricing.maxDiscountPct',
      { value: '25', reason: 'synthetic reason' },
      '"4"',
      id,
      new AbortController().signal,
    ),
  ).rejects.toMatchObject({ status: 403 });
  expect(sends).toHaveLength(0);
});
