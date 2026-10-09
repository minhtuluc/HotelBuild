import { randomUUID } from 'node:crypto';
import { test, expect } from 'vitest';
import { IdempotencyStore } from '../../src/common/idempotency/store.js';
import type { Claim } from '../../src/common/idempotency/store.js';
import { identifyRequest } from '../../src/common/idempotency/request.js';
import { db, clock, ids, rows, count, userId } from './database.js';
test('TTL sweep deletes expired completed/pending keys, keeps live leases and skips locked keys', async () => {
  const store = new IdempotencyStore(db, clock, ids);
  const claims: Claim[] = [];
  for (let i = 0; i < 5; i++) {
    const input = identifyRequest(
      { type: 'USER', id: userId },
      { method: 'POST', url: '/ttl', headers: { 'idempotency-key': randomUUID() }, body: {} },
    );
    const claim = await store.claim(input);
    if (claim.kind !== 'claim') throw new Error('Expected claim');
    claims.push(claim);
  }
  for (const index of [0, 3, 4])
    await store.run(claims[index]!, async () => ({ status: 201, body: {}, headers: {} }));
  await rows(
    'UPDATE idempotency_keys SET created_at=$1,expires_at=$2,lease_expires_at=$2 WHERE id=ANY($3::uuid[])',
    [
      new Date(clock.value - 172800000),
      new Date(clock.value - 1),
      claims.slice(0, 4).map((c) => c.id),
    ],
  );
  await rows('UPDATE idempotency_keys SET lease_expires_at=$1 WHERE id=$2::uuid', [
    new Date(clock.value + 30000),
    claims[2]!.id,
  ]);
  let release: () => void = () => {
    throw new Error('No barrier');
  };
  const hold = new Promise<void>((resolve) => {
    release = resolve;
  });
  let entered: () => void = () => {
    throw new Error('No barrier');
  };
  const ready = new Promise<void>((resolve) => {
    entered = resolve;
  });
  const locked = db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM idempotency_keys WHERE id=${claims[3]!.id}::uuid FOR UPDATE`;
    entered();
    await hold;
  });
  try {
    await ready;
    expect(await store.purgeExpired()).toBe(2);
    expect(
      (await db.idempotency_keys.findMany({ select: { id: true } })).map((c) => c.id).sort(),
    ).toEqual(
      claims
        .slice(2)
        .map((c) => c.id)
        .sort(),
    );
  } finally {
    release();
    await locked;
  }
  expect(await store.purgeExpired()).toBe(1);
  expect(await store.purgeExpired()).toBe(0);
  expect(await count()).toBe(0);
});
