import { expect, test } from 'vitest';
import { Session } from '../../src/session';
import { memoryStorage } from '../../src/storage';
import { OfflineQueue } from '../../src/offline/queue';
import { offlinePorts } from '../../src/offline/ports';
import { action, context, key } from './fixture';

async function dispatchFixture(delayAt: 'claim' | 'credentials', advance: number) {
  const storage = memoryStorage();
  let now = 1000;
  let claimed = false;
  const patches: string[] = [];
  const session = new Session({
    storage: memoryStorage(),
    baseUrl: 'https://synthetic.test/api/v1',
    createId: () => key,
    netInfo: {
      getConnected: async () => {
        if (claimed && delayAt === 'credentials') now += advance;
        return true;
      },
    },
    fetchImpl: async (input, init) => {
      const path = new URL(String(input)).pathname;
      if (path.endsWith('/login'))
        return Response.json({
          tokenType: 'Bearer',
          accessToken: 'synthetic-access-aaaaaaaaaaaaaaaaaaaa',
          expiresInSeconds: 900,
          refreshToken: 'synthetic-refresh-bbbbbbbbbbbbbbbbbbb',
          refreshExpiresInSeconds: 604800,
        });
      if (path.endsWith('/auth/me'))
        return Response.json({
          ...context,
          username: 'synthetic',
          fullName: 'Synthetic',
          hasPin: true,
          mustChangePassword: false,
        });
      patches.push(String(init?.body));
      return Response.json({ unexpected: true });
    },
  });
  await session.login('synthetic', 'Synthetic-password');
  session.selectProperty(context.propertyId);
  const original = storage.set;
  storage.set = async (name, value) => {
    await original(name, value);
    if (name.startsWith('housekeeping.pending.')) {
      claimed = true;
      if (delayAt === 'claim') now += advance;
    }
  };
  const queue = new OfflineQueue({
    ...offlinePorts(session, storage, () => now),
    context,
    storage,
    now: () => now,
    online: async () => true,
    createId: () => key,
  });
  await queue.draft(action);
  await queue.enqueue(key);
  now += 86_399_999;
  return { queue, storage, patches };
}

test.each(['claim', 'credentials'] as const)(
  'crossing24h during %s prevents the real ApiClient from dispatching PATCH',
  async (delayAt) => {
    const f = await dispatchFixture(delayAt, 2);
    try {
      await f.queue.sync();
      expect(f.patches).toEqual([]);
      expect(f.queue.snapshot()[0]).toMatchObject({
        key,
        action,
        phase: 'NEEDS_REVIEW',
        reason: 'LOOKUP_REQUIRED',
      });
      expect(await f.storage.get('housekeeping.pending.' + context.userId)).toContain(key);
      await expect(f.queue.retry(key)).rejects.toMatchObject({ code: 'REVIEW_REQUIRED' });
    } finally {
      f.queue.dispose();
    }
  },
);
