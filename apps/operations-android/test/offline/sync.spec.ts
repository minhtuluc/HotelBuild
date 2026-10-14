import { ApiError } from '@pinehill/api-client';
import { expect, test, vi } from 'vitest';
import { OfflineQueue } from '../../src/offline/queue';
import type { QueueEntry } from '../../src/offline/types';
import { action, context, fixture, key, storedKey } from './fixture';

const receipt = { key, context, action, status: 'CONFIRMED' };
async function queued(f: ReturnType<typeof fixture>) {
  await f.queue.draft(action);
  await f.queue.enqueue(key);
}

test('only a matching server acknowledgement confirms an intent; it was durable SENDING before dispatch', async () => {
  let during: unknown;
  const f = fixture({
    send: async () => {
      const raw = await f.storage.get(storedKey);
      during = raw === null ? null : JSON.parse(raw);
      return receipt;
    },
  });
  await queued(f);
  await f.queue.sync();
  expect(during).toEqual([
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
  ]);
  expect(f.queue.snapshot()[0]).toMatchObject({ key, action, phase: 'CONFIRMED', attempted: true });
  const restarted = new OfflineQueue(f.deps);
  await restarted.restore();
  expect(restarted.snapshot()[0]?.phase).toBe('CONFIRMED');
});

test('a network failure retains the original immutable request for explicit same-key retry', async () => {
  const sent: QueueEntry[] = [];
  const f = fixture({
    send: async (entry) => {
      sent.push(entry);
      if (sent.length === 1) throw Error('network failure');
      return receipt;
    },
  });
  await queued(f);
  await f.queue.sync();
  expect(f.queue.snapshot()[0]).toMatchObject({
    phase: 'NEEDS_REVIEW',
    reason: 'UNKNOWN_RESULT',
    attempted: true,
  });
  await f.queue.sync();
  expect(sent).toHaveLength(1);
  await f.queue.retry(key);
  await f.queue.sync();
  expect(
    sent.map((entry) => ({ key: entry.key, action: entry.action, context: entry.context })),
  ).toEqual([
    { key, action, context },
    { key, action, context },
  ]);
  expect(f.queue.snapshot()[0]?.phase).toBe('CONFIRMED');
});

test.each([
  { ...receipt, key: action.taskId },
  { ...receipt, action: { ...action, version: 8 } },
  { ...receipt, context: { ...context, userId: action.taskId } },
  { ...receipt, status: 'PENDING' },
  { ...receipt, pinToken: 'do-not-persist' },
  null,
])('malformed or mismatched receipt is not success: %#', async (result) => {
  const f = fixture({ send: async () => result });
  await queued(f);
  await f.queue.sync();
  expect(f.queue.snapshot()[0]).toMatchObject({ phase: 'NEEDS_REVIEW', reason: 'UNKNOWN_RESULT' });
});

test.each([412, 428])(
  'HTTP %i requires user resolution and never overwrites the version',
  async (status) => {
    const f = fixture({
      send: async () => {
        throw new ApiError({
          kind: 'http',
          status,
          code: status === 412 ? 'E_GEN_VERSION_CONFLICT' : 'E_GEN_PRECONDITION_REQUIRED',
          message: 'fixture',
        });
      },
    });
    await queued(f);
    await f.queue.sync();
    expect(f.queue.snapshot()[0]).toMatchObject({
      action,
      phase: 'NEEDS_REVIEW',
      reason: 'CONFLICT',
    });
    await expect(f.queue.retry(key)).rejects.toMatchObject({ code: 'REVIEW_REQUIRED' });
    const restarted = new OfflineQueue(f.deps);
    await restarted.restore();
    expect(restarted.snapshot()[0]?.reason).toBe('CONFLICT');
  },
);

test.each([86_400_000, 86_400_001])(
  'at age %ims lookup precedes any action and no new request/key is sent',
  async (age) => {
    let lookups = 0;
    const f = fixture({
      lookup: async (entry) => {
        lookups++;
        expect(entry).toMatchObject({ key, action });
        return { status: 'NOT_FOUND' };
      },
    });
    await queued(f);
    f.clock.value = 1000 + age;
    await f.queue.sync();
    expect(lookups).toBe(1);
    expect(f.sent).toEqual([]);
    expect(f.queue.snapshot()[0]).toMatchObject({
      key,
      action,
      phase: 'NEEDS_REVIEW',
      reason: 'LOOKUP_REQUIRED',
    });
  },
);

