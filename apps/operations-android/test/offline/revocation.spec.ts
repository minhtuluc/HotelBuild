import { expect, test } from 'vitest';
import { action, context, fixture, key, storedKey } from './fixture';

test.each(['write', 'readback'])(
  'authorization revocation clears private RAM even when the review %s fails',
  async (fault) => {
    let subscribed = true;
    const f = fixture({
      authorize: async () => ({ ...context, propertyScope: [] }),
      watch: () => () => {
        subscribed = false;
      },
    });
    await f.queue.draft(action);
    await f.queue.enqueue(key);
    const before = await f.storage.get(storedKey);
    const original = f.storage.set;
    f.storage.set = async (name, value) => {
      if (value.includes('AUTHORIZATION')) {
        if (fault === 'write') throw Error('storage unavailable');
        return;
      }
      await original(name, value);
    };
    await expect(f.queue.sync()).rejects.toMatchObject({ code: 'STORAGE' });
    expect(f.queue.snapshot()).toEqual([]);
    expect(subscribed).toBe(false);
    expect(f.sent).toEqual([]);
    expect(await f.storage.get(storedKey)).toBe(before);
    await expect(f.queue.restore()).rejects.toMatchObject({ code: 'CONTEXT_CHANGED' });
  },
);

test('post-send revocation aborts the queue despite an authorization-record write failure', async () => {
  let checks = 0;
  let transportSignal: AbortSignal | undefined;
  const f = fixture({
    authorize: async () => (++checks === 1 ? context : { ...context, role: 'FRONT_DESK' }),
    send: async (entry, signal) => {
      transportSignal = signal;
      return { key: entry.key, context: entry.context, action: entry.action, status: 'CONFIRMED' };
    },
  });
  await f.queue.draft(action);
  await f.queue.enqueue(key);
  const original = f.storage.set;
  f.storage.set = async (name, value) => {
    if (value.includes('AUTHORIZATION')) throw Error('storage unavailable');
    await original(name, value);
  };
  await expect(f.queue.sync()).rejects.toMatchObject({ code: 'STORAGE' });
  expect(f.queue.snapshot()).toEqual([]);
  expect(transportSignal?.aborted).toBe(true);
  expect(await f.storage.get(storedKey)).toContain('SENDING');
  expect(await f.storage.get(storedKey)).not.toContain('CONFIRMED');
});
