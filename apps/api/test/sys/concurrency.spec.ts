import pg from 'pg';
import { z } from 'zod';
import { test, expect } from 'vitest';
import { databaseUrl, rows, userId, put, login, audit, logs, propertyId } from './fixture.js';
test('role revoked while setting row is locked is rechecked before mutation', async () => {
  const token = await login(),
    blocker = new pg.Client({ connectionString: databaseUrl });
  await blocker.connect();
  let pending: ReturnType<typeof put> | undefined;
  let result: Promise<Awaited<ReturnType<typeof put>>> | undefined;
  try {
    await blocker.query('BEGIN');
    await blocker.query("SELECT id FROM system_settings WHERE key='refund.feeAmount' FOR UPDATE");
    pending = put(token);
    result = pending.then((response) => response);
    await expect
      .poll(
        async () =>
          Number(
            (
              await rows(
                "SELECT count(*) AS n FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND query LIKE '%system_settings%'",
              )
            )[0]!.n,
          ),
        { timeout: 3000 },
      )
      .toBeGreaterThan(0);
    await rows("UPDATE users SET role='MANAGER' WHERE id=$1", [userId]);
    await blocker.query('COMMIT');
    expect((await result).status).toBe(403);
    expect(
      (await rows("SELECT value,version FROM system_settings WHERE key='refund.feeAmount'"))[0],
    ).toEqual({ value: '0', version: '1' });
    expect(
      Number(
        (
          await rows(
            "SELECT count(*) AS n FROM audit_logs WHERE entity_id=(SELECT id FROM system_settings WHERE key='refund.feeAmount')",
          )
        )[0]!.n,
      ),
    ).toBe(0);
  } finally {
    await blocker.query('ROLLBACK');
    await result;
    await blocker.end();
  }
});
test('audit cursor preserves PostgreSQL microsecond order even when displayed timestamps share a millisecond', async () => {
  const ids = [];
  for (const fraction of ['000100', '000200', '000300'])
    ids.push(
      await audit(null, { propertyId }, 'RoomBlock', undefined, `2026-10-11T01:00:00.${fraction}Z`),
    );
  const token = await login('MANAGER'),
    seen: string[] = [];
  let cursor: string | undefined;
  for (let page = 0; page < 3; page++) {
    const result = await logs(token, { limit: 1, ...(cursor ? { cursor } : {}) });
    expect(result.status).toBe(200);
    const body = z
      .object({
        data: z.array(z.object({ id: z.string() })),
        meta: z.object({ total: z.number(), nextCursor: z.string().nullable() }),
      })
      .parse(result.body);
    expect(body.meta.total).toBe(3);
    expect(body.data).toHaveLength(1);
    seen.push(body.data[0]!.id);
    cursor = body.meta.nextCursor ?? undefined;
  }
  expect(seen).toEqual(ids.reverse());
  expect(cursor).toBeUndefined();
});
