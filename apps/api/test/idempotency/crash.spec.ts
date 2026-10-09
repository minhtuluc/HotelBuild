import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { test, expect } from 'vitest';
import { z } from 'zod';
import { IdempotencyStore } from '../../src/common/idempotency/store.js';
import { identifyRequest } from '../../src/common/idempotency/request.js';
import { db, clock, ids, count, userId, databaseUrl } from './database.js';
for (const duringTransaction of [false, true])
  test(`SIGKILL ${duringTransaction ? 'inside business transaction' : 'after durable claim'} recovers once after lease expiry`, async () => {
    const key = randomUUID();
    const child = spawn(process.execPath, ['--import', 'tsx', 'test/idempotency/crash-child.ts'], {
      env: {
        ...process.env,
        DATABASE_URL: databaseUrl,
        HB029_CRASH_INPUT: JSON.stringify({ userId, key, now: clock.value, duringTransaction }),
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const exit = new Promise((resolve) => {
      child.once('exit', (code, signal) => resolve({ code, signal }));
    });
    const deadline = setTimeout(() => {
      child.kill('SIGKILL');
    }, 10000);
    let claim;
    try {
      claim = await new Promise<z.infer<typeof claimSchema>>((resolve, reject) => {
        let buffer = '';
        child.stdout.on('data', (chunk: Buffer) => {
          buffer += chunk.toString();
          if (buffer.includes('\n')) {
            try {
              resolve(claimSchema.parse(JSON.parse(buffer.split('\n')[0]!)));
            } catch {
              reject(new Error('Invalid crash readiness signal'));
            }
          }
        });
        child.once('error', reject);
        child.once('exit', () => reject(new Error('Crash child exited before readiness')));
      });
      child.kill('SIGKILL');
      expect(await exit).toEqual({ code: null, signal: 'SIGKILL' });
    } finally {
      clearTimeout(deadline);
      child.kill('SIGKILL');
      await exit;
    }
    expect(await count()).toBe(0);
    const store = new IdempotencyStore(db, clock, ids);
    const input = identifyRequest(
      { type: 'USER', id: userId },
      {
        method: 'POST',
        url: '/crash',
        headers: { 'idempotency-key': key },
        body: { increment: 1 },
      },
    );
    await expect(store.claim(input)).rejects.toMatchObject({ code: 'E_SYS_REQUEST_IN_PROGRESS' });
    clock.value += 30000;
    const fresh = await store.claim(input);
    if (fresh.kind !== 'claim') throw new Error('Expected takeover');
    expect(fresh.id).toBe(claim.id);
    expect(fresh.token).not.toBe(claim.token);
    await expect(
      store.run(claim, async () => ({ status: 201, body: { wrong: true }, headers: {} })),
    ).rejects.toMatchObject({ code: 'E_SYS_REQUEST_IN_PROGRESS' });
    await store.run(fresh, async (tx) => {
      await tx.$executeRaw`UPDATE system_settings SET value=(value::int+1)::text WHERE key='H029'`;
      return { status: 201, body: { once: true }, headers: {} };
    });
    expect(await count()).toBe(1);
    expect(await store.claim(input)).toMatchObject({
      kind: 'replay',
      response: { body: { once: true } },
    });
  }, 15000);
const claimSchema = z.object({ kind: z.literal('claim'), id: z.uuid(), token: z.uuid() });
