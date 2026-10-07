import { expect, test } from 'vitest';
import { ApiClient } from '../src/client.js';

const unauthorized = () =>
  Response.json(
    {
      code: 'E_AUTH_INVALID_CREDENTIALS',
      message: 'Expired',
      traceId: 'synthetic',
      timestamp: '2026-10-07T00:00:00.000Z',
      path: '/api/v1/protected',
    },
    { status: 401 },
  );
test('401 hook receives the token actually sent even if another request already rotated it', async () => {
  let token = 'synthetic-old-token-0001';
  const rejected: (string | undefined)[] = [];
  const client = new ApiClient({
    baseUrl: 'https://api.test/api/v1',
    getAccessToken: () => token,
    onUnauthorized: async (used) => {
      rejected.push(used);
      return true;
    },
    fetchImpl: async (_url, init) => {
      const sent = new Headers(init?.headers).get('authorization');
      if (sent === 'Bearer synthetic-old-token-0001') {
        token = 'synthetic-new-token-0002';
        return unauthorized();
      }
      return Response.json({ ok: true });
    },
  });
  await client.request({ method: 'GET', path: '/protected', decoder: { parse: () => true } });
  expect(rejected).toEqual(['synthetic-old-token-0001']);
});
test('an anonymous request that receives 401 never refreshes a subsequently created session', async () => {
  let token: string | null = null;
  let hooks = 0;
  const client = new ApiClient({
    baseUrl: 'https://api.test/api/v1',
    getAccessToken: () => token,
    onUnauthorized: async () => {
      hooks++;
      return true;
    },
    fetchImpl: async () => {
      token = 'synthetic-new-token-0002';
      return unauthorized();
    },
  });
  await expect(
    client.request({ method: 'GET', path: '/protected', decoder: { parse: () => true } }),
  ).rejects.toMatchObject({ status: 401 });
  expect(hooks).toBe(0);
});
