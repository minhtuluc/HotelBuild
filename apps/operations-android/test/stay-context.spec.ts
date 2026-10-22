import { expect, test, vi } from 'vitest';
import { Session } from '../src/session';
import { memoryStorage } from '../src/storage';
import { watchContext } from '../src/stay/context';

const tokens = {
  tokenType: 'Bearer',
  accessToken: 'synthetic-access-aaaaaaaaaaaaaaaaaaaa',
  expiresInSeconds: 900,
  refreshToken: 'synthetic-refresh-bbbbbbbbbbbbbbbbbbb',
  refreshExpiresInSeconds: 604800,
};

function setup() {
  const session = new Session({
    storage: memoryStorage(),
    baseUrl: 'https://synthetic.test/api/v1',
    createId: () => '00000000-0000-4000-8000-000000000000',
    netInfo: { getConnected: async () => true },
    fetchImpl: async (input) => {
      const path = new URL(String(input)).pathname;
      if (path.endsWith('/logout')) return new Response(null, { status: 204 });
      return Response.json(tokens);
    },
  });
  return session;
}

test('a silent token refresh is not a context change; property switch and logout are', async () => {
  const session = setup();
  await session.login('synthetic', 'Synthetic-password');
  session.selectProperty('p1');
  const changed = vi.fn();
  const stop = watchContext(session, changed);
  await session.silentRefresh();
  expect(changed).not.toHaveBeenCalled();
  session.selectProperty('p1');
  expect(changed).not.toHaveBeenCalled();
  session.selectProperty('p2');
  expect(changed).toHaveBeenCalledTimes(1);
  await session.logout();
  expect(changed).toHaveBeenCalledTimes(2);
  stop();
  await session.login('synthetic', 'Synthetic-password');
  expect(changed).toHaveBeenCalledTimes(2);
});
