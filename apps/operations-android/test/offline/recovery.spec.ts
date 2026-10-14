import { expect, test } from 'vitest';
import { OfflineQueue } from '../../src/offline/queue';
import { action, context, fixture, key, storedKey } from './fixture';

test('failed restore clears a previous private in-memory snapshot', async () => {
  const f = fixture();
  await f.queue.draft(action);
  await f.storage.set(storedKey, 'corrupt');
  await expect(f.queue.restore()).rejects.toMatchObject({ code: 'CORRUPT_STORAGE' });
  expect(f.queue.snapshot()).toEqual([]);
});

test('restart of an explicitly retried but unacknowledged request requires another explicit decision', async () => {
  const f = fixture();
  await f.storage.set(
    storedKey,
    JSON.stringify([
      {
        key,
        context,
        action,
        createdAt: 1000,
        phase: 'QUEUED',
        attempted: true,
        lastAttemptAt: 1000,
        reason: null,
      },
    ]),
  );
  await f.queue.restore();
  await f.queue.sync();
  expect(f.queue.snapshot()[0]).toMatchObject({ phase: 'NEEDS_REVIEW', reason: 'UNKNOWN_RESULT' });
  expect(f.sent).toEqual([]);
});

test('an expired SENDING record after restart still performs lookup without dispatch', async () => {
  let lookups = 0;
  const f = fixture({
    lookup: async () => {
      lookups++;
      return { status: 'NOT_FOUND' };
    },
  });
  await f.storage.set(
    storedKey,
    JSON.stringify([
      {
        key,
        context,
        action,
        createdAt: 1000,
        phase: 'SENDING',
        attempted: true,
        lastAttemptAt: 1000,
        reason: null,
      },
    ]),
  );
  f.clock.value += 86_400_000;
  await f.queue.restore();
  await f.queue.sync();
  expect(lookups).toBe(1);
  expect(f.sent).toEqual([]);
  expect(f.queue.snapshot()[0]?.reason).toBe('LOOKUP_REQUIRED');
});

test('an unresolved task cannot acquire a second independent key even with a new desired status', async () => {
  const f = fixture();
  await f.queue.draft(action);
  await expect(f.queue.draft({ ...action, status: 'DONE' })).rejects.toMatchObject({
    code: 'PENDING_TASK',
  });
  expect(f.queue.snapshot()).toHaveLength(1);
});

test('business UUIDs need not be version4 even though fresh idempotency keys are version4', async () => {
  const f = fixture({ context: { ...context, userId: '11111111-1111-7111-8111-111111111111' } });
  await f.queue.draft({ ...action, taskId: '33333333-3333-7333-8333-333333333333' });
  expect(f.queue.snapshot()[0]?.phase).toBe('DRAFT');
});

test('corrupt attempted drafts cannot be revived into new unattempted requests', async () => {
  const f = fixture();
  const raw = JSON.stringify([
    {
      key,
      context,
      action,
      createdAt: 1000,
      phase: 'DRAFT',
      attempted: true,
      lastAttemptAt: 1000,
      reason: null,
    },
  ]);
  await f.storage.set(storedKey, raw);
  await expect(f.queue.restore()).rejects.toMatchObject({ code: 'CORRUPT_STORAGE' });
  expect(await f.storage.get(storedKey)).toBe(raw);
});

test('queue capacity rejects the next draft without dropping the32 existing records', async () => {
  const f = fixture();
  for (let n = 0; n < 32; n++) await f.queue.draft({ kind: 'NOTE_DRAFT', text: String(n) });
  await expect(f.queue.draft({ kind: 'NOTE_DRAFT', text: 'excess' })).rejects.toMatchObject({
    code: 'QUEUE_FULL',
  });
  expect(f.queue.snapshot()).toHaveLength(32);
  const reopened = new OfflineQueue(f.deps);
  await reopened.restore();
  expect(reopened.snapshot()).toHaveLength(32);
});

