import { createServer, type Server } from 'node:http';
import { afterAll, beforeAll, beforeEach, expect, test } from 'vitest';
import { createJourneyHandler } from '../src/server.js';
import {
  availability,
  plans,
  quote,
  hold,
  booking,
  search,
  quoteInput,
  holdInput,
  bookingInput,
  key,
} from './journey-fixtures.js';
let server: Server,
  baseUrl = '';
let status = 200,
  payload: unknown = availability;
let redirectStatus: number | undefined;
const calls: {
  path: string;
  headers: Record<string, string | string[] | undefined>;
  body: unknown;
}[] = [];
beforeAll(async () => {
  server = createServer((req, res) => {
    void (async () => {
      const chunks: Buffer[] = [];
      for await (const chunk of req) {
        if (!(chunk instanceof Uint8Array)) throw new Error('Bad chunk');
        chunks.push(Buffer.from(chunk));
      }
      const text = Buffer.concat(chunks).toString();
      const body: unknown = text ? JSON.parse(text) : undefined;
      calls.push({ path: req.url ?? '', headers: req.headers, body });
      if (redirectStatus && req.url === '/api/v1/holds') {
        res.writeHead(redirectStatus, { location: '/api/v1/admin/forbidden-write' });
        res.end();
        return;
      }
      res.writeHead(status, {
        'content-type': 'application/json',
        'set-cookie': 'private-upstream-cookie=secret',
        'idempotency-replayed': 'true',
        'retry-after': '42',
      });
      res.end(status === 204 ? undefined : JSON.stringify(payload));
    })().catch(() => {
      res.writeHead(500);
      res.end();
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('No port');
  baseUrl = `http://127.0.0.1:${address.port}/api/v1`;
});
afterAll(
  async () =>
    new Promise<void>((resolve, reject) => server.close((e) => (e ? reject(e) : resolve()))),
);
beforeEach(() => {
  calls.length = 0;
  status = 200;
  redirectStatus = undefined;
  payload = availability;
});
function req(path: string, method = 'GET', body?: unknown, headers: Record<string, string> = {}) {
  return new Request(`https://guest.test/api/session/journey${path}`, {
    method,
    headers: {
      origin: 'https://guest.test',
      'x-session-request': '1',
      'idempotency-key': key,
      ...headers,
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}
const query = new URLSearchParams(
  Object.entries(search).map(([k, v]) => [k, String(v)]),
).toString();
test.each([
  ['/inventory/availability?' + query, availability],
  ['/rate-plans?propertyId=synthetic-property&checkIn=2026-10-10&checkOut=2026-10-11', plans],
] as const)(
  'publicGET %s requires no session and strips cookies/upstream extras',
  async (path, body) => {
    payload = { ...body, refreshToken: 'must-not-escape' };
    const response = await createJourneyHandler({ baseUrl })(
      req(path, 'GET', undefined, { cookie: 'pinehill_guest_refresh=private', authorization: '' }),
    );
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(response.headers.get('set-cookie')).toBeNull();
    expect(await response.text()).not.toContain('must-not-escape');
    expect(calls).toHaveLength(1);
    expect(calls[0]?.headers.cookie).toBeUndefined();
    expect(calls[0]?.headers.authorization).toBeUndefined();
  },
);
test('public quote preserves upstream price/TTL and idempotency key, never computes price', async () => {
  status = 201;
  payload = quote;
  const response = await createJourneyHandler({ baseUrl })(req('/quotes', 'POST', quoteInput));
  expect(response.status).toBe(201);
  expect(await response.json()).toMatchObject({
    total: 1000000,
    depositAmount: 300000,
    expiresAt: '2026-10-07T00:15:00.000Z',
  });
  expect(calls[0]).toMatchObject({
    path: '/api/v1/quotes',
    body: quoteInput,
    headers: { 'idempotency-key': key },
  });
});
test.each(['/holds', '/bookings'])(
  'protected%s rejects missing/malformed bearer even with refresh cookie',
  async (path) => {
    for (const authorization of ['', 'Basic abc', 'Bearer ', 'Bearer a b']) {
      const response = await createJourneyHandler({ baseUrl })(
        req(path, 'POST', path === '/holds' ? holdInput : bookingInput, {
          authorization,
          cookie: 'pinehill_guest_refresh=private',
        }),
      );
      expect(response.status).toBe(401);
    }
    expect(calls).toHaveLength(0);
  },
);
test.each([
  ['/holds', holdInput, hold],
  ['/bookings', bookingInput, booking],
] as const)('authenticated %s sends only bearer and same key once', async (path, input, body) => {
  status = 201;
  payload = body;
  const response = await createJourneyHandler({ baseUrl })(
    req(path, 'POST', input, {
      authorization: 'Bearer synthetic-guest-access',
      cookie: 'pinehill_staff_refresh=private',
    }),
  );
  expect(response.status).toBe(201);
  expect(await response.json()).toMatchObject(
    path === '/holds'
      ? { holdId: 'synthetic-hold', quotedTotal: 1000000 }
      : { duplicateSuspected: true, totalAmount: 1000000 },
  );
  expect(calls[0]).toMatchObject({
    path: `/api/v1${path}`,
    headers: { authorization: 'Bearer synthetic-guest-access', 'idempotency-key': key },
    body: input,
  });
  expect(calls[0]?.headers.cookie).toBeUndefined();
  expect(response.headers.get('idempotency-replayed')).toBe('true');
});
test.each([
  ['/quotes', 'GET'],
  ['/rate-plans/admin', 'GET'],
  ['/../auth/login', 'POST'],
  ['/bookings/../../users', 'GET'],
  ['/holds', 'PUT'],
  ['/unknown', 'POST'],
])('fixedallowlist rejects %s %s before upstream', async (path, method) => {
  expect((await createJourneyHandler({ baseUrl })(req(path, method))).status).toBe(404);
  expect(calls).toHaveLength(0);
});
test.each([{ origin: 'https://evil.test' }, { origin: '' }, { 'x-session-request': '0' }])(
  'mutation rejects CSRF %# before upstream',
  async (headers) => {
    expect(
      (await createJourneyHandler({ baseUrl })(req('/quotes', 'POST', quoteInput, headers))).status,
    ).toBe(403);
    expect(calls).toHaveLength(0);
  },
);
test('configured public origin ignores forwarded host spoof', async () => {
  const handler = createJourneyHandler({ baseUrl, origin: 'https://public.test' });
  const options = {
    method: 'POST',
    headers: { origin: 'https://public.test', 'x-session-request': '1', 'idempotency-key': key },
    body: JSON.stringify(quoteInput),
  };
  status = 201;
  payload = quote;
  expect(
    (await handler(new Request('http://internal:3001/api/session/journey/quotes', options))).status,
  ).toBe(201);
  expect(
    (await handler(req('/quotes', 'POST', quoteInput, { 'x-forwarded-host': 'public.test' })))
      .status,
  ).toBe(403);
  expect(calls).toHaveLength(1);
});
test.each([
  {},
  { ...quoteInput, total: 1 },
  { ...quoteInput, children: 1, childAges: [] },
  { ...quoteInput, channelCode: 'INVALID' },
])('malformed/priceinjection quote %# rejected', async (body) => {
  expect((await createJourneyHandler({ baseUrl })(req('/quotes', 'POST', body))).status).toBe(400);
  expect(calls).toHaveLength(0);
});
test.each(['', 'not-uuid', '123e4567-e89b-12d3-a456-426614174079'])(
  'write does not invent key for invalid key %s',
  async (value) => {
    expect(
      (
        await createJourneyHandler({ baseUrl })(
          req('/quotes', 'POST', quoteInput, { 'idempotency-key': value }),
        )
      ).status,
    ).toBe(400);
    expect(calls).toHaveLength(0);
  },
);
test('query duplicates and malformeddates rejected before upstream', async () => {
  for (const path of [
    '/inventory/availability?' + query + '&adults=3',
    '/inventory/availability?' + query.replace('2026-10-11', '2026-10-09'),
    '/rate-plans?secret=private',
  ])
    expect((await createJourneyHandler({ baseUrl })(req(path))).status).toBe(400);
  expect(calls).toHaveLength(0);
});
test('bounded malformed/oversized request and missing body are validation errors', async () => {
  for (const body of ['{', 'x'.repeat(16385), undefined]) {
    const response = await createJourneyHandler({ baseUrl })(
      new Request('https://guest.test/api/session/journey/quotes', {
        method: 'POST',
        headers: { origin: 'https://guest.test', 'x-session-request': '1', 'idempotency-key': key },
        ...(body === undefined ? {} : { body }),
      }),
    );
    expect(response.status).toBe(400);
  }
  expect(calls).toHaveLength(0);
});
test.each([
  [401, 'E_AUTH_INVALID_CREDENTIALS'],
  [409, 'E_INV_ROOM_TAKEN'],
  [410, 'E_RATE_QUOTE_EXPIRED'],
  [429, 'E_GEN_RATE_LIMITED'],
  [503, 'E_NEW_UNKNOWN'],
] as const)('upstream%i sanitized, same key and no BFF retry', async (code, errorCode) => {
  status = code;
  payload = {
    code: errorCode,
    message: 'private-password-refresh-token',
    traceId: 'upstream',
    timestamp: '2026-10-07T00:00:00.000Z',
    path: '/holds',
    details: [{ field: 'safe', issue: 'private-payload' }],
    retryAfterSeconds: 42,
  };
  const response = await createJourneyHandler({ baseUrl })(
    req('/holds', 'POST', holdInput, { authorization: 'Bearer synthetic-guest-access' }),
  );
  expect(response.status).toBe(code);
  expect(response.headers.get('retry-after')).toBe('42');
  const body: unknown = await response.json();
  expect(body).toMatchObject({
    code: errorCode === 'E_NEW_UNKNOWN' ? 'E_GEN_SERVICE_UNAVAILABLE' : errorCode,
    retryAfterSeconds: 42,
  });
  expect(JSON.stringify(body)).not.toContain('private');
  expect(calls).toHaveLength(1);
  expect(response.headers.get('set-cookie')).toBeNull();
});
test('malformed successful upstream body is502 without private data', async () => {
  payload = { refreshToken: 'private-upstream-secret' };
  const response = await createJourneyHandler({ baseUrl })(req('/inventory/availability?' + query));
  expect(response.status).toBe(502);
  expect(await response.text()).not.toContain('private-upstream-secret');
});
test('network failure returns502 sanitized', async () => {
  const response = await createJourneyHandler({ baseUrl: 'http://127.0.0.1:1/api/v1' })(
    req('/inventory/availability?' + query),
  );
  expect(response.status).toBe(502);
});
test('booking get/release hold encode ID and require access', async () => {
  payload = booking;
  const handler = createJourneyHandler({ baseUrl });
  expect(
    (
      await handler(
        req('/bookings/synthetic-booking', 'GET', undefined, {
          authorization: 'Bearer synthetic-guest-access',
        }),
      )
    ).status,
  ).toBe(200);
  status = 204;
  const response = await handler(
    req('/holds/synthetic-hold?reason=changed', 'DELETE', undefined, {
      authorization: 'Bearer synthetic-guest-access',
    }),
  );
  expect(response.status).toBe(204);
  expect(await response.text()).toBe('');
  expect(calls[1]?.path).toBe('/api/v1/holds/synthetic-hold?reason=changed');
});

test.each([307, 308])('never follows upstream %s into another write endpoint', async (code) => {
  redirectStatus = code;
  status = 201;
  payload = hold;
  const response = await createJourneyHandler({ baseUrl })(
    req('/holds', 'POST', holdInput, { authorization: 'Bearer synthetic-access' }),
  );
  expect(response.status).toBe(502);
  expect(calls).toHaveLength(1);
  expect(calls[0]?.path).toBe('/api/v1/holds');
  expect(response.headers.get('location')).toBeNull();
});
