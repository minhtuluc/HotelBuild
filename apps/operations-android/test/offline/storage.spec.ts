import { expect, test } from 'vitest';
import { OfflineQueue } from '../../src/offline/queue';
import { action, context, fixture, key, storedKey } from './fixture';

test('draft survives restart with the original key, version and payload and never sends', async () => {
  const f = fixture();
  await f.queue.draft(action);
  expect(f.queue.snapshot()).toEqual([
    {
      key,
      context,
      action,
      createdAt: 1000,
      phase: 'DRAFT',
      attempted: false,
      lastAttemptAt: null,
      reason: null,
    },
  ]);
  const restarted = new OfflineQueue(f.deps);
  await restarted.restore();
  expect(restarted.snapshot()).toEqual(f.queue.snapshot());
  expect(f.sent).toEqual([]);
});

test.each(['NOTE_DRAFT', 'SEARCH_DRAFT'] as const)(
  '%s is a local draft, never a success',
  async (kind) => {
    const f = fixture();
    await f.queue.draft(
      kind === 'NOTE_DRAFT' ? { kind, text: 'fixture note' } : { kind, query: 'PH-FIXTURE' },
    );
    expect(f.queue.snapshot()[0]?.phase).toBe('DRAFT');
    expect(f.sent).toEqual([]);
  },
);

test.each([
  'PAYMENT',
  'REFUND',
  'CHECK_IN',
  'CHECK_OUT',
  'ROOM_ASSIGN',
  'ROOM_MOVE',
  'BOOKING_CONFIRM',
  'NO_SHOW',
])('rejects %s before saving', async (kind) => {
  const f = fixture();
  await expect(f.queue.draft({ kind, bookingId: action.taskId })).rejects.toMatchObject({
    code: 'INVALID_ACTION',
  });
  expect(await f.storage.get(storedKey)).toBeNull();
});

test.each(['pin', 'pinToken', 'accessToken', 'refreshToken', 'authorization', 'url', 'method'])(
  'rejects undeclared %s instead of persisting a raw request',
  async (field) => {
    const f = fixture();
    await expect(f.queue.draft({ ...action, [field]: 'private-fixture' })).rejects.toMatchObject({
      code: 'INVALID_ACTION',
    });
    expect(await f.storage.get(storedKey)).toBeNull();
  },
);

test('a bad calendar date and an unsafe version cannot enter storage', async () => {
  const f = fixture();
  for (const invalid of [
    { ...action, businessDate: '2026-02-30' },
    { ...action, version: Number.MAX_SAFE_INTEGER },
  ])
    await expect(f.queue.draft(invalid)).rejects.toMatchObject({ code: 'INVALID_ACTION' });
  expect(f.queue.snapshot()).toEqual([]);
});

test('draft data is detached from caller mutations and snapshot mutations', async () => {
  const f = fixture();
  const input = { ...action };
  await f.queue.draft(input);
  Object.assign(input, { version: 99 });
  const visible = f.queue.snapshot();
  expect(visible).toHaveLength(1);
  Object.assign(visible[0]?.action ?? {}, { version: 88 });
  expect(f.queue.snapshot()[0]?.action).toEqual(action);
});

test('enqueue remains pending while offline, and an unsent intent can be discarded', async () => {
  const f = fixture({ online: async () => false });
  await f.queue.draft(action);
  await f.queue.enqueue(key);
  await f.queue.sync();
  expect(f.queue.snapshot()[0]?.phase).toBe('QUEUED');
  expect(f.sent).toEqual([]);
  await f.queue.discard(key);
  expect(f.queue.snapshot()).toEqual([]);
});

test('failed persistence does not expose a draft or send an unrecorded intent', async () => {
  const f = fixture({
    storage: {
      get: async () => null,
      set: async () => {
        throw Error('storage unavailable');
      },
      remove: async () => undefined,
    },
  });
  await expect(f.queue.draft(action)).rejects.toMatchObject({ code: 'STORAGE' });
  expect(f.queue.snapshot()).toEqual([]);
  expect(f.sent).toEqual([]);
});

test('corrupt or foreign-context storage is retained, never overwritten', async () => {
  const f = fixture();
  await f.storage.set(storedKey, '{broken');
  await expect(f.queue.restore()).rejects.toMatchObject({ code: 'CORRUPT_STORAGE' });
  expect(await f.storage.get(storedKey)).toBe('{broken');
  await expect(f.queue.draft(action)).rejects.toMatchObject({ code: 'CORRUPT_STORAGE' });
  expect(f.queue.snapshot()).toEqual([]);
});

test('another principal or changed role/scope cannot restore the old private queue', async () => {
  const f = fixture();
  await f.queue.draft(action);
  const changed = new OfflineQueue({ ...f.deps, context: { ...context, role: 'FRONT_DESK' } });
  await expect(changed.restore()).rejects.toMatchObject({ code: 'CONTEXT_CHANGED' });
  expect(changed.snapshot()).toEqual([]);
  const foreign = new OfflineQueue({ ...f.deps, context: { ...context, userId: action.roomId } });
  await foreign.restore();
  expect(foreign.snapshot()).toEqual([]);
});

test('two instances preserve both drafts instead of overwriting a stored queue', async () => {
  const f = fixture();
  const second = new OfflineQueue(f.deps);
  await Promise.all([
    f.queue.draft(action),
    second.draft({ kind: 'NOTE_DRAFT', text: 'another draft' }),
  ]);
  await f.queue.restore();
  expect(f.queue.snapshot()).toHaveLength(2);
});
