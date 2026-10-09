import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { identifyRequest } from '../../src/common/idempotency/request.js';
import { IdempotencyStore } from '../../src/common/idempotency/store.js';
const data = z
  .object({ userId: z.uuid(), key: z.uuid(), now: z.number(), duringTransaction: z.boolean() })
  .parse(JSON.parse(process.env.HB029_CRASH_INPUT ?? ''));
const databaseUrl = z.string().min(1).parse(process.env.DATABASE_URL);
const db = new PrismaClient({ datasourceUrl: databaseUrl });
const store = new IdempotencyStore(db, { now: () => new Date(data.now) }, { generate: randomUUID });
const input = identifyRequest(
  { type: 'USER', id: data.userId },
  {
    method: 'POST',
    url: '/crash',
    headers: { 'idempotency-key': data.key },
    body: { increment: 1 },
  },
);
const claim = await store.claim(input);
if (claim.kind !== 'claim') throw new Error('Crash fixture requires a fresh claim');
const wait = async () =>
  new Promise<never>(() => {
    setInterval(() => {}, 1000);
  });
if (data.duringTransaction) {
  await store.run(claim, async (tx) => {
    await tx.$executeRaw`UPDATE system_settings SET value=(value::int+1)::text WHERE key='H029'`;
    process.stdout.write(`${JSON.stringify(claim)}\n`);
    return wait();
  });
} else {
  process.stdout.write(`${JSON.stringify(claim)}\n`);
  await wait();
}
