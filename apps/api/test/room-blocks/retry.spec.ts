import { randomUUID } from 'node:crypto';
import { expect, test } from 'vitest';
import { AppError } from '../../src/common/app-error.js';
import { RetryTransaction } from '../../src/common/idempotency/transaction-retry.js';
import { IdempotencyStore } from '../../src/common/idempotency/store.js';
import { identifyRequest } from '../../src/common/idempotency/request.js';
import { AuditWriter } from '../../src/infrastructure/audit/audit-writer.js';
import { db, rows, clock, ids, userId, count, auditCount } from '../idempotency/database.js';

async function run(failures: number) {
  const store = new IdempotencyStore(db, clock, ids);
  const identity = identifyRequest(
    { type: 'USER', id: userId },
    {
      method: 'POST',
      url: '/room-blocks',
      headers: { 'idempotency-key': randomUUID() },
      body: {},
    },
  );
  const claim = await store.claim(identity);
  if (claim.kind !== 'claim') throw new Error('Expected fresh claim');
  const transactions: string[] = [];
  const execute = store.run(claim, async (tx) => {
    transactions.push(
      (await tx.$queryRaw<{ id: string }[]>`SELECT pg_current_xact_id()::text AS id`)[0]!.id,
    );
    await tx.$executeRaw`UPDATE system_settings SET value=(value::int+1)::text WHERE key='H029'`;
    await new AuditWriter(clock).record(tx, {
      actor: { id: userId, role: 'FRONT_DESK', ip: null, correlationId: 'synthetic' },
      action: 'H029_COMMAND',
      entityType: 'RoomBlock',
      entityId: userId,
      beforeJson: null,
      afterJson: { effect: 1 },
      reason: 'synthetic',
    });
    if (transactions.length <= failures)
      throw new RetryTransaction(new AppError(409, 'E_INV_LOCK_TIMEOUT', 'Tranh chấp tồn.'));
    return { status: 201, body: { effect: 1 }, headers: {} };
  });
  return { execute, transactions, identity, store };
}
test('retry rolls back the entire transaction including audit and commits one durable response', async () => {
  const before = await auditCount();
  const operation = await run(2);
  await expect(operation.execute).resolves.toMatchObject({ status: 201, body: { effect: 1 } });
  expect(new Set(operation.transactions).size).toBe(3);
  expect(await count()).toBe(1);
  expect(await auditCount()).toBe(before + 1);
  await expect(operation.store.claim(operation.identity)).resolves.toMatchObject({
    kind: 'replay',
  });
});
test('retry exhaustion has exactly three fresh transactions and compensates only after all rollback', async () => {
  const before = await auditCount();
  const operation = await run(100);
  await expect(operation.execute).rejects.toMatchObject({
    code: 'E_INV_LOCK_TIMEOUT',
    status: 409,
  });
  expect(new Set(operation.transactions).size).toBe(3);
  expect(await count()).toBe(0);
  expect(await auditCount()).toBe(before);
  expect(await rows('SELECT id FROM idempotency_keys')).toEqual([]);
});
