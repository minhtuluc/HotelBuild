import { expect, test } from 'vitest';
import { housekeepingTaskSchema, listResponseSchema } from '@pinehill/contracts';
import { Session } from '../src/session';
import { memoryStorage } from '../src/storage';
const tokens = {
  tokenType: 'Bearer',
  accessToken: 'synthetic-access-aaaaaaaaaaaaaaaaaaaa',
  expiresInSeconds: 900,
  refreshToken: 'synthetic-refresh-bbbbbbbbbbbbbbbbbbb',
  refreshExpiresInSeconds: 604800,
};
function setup() {
  const calls: string[] = [];
  const session = new Session({
    storage: memoryStorage(),
    baseUrl: 'https://synthetic.test/api/v1',
    createId: () => '00000000-0000-4000-8000-000000000000',
    netInfo: { getConnected: async () => true },
    fetchImpl: async (input) => {
      const path = new URL(String(input)).pathname;
      calls.push(path);
      if (path.endsWith('/login')) return Response.json(tokens);
      if (path.endsWith('/logout')) return new Response(null, { status: 204 });
      return Response.json(
        {
          code: 'E_AUTH_TOKEN_EXPIRED',
          message: 'Synthetic',
          traceId: 'synthetic',
          timestamp: '2026-11-01T00:00:00Z',
          path,
        },
        { status: 401 },
      );
    },
  });
  return { session, calls };
}
test('resource GET401 is one attempt, without automatic auth refresh or replay', async () => {
  const s = setup();
  await s.session.login('synthetic', 'Synthetic-password');
  const client = s.session.resourceClient();
  await expect(
    client.request({
      method: 'GET',
      path: '/housekeeping/tasks',
      decoder: listResponseSchema(housekeepingTaskSchema),
    }),
  ).rejects.toMatchObject({ status: 401 });
  expect(s.calls).toEqual(['/api/v1/auth/login', '/api/v1/housekeeping/tasks']);
});
test('property selection/logout signals clear private views and invalidates already pinned clients', async () => {
  const s = setup();
  await s.session.login('synthetic', 'Synthetic-password');
  let changes = 0;
  const unsubscribe = s.session.subscribe(() => {
    changes++;
  });
  const client = s.session.resourceClient();
  s.session.selectProperty('p1');
  await s.session.logout();
  expect(changes).toBe(2);
  // ApiClient normalizes header-provider failures as network; the security oracle is no transport call.
  await expect(
    client.request({
      method: 'GET',
      path: '/housekeeping/tasks',
      decoder: listResponseSchema(housekeepingTaskSchema),
    }),
  ).rejects.toMatchObject({ kind: 'network' });
  expect(s.calls.filter((path) => path.endsWith('/housekeeping/tasks'))).toEqual([]);
  unsubscribe();
});
