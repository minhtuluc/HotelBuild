import { expect, test } from 'vitest';
import { action, context, fixture, key, storedKey } from './fixture';

test('rollback after a previous late attempt cannot extend the retry window', async () => {
  const f = fixture({
    send: async () => {
      throw Error('network failure');
    },
  });
  await f.queue.draft(action);
  await f.queue.enqueue(key);
  f.clock.value = 1000 + 23 * 3_600_000;
  await f.queue.sync();
  expect(f.queue.snapshot()[0]?.reason).toBe('UNKNOWN_RESULT');
  f.clock.value = 1000 + 22 * 3_600_000;
  await expect(f.queue.retry(key)).rejects.toMatchObject({ code: 'REVIEW_REQUIRED' });
  await f.queue.sync();
  expect(f.queue.snapshot()[0]?.reason).toBe('LOOKUP_REQUIRED');
});

test('crossing24h during durable SENDING persistence performs lookup, never a late send', async () => {
  const f = fixture({ lookup: async () => ({ status: 'NOT_FOUND' }) });
  await f.queue.draft(action);
  await f.queue.enqueue(key);
  f.clock.value += 86_399_999;
  const original = f.storage.set;
  f.storage.set = async (key, value) => {
    await original(key, value);
    if (value.includes('SENDING')) f.clock.value += 2;
  };
  await f.queue.sync();
  expect(f.sent).toEqual([]);
  expect(f.queue.snapshot()[0]?.reason).toBe('LOOKUP_REQUIRED');
});

test('a delayed dispatch cannot overwrite receipt identity when the local clock changes', async () => {
  const f = fixture({
    send: async () => {
      f.clock.value += 86_400_000;
      return { key, context, action, status: 'CONFIRMED' };
    },
  });
  await f.queue.draft(action);
  await f.queue.enqueue(key);
  await f.queue.sync();
  expect(f.queue.snapshot()[0]?.phase).toBe('CONFIRMED');
  expect(await f.storage.get(storedKey)).toContain('CONFIRMED');
});