test('just before24h a matching write acknowledgement is accepted', async () => {
  const f = fixture();
  await queued(f);
  f.clock.value = 1000 + 86_399_999;
  await f.queue.sync();
  expect(f.sent).toHaveLength(1);
  expect(f.queue.snapshot()[0]?.phase).toBe('CONFIRMED');
});

test('expired record may be confirmed only by a bound durable receipt from lookup', async () => {
  const f = fixture({ lookup: async () => receipt });
  await queued(f);
  f.clock.value += 86_400_000;
  await f.queue.sync();
  expect(f.sent).toEqual([]);
  expect(f.queue.snapshot()[0]?.phase).toBe('CONFIRMED');
});

test('missing lookup or clock rollback blocks dispatch and retains the record', async () => {
  const f = fixture();
  await queued(f);
  f.clock.value = 999;
  await f.queue.sync();
  expect(f.queue.snapshot()[0]).toMatchObject({ phase: 'NEEDS_REVIEW', reason: 'LOOKUP_REQUIRED' });
  expect(f.sent).toEqual([]);
  await expect(f.queue.retry(key)).rejects.toMatchObject({ code: 'REVIEW_REQUIRED' });
});

test('restart never converts a possibly committed SENDING intent into a new draft or an automatic send', async () => {
  const f = fixture();
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
  await f.queue.restore();
  await f.queue.sync();
  expect(f.queue.snapshot()[0]).toMatchObject({
    key,
    phase: 'NEEDS_REVIEW',
    reason: 'UNKNOWN_RESULT',
  });
  expect(f.sent).toEqual([]);
  await expect(f.queue.discard(key)).rejects.toMatchObject({ code: 'ALREADY_SENT' });
});

test('fresh authorization is required before every queued dispatch and after a response', async () => {
  let checks = 0;
  const f = fixture({
    authorize: async () => {
      checks++;
      return checks === 1 ? context : { ...context, role: 'FRONT_DESK' };
    },
  });
  await queued(f);
  await f.queue.sync();
  expect(checks).toBe(2);
  expect(f.queue.snapshot()).toEqual([]);
  const raw = await f.storage.get(storedKey);
  expect(raw).toContain('AUTHORIZATION');
  expect(raw).not.toContain('CONFIRMED');
});

test('a changed principal or scope before send reveals no private view and sends nothing', async () => {
  const f = fixture({ authorize: async () => ({ ...context, propertyScope: [] }) });
  await queued(f);
  await f.queue.sync();
  expect(f.sent).toEqual([]);
  expect(f.queue.snapshot()).toEqual([]);
  expect(await f.storage.get(storedKey)).toContain('AUTHORIZATION');
});

test('parallel syncs serialize delivery instead of dispatching the same queued intent twice', async () => {
  const f = fixture();
  await queued(f);
  const second = new OfflineQueue(f.deps);
  await Promise.all([f.queue.sync(), second.sync()]);
  expect(f.sent).toHaveLength(1);
  await second.restore();
  expect(second.snapshot()[0]?.phase).toBe('CONFIRMED');
});

test('a failure to persist SENDING prevents the network side effect', async () => {
  const f = fixture();
  await queued(f);
  const original = f.storage.set;
  f.storage.set = async () => {
    throw Error('storage failure');
  };
  await expect(f.queue.sync()).rejects.toMatchObject({ code: 'STORAGE' });
  expect(f.sent).toEqual([]);
  f.storage.set = original;
  await f.queue.restore();
  expect(f.queue.snapshot()[0]?.phase).toBe('QUEUED');
});

test('session disposal aborts in-flight work, clears RAM and cannot accept a late acknowledgement', async () => {
  const delayed = Promise.withResolvers<unknown>();
  let signal: AbortSignal | undefined;
  const f = fixture({
    send: async (_entry, received) => {
      signal = received;
      return delayed.promise;
    },
  });
  await queued(f);
  const work = f.queue.sync();
  await vi.waitFor(() => expect(signal).toBeDefined());
  f.queue.dispose();
  expect(signal?.aborted).toBe(true);
  delayed.resolve(receipt);
  await work;
  expect(f.queue.snapshot()).toEqual([]);
  expect(await f.storage.get(storedKey)).not.toContain('CONFIRMED');
});

test('transport cannot mutate the persisted intent or manufacture a matching receipt by doing so', async () => {
  const f = fixture({
    send: async (entry) => {
      Object.assign(entry.action, { version: 99 });
      return { ...receipt, action: entry.action };
    },
  });
  await queued(f);
  await f.queue.sync();
  expect(f.queue.snapshot()[0]).toMatchObject({ action, phase: 'NEEDS_REVIEW' });
});
