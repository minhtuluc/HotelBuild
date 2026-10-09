import { expect, test } from 'vitest';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import pg from 'pg';
import { databaseUrl } from '../../idempotency/database.js';
import { put, login } from './http-fixture.js';
import { plans, policies, rows, version, effects, effectsBefore } from './seed.js';
import { z } from 'zod';
test('two OWNERs with the same version and different keys produce one winner, one412 and no lost update', async () => {
  const id = plans.get('FLEX7')!,
    match = await version(id, 'plan');
  const [first, second] = await Promise.all([login(), login('OWNER', true)]);
  const blocker = new pg.Client({ connectionString: databaseUrl });
  await blocker.connect();
  await blocker.query('BEGIN');
  await blocker.query('SELECT id FROM rate_plans WHERE id=$1 FOR UPDATE', [id]);
  const attempts = [
    put(
      id,
      { depositPercent: 40, reason: 'First OWNER' },
      { kind: 'plan', match, token: first, key: randomUUID() },
    ),
    put(
      id,
      { depositPercent: 60, reason: 'Second OWNER' },
      { kind: 'plan', match, token: second, key: randomUUID() },
    ),
  ];
  try {
    let waiting = false;
    for (let i = 0; i < 150; i++) {
      const active = await rows(
        "SELECT count(*) AS n FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND query ILIKE '%FROM rate_plans%FOR UPDATE%'",
      );
      if (Number(active[0]!.n) === 2) {
        waiting = true;
        break;
      }
      await delay(10);
    }
    expect(waiting).toBe(true);
    await blocker.query('COMMIT');
    const result = await Promise.all(attempts);
    expect(result.map((r) => r.status).sort()).toEqual([204, 412]);
    const stored = (
      await rows('SELECT version,deposit_percent FROM rate_plans WHERE id=$1', [id])
    )[0]!;
    expect(Number(stored.version)).toBe(Number(match.replaceAll('"', '')) + 1);
    expect(Number(stored.deposit_percent)).toBe(result[0]!.status === 204 ? 40 : 60);
    expect(await effects()).toEqual({
      audit: effectsBefore.audit + 1,
      outbox: effectsBefore.outbox + 1,
    });
  } finally {
    await blocker.query('ROLLBACK');
    await blocker.end();
    // Settle in-flight requests after releasing the test-owned barrier, preserving assertions above.
    await Promise.allSettled(attempts);
  }
});
test('rate audit reads the linked policy only after its concurrent revision commits', async () => {
  const id = plans.get('FLEX7')!,
    policy = policies.get('CP-FLEX7')!;
  const token = await login(),
    match = await version(id, 'plan');
  const blocker = new pg.Client({ connectionString: databaseUrl });
  await blocker.connect();
  await blocker.query('BEGIN');
  await blocker.query('UPDATE cancellation_policies SET early_checkout_free_hours=96 WHERE id=$1', [
    policy,
  ]);
  await blocker.query(
    'UPDATE cancellation_tiers SET refund_percent=25 WHERE policy_id=$1 AND offset_hours=72',
    [policy],
  );
  const revised = z
    .object({ version: z.coerce.number() })
    .parse(
      (await blocker.query('SELECT version FROM cancellation_policies WHERE id=$1', [policy]))
        .rows[0],
    );
  const attempt = put(
    id,
    { depositPercent: 40, reason: 'Concurrent policy revision' },
    { kind: 'plan', token, match },
  );
  try {
    let waiting = false;
    for (let i = 0; i < 150; i++) {
      const active = await rows(
        "SELECT count(*) AS n FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND query ILIKE '%FROM cancellation_policies%FOR UPDATE%'",
      );
      if (Number(active[0]!.n) === 1) {
        waiting = true;
        break;
      }
      await delay(10);
    }
    expect(waiting).toBe(true);
    await blocker.query('COMMIT');
    expect((await attempt).status).toBe(204);
    const audit = z
      .object({
        before_json: z.object({
          policy: z.object({
            version: z.number(),
            earlyCheckoutFreeHours: z.number(),
            tiers: z.array(z.object({ offsetHours: z.number(), refundPercent: z.number() })),
          }),
        }),
        after_json: z.object({ policy: z.unknown() }),
      })
      .parse(
        (
          await rows(
            "SELECT before_json,after_json FROM audit_logs WHERE entity_id=$1 AND action='RATE_PLAN_UPDATED' ORDER BY created_at DESC LIMIT 1",
            [id],
          )
        )[0],
      );
    expect(audit.before_json.policy.version).toBe(revised.version);
    expect(audit.before_json.policy.earlyCheckoutFreeHours).toBe(96);
    expect(audit.before_json.policy.tiers.find((t) => t.offsetHours === 72)?.refundPercent).toBe(
      25,
    );
    expect(audit.after_json.policy).toMatchObject(audit.before_json.policy);
  } finally {
    await blocker.query('ROLLBACK');
    await blocker.end();
    await Promise.allSettled([attempt]);
  }
});
