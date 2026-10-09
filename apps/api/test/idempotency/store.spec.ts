import { randomUUID } from 'node:crypto';
import type { Prisma } from '@prisma/client';
import { test, expect } from 'vitest';
import { AuditWriter } from '../../src/infrastructure/audit/audit-writer.js';
import { identifyRequest } from '../../src/common/idempotency/request.js';
import { IdempotencyStore } from '../../src/common/idempotency/store.js';
import {
  db,
  rows,
  count,
  auditCount,
  clock,
  ids,
  userId,
  secondUserId,
  propertyId,
} from './database.js';
const store = () => new IdempotencyStore(db, clock, ids);
const input = (key = randomUUID()) =>
  identifyRequest(
    { type: 'USER', id: userId },
    {
      method: 'POST',
      url: `/commands/${propertyId}`,
      headers: { 'idempotency-key': key },
      body: { increment: 1 },
    },
  );
async function operation(tx: Prisma.TransactionClient) {
  await tx.$executeRaw`UPDATE system_settings SET value=(value::int+1)::text WHERE key='H029'`;
  await new AuditWriter(clock).record(tx, {
    actor: { id: userId, role: 'FRONT_DESK', ip: null, correlationId: 'synthetic' },
    action: 'H029_COMMAND',
    entityType: 'SystemSetting',
    entityId: propertyId,
    beforeJson: null,
    afterJson: { increment: 1 },
    reason: null,
  });
  return {
    status: 201,
    body: { effect: 'once' },
    headers: { location: '/commands/result', etag: '"2"' },
  };
}
async function execute(identity = input(), command = operation) {
  const owner = store();
  const claim = await owner.claim(identity);
  return claim.kind === 'replay'
    ? claim
    : { kind: 'fresh', response: await owner.run(claim, command) };
}
test('effect, audit and replayable response commit once and retry returns the original result', async () => {
  const identity = input(),
    before = await auditCount();
  const first = await execute(identity),
    second = await execute(identity);
  expect(first).toEqual({
    kind: 'fresh',
    response: {
      status: 201,
      body: { effect: 'once' },
      headers: { location: '/commands/result', etag: '"2"' },
    },
  });
  expect(second).toEqual({
    kind: 'replay',
    response: {
      status: 201,
      body: { effect: 'once' },
      headers: { location: '/commands/result', etag: '"2"' },
    },
  });
  expect(await count()).toBe(1);
  expect(await auditCount()).toBe(before + 1);
  expect((await rows('SELECT status,response_status FROM idempotency_keys'))[0]).toEqual({
    status: 'COMPLETED',
    response_status: 201,
  });
});
test('same scope/key with a different hash conflicts without another business effect', async () => {
  const identity = input();
  await execute(identity);
  await expect(execute({ ...identity, requestHash: 'different' })).rejects.toMatchObject({
    status: 409,
    code: 'E_SYS_IDEMPOTENCY_KEY_REUSED',
  });
  expect(await count()).toBe(1);
});
test('live lease rejects another claim with retry guidance and never runs the command', async () => {
  const identity = input();
  expect((await store().claim(identity)).kind).toBe('claim');
  await expect(store().claim(identity)).rejects.toMatchObject({
    status: 409,
    code: 'E_SYS_REQUEST_IN_PROGRESS',
    retryAfterSeconds: 1,
  });
  expect(await count()).toBe(0);
});
test('handler failure rolls back business and audit and compensates only its pending claim', async () => {
  const before = await auditCount();
  await expect(
    execute(input(), async (tx) => {
      await operation(tx);
      throw new Error('synthetic failure');
    }),
  ).rejects.toThrow('synthetic failure');
  expect(await count()).toBe(0);
  expect(await auditCount()).toBe(before);
  expect(await db.idempotency_keys.count()).toBe(0);
});
for (const part of ['principal', 'type', 'method', 'resource'])
  test(`key isolation by ${part} cannot expose another scope response`, async () => {
    const original = input();
    await execute(original);
    const changed = {
      ...original,
      ...(part === 'principal' ? { principal: { type: 'USER' as const, id: secondUserId } } : {}),
      ...(part === 'type' ? { principal: { type: 'GUEST' as const, id: userId } } : {}),
      ...(part === 'method' ? { method: 'PATCH' } : {}),
      ...(part === 'resource' ? { path: '/commands/other' } : {}),
    };
    const result = await execute(changed);
    expect(result.kind).toBe('fresh');
    expect(await count()).toBe(2);
    expect(await db.idempotency_keys.count()).toBe(2);
  });
