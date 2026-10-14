import { beforeEach, expect, test, vi } from 'vitest';
import { setup } from '../task-write-fixture';
import { createOfflineQueue } from '../../src/offline/factory.native';

const native = vi.hoisted(() => ({
  values: new Map<string, string>(),
  online: false,
  fail: false,
}));
vi.mock('expo-secure-store', () => ({
  getItemAsync: async (key: string) => native.values.get(key) ?? null,
  setItemAsync: async (key: string, value: string) => {
    if (native.fail) throw Error('native secure storage unavailable');
    native.values.set(key, value);
  },
  deleteItemAsync: async (key: string) => {
    native.values.delete(key);
  },
}));
vi.mock('expo-crypto', () => ({ randomUUID: () => '55555555-5555-4555-8555-555555555555' }));
vi.mock('@react-native-community/netinfo', () => ({
  default: { fetch: async () => ({ isConnected: native.online }) },
}));
beforeEach(() => {
  native.values.clear();
  native.online = false;
  native.fail = false;
});

test('native factory uses the secure-storage boundary and restores drafts without persisting session credentials', async () => {
  const f = await setup();
  const queue = createOfflineQueue(f.session, f.actor);
  const reopened = createOfflineQueue(f.session, f.actor);
  try {
    await queue.draft({ kind: 'NOTE_DRAFT', text: 'fixture note' });
    await reopened.restore();
    expect(reopened.snapshot()[0]?.phase).toBe('DRAFT');
    expect(native.values.size).toBe(1);
    expect([...native.values.keys()][0]).toMatch(/^offline\.queue\./);
    expect([...native.values.values()][0]).not.toMatch(
      /accessToken|refreshToken|pinToken|password|synthetic-access|synthetic-refresh/,
    );
    f.session.selectProperty('changed');
    expect(queue.snapshot()).toEqual([]);
    expect(reopened.snapshot()).toEqual([]);
  } finally {
    queue.dispose();
    reopened.dispose();
    f.writer.dispose();
  }
});

test('native storage failure never silently falls back to memory or plaintext disk', async () => {
  const f = await setup();
  const queue = createOfflineQueue(f.session, f.actor);
  try {
    native.fail = true;
    await expect(queue.draft({ kind: 'NOTE_DRAFT', text: 'fixture note' })).rejects.toMatchObject({
      code: 'STORAGE',
    });
    expect(queue.snapshot()).toEqual([]);
    expect(native.values.size).toBe(0);
    expect(f.s.writes).toEqual([]);
  } finally {
    queue.dispose();
    f.writer.dispose();
  }
});

test('native NetInfo prevents offline dispatch even when the cached session remains signed in', async () => {
  const f = await setup();
  const queue = createOfflineQueue(f.session, f.actor);
  try {
    await queue.draft({ kind: 'NOTE_DRAFT', text: 'fixture note' });
    const entry = queue.snapshot()[0];
    expect(entry).toBeDefined();
    if (!entry) throw Error('Missing queue entry');
    await queue.enqueue(entry.key);
    await queue.sync();
    expect(queue.snapshot()[0]?.phase).toBe('QUEUED');
    expect(f.s.writes).toEqual([]);
  } finally {
    queue.dispose();
    f.writer.dispose();
  }
});