test('post-commit acknowledgement storage failure preserves uncertainty across restart', async () => {
  const f = fixture();
  await f.queue.draft(action);
  await f.queue.enqueue(key);
  const original = f.storage.set;
  f.storage.set = async (key, value) => {
    if (value.includes('CONFIRMED')) throw Error('storage failure');
    await original(key, value);
  };
  await expect(f.queue.sync()).rejects.toMatchObject({ code: 'STORAGE' });
  expect(f.sent).toHaveLength(1);
  f.storage.set = original;
  const restarted = new OfflineQueue(f.deps);
  await restarted.restore();
  expect(restarted.snapshot()[0]).toMatchObject({
    key,
    action,
    phase: 'NEEDS_REVIEW',
    reason: 'UNKNOWN_RESULT',
  });
  await restarted.sync();
  expect(f.sent).toHaveLength(1);
});

test('a sender cannot replace concurrent stored data after receiving a response', async () => {
  const f = fixture({
    send: async () => {
      await f.storage.set(storedKey, 'changed externally');
      return { key, context, action, status: 'CONFIRMED' };
    },
  });
  await f.queue.draft(action);
  await f.queue.enqueue(key);
  await expect(f.queue.sync()).rejects.toMatchObject({ code: 'STORAGE_CHANGED' });
  expect(await f.storage.get(storedKey)).toBe('changed externally');
});

test('session revision callback disposes the queue and blocks all later transport', async () => {
  let revision = () => {};
  let unsubscribed = false;
  const f = fixture({
    watch: (listener) => {
      revision = listener;
      return () => {
        unsubscribed = true;
      };
    },
  });
  await f.queue.draft(action);
  await f.queue.enqueue(key);
  revision();
  expect(f.queue.snapshot()).toEqual([]);
  await expect(f.queue.sync()).rejects.toMatchObject({ code: 'CONTEXT_CHANGED' });
  expect(f.sent).toEqual([]);
  expect(unsubscribed).toBe(true);
});

test('a storage port that reports success without writing is detected before sending', async () => {
  const f = fixture({
    storage: { get: async () => null, set: async () => undefined, remove: async () => undefined },
  });
  await expect(f.queue.draft(action)).rejects.toMatchObject({ code: 'STORAGE' });
  expect(f.queue.snapshot()).toEqual([]);
  expect(f.sent).toEqual([]);
});

test('starting a new draft releases only confirmed queue receipts, never unresolved work', async () => {
  const f = fixture();
  await f.queue.draft(action);
  await f.queue.enqueue(key);
  await f.queue.sync();
  await f.queue.draft({ kind: 'NOTE_DRAFT', text: 'keep me' });
  expect(f.queue.snapshot()).toHaveLength(1);
  await f.queue.draft({ kind: 'SEARCH_DRAFT', query: 'PH-FIXTURE' });
  expect(f.queue.snapshot()).toHaveLength(2);
  expect(f.queue.snapshot().every((entry) => entry.phase === 'DRAFT')).toBe(true);
});

test('enqueue and retry of an unknown key do not silently claim to queue a command', async () => {
  const f = fixture();
  await expect(f.queue.enqueue(key)).rejects.toMatchObject({ code: 'NOT_FOUND' });
  await expect(f.queue.retry(key)).rejects.toMatchObject({ code: 'NOT_FOUND' });
  expect(f.sent).toEqual([]);
});

test('the published reservation-agent staff role can persist a local note draft', async () => {
  const f = fixture({ context: { ...context, role: 'RESERVATION_AGENT' } });
  await f.queue.draft({ kind: 'NOTE_DRAFT', text: 'fixture reservation note' });
  expect(f.queue.snapshot()[0]).toMatchObject({
    context: { role: 'RESERVATION_AGENT' },
    action: { kind: 'NOTE_DRAFT', text: 'fixture reservation note' },
    phase: 'DRAFT',
  });
});
