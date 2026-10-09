import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { test, expect } from 'vitest';
import { identifyRequest } from '../../src/common/idempotency/request.js';
import { IdempotencyStore } from '../../src/common/idempotency/store.js';
import { db, rows, clock, ids, count, userId } from './database.js';
const store = () => new IdempotencyStore(db, clock, ids);
const identity = () =>
  identifyRequest(
    { type: 'USER', id: userId },
    {
      method: 'POST',
      url: '/recovery',
      headers: { 'idempotency-key': randomUUID() },
      body: { increment: 1 },
    },
  );
const latch = () => {
  let release: () => void = () => {
    throw new Error('Latch not initialized');
  };
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { promise, release };
};
const effect = async (tx: Parameters<Parameters<IdempotencyStore['run']>[1]>[0]) => {
  await tx.$executeRaw`UPDATE system_settings SET value=(value::int+1)::text WHERE key='H029'`;
  return { status: 201, body: { once: true }, headers: {} };
};
test('business use cases inherit database lock policy after the idempotency fence', async () => {
  const claim = await store().claim(identity());
  if (claim.kind !== 'claim') throw new Error('Expected claim');
  await store().run(claim, async (tx) => {
    expect(await tx.$queryRaw<{ lock_timeout: string }[]>`SHOW lock_timeout`).toEqual([
      { lock_timeout: '0' },
    ]);
    return { status: 201, body: {}, headers: {} };
  });
});
test('expired lease takeover fences the previous owner and commits once', async () => {
  const input = identity(),
    old = await store().claim(input);
  if (old.kind !== 'claim') throw new Error('Expected fresh claim');
  clock.value += 30000;
  const next = await store().claim(input);
  if (next.kind !== 'claim') throw new Error('Expected takeover');
  expect(next.id).toBe(old.id);
  expect(next.token).not.toBe(old.token);
  await expect(store().run(old, effect)).rejects.toMatchObject({
    code: 'E_SYS_REQUEST_IN_PROGRESS',
  });
  expect(await db.idempotency_keys.count()).toBe(1);
  await store().run(next, effect);
  expect(await count()).toBe(1);
  expect((await store().claim(input)).kind).toBe('replay');
});
test('running transaction keeps its row even after lease expires; competing claim stays bounded', async () => {
  const input = identity(),
    claim = await store().claim(input);
  if (claim.kind !== 'claim') throw new Error('Expected claim');
  const entered = latch(),
    finish = latch();
  const running = store().run(claim, async (tx) => {
    await effect(tx);
    entered.release();
    await finish.promise;
    return { status: 201, body: { once: true }, headers: {} };
  });
  try {
    await entered.promise;
    clock.value += 31000;
    const start = performance.now();
    await expect(store().claim(input)).rejects.toMatchObject({
      code: 'E_SYS_REQUEST_IN_PROGRESS',
      retryAfterSeconds: 1,
    });
    expect(performance.now() - start).toBeLessThan(900);
  } finally {
    finish.release();
    await running;
  }
  expect(await count()).toBe(1);
  expect((await store().claim(input)).kind).toBe('replay');
});
test('duplicate run compensation never waits on the successful owner row lock', async () => {
  const claim = await store().claim(identity());
  if (claim.kind !== 'claim') throw new Error('Expected claim');
  const entered = latch(),
    finish = latch();
  const running = store().run(claim, async (tx) => {
    await effect(tx);
    entered.release();
    await finish.promise;
    return { status: 201, body: { once: true }, headers: {} };
  });
  await entered.promise;
  const fallback = setTimeout(finish.release, 1200);
  try {
    const start = performance.now();
    await expect(store().run(claim, effect)).rejects.toMatchObject({
      code: 'E_SYS_REQUEST_IN_PROGRESS',
    });
    expect(performance.now() - start).toBeLessThan(900);
  } finally {
    clearTimeout(fallback);
    finish.release();
    await running;
  }
  expect(await count()).toBe(1);
  expect(await db.idempotency_keys.count({ where: { status: 'COMPLETED' } })).toBe(1);
});
test('claim safely replaces a pending row deleted while waiting for its lock', async () => {
  const input = identity(),
    claim = await store().claim(input);
  if (claim.kind !== 'claim') throw new Error('Expected claim');
  const deleted = latch(),
    finish = latch();
  const removing = db.$transaction(async (tx) => {
    await tx.idempotency_keys.delete({ where: { id: claim.id } });
    deleted.release();
    await finish.promise;
  });
  await deleted.promise;
  const replacement = store().claim(input);
  const settled = replacement.then(
    (value) => ({ value }),
    (error: unknown) => ({ error }),
  );
  try {
    for (let i = 0; i < 30; i++) {
      const waiting = await rows(
        "SELECT count(*) AS n FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND query ILIKE '%idempotency_keys%'",
      );
      if (Number(waiting[0]!.n) > 0) break;
      await delay(5);
    }
  } finally {
    finish.release();
    await removing;
  }
  expect(await settled).toMatchObject({ value: { kind: 'claim' } });
  expect(await db.idempotency_keys.count()).toBe(1);
});
test('retention lasts exactly 24h; same scoped key permits a new payload only after expiry', async () => {
  const input = identity(),
    claim = await store().claim(input);
  if (claim.kind !== 'claim') throw new Error('Expected claim');
  await store().run(claim, effect);
  clock.value += 86400000 - 1;
  await expect(store().claim({ ...input, requestHash: 'new' })).rejects.toMatchObject({
    code: 'E_SYS_IDEMPOTENCY_KEY_REUSED',
  });
  clock.value++;
  const next = await store().claim({ ...input, requestHash: 'new' });
  expect(next.kind).toBe('claim');
  if (next.kind !== 'claim') throw new Error('Expected fresh claim');
  await store().run(next, effect);
  expect(await count()).toBe(2);
});
