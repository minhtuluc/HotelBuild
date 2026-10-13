import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { expect, test } from 'vitest';
import { databaseUrl } from '../idempotency/database.js';
import { http, login } from '../room-blocks/http-fixture.js';
import { rows, propertyId, typeId, userId } from '../room-blocks/inventory-seed.js';

async function configuration(token: string) {
  const channelId = String((await rows("SELECT id FROM channels WHERE code='OTA_BOOKING'"))[0]!.id);
  await rows(
    'INSERT INTO channel_allotment_scopes(channel_id,room_type_id) VALUES($1,$2) ON CONFLICT DO NOTHING',
    [channelId, typeId],
  );
  const read = await http()
    .get('/api/v1/channel-allotments')
    .set('Authorization', `Bearer ${token}`)
    .query({ channelId, roomTypeId: typeId, from: '2026-11-01', to: '2026-11-03' });
  expect(read.status).toBe(200);
  expect(read.headers.etag).toMatch(/^"[1-9]\d*"$/);
  return { channelId, etag: String(read.headers.etag) };
}
function put(token: string, config: { channelId: string; etag: string }) {
  return http()
    .put('/api/v1/channel-allotments')
    .set('Authorization', `Bearer ${token}`)
    .set('Idempotency-Key', randomUUID())
    .set('If-Match', config.etag)
    .send({
      channelId: config.channelId,
      roomTypeId: typeId,
      items: [{ date: '2026-11-01', allotment: 1 }],
      reason: 'Synthetic quota configuration',
    });
}
async function effects() {
  return {
    quotas: await rows('SELECT id,allotment,version FROM channel_allotments ORDER BY id'),
    scopes: await rows(
      'SELECT channel_id,room_type_id,version FROM channel_allotment_scopes ORDER BY channel_id,room_type_id',
    ),
    audit: await rows("SELECT id FROM audit_logs WHERE action='ALLOTMENT_UPDATED' ORDER BY id"),
    outbox: await rows(
      "SELECT id FROM outbox_events WHERE aggregate_type='ChannelAllotment' ORDER BY id",
    ),
    completed: await rows("SELECT id FROM idempotency_keys WHERE status='COMPLETED' ORDER BY id"),
  };
}
async function ownerClient() {
  const migration = process.env.DATABASE_MIGRATION_URL;
  if (!migration) throw Error('PostgreSQL16 migration connection is required');
  const url = new URL(migration);
  url.pathname = new URL(databaseUrl).pathname;
  const client = new pg.Client({ connectionString: url.href });
  await client.connect();
  return client;
}
async function whileWaiting(token: string, pair: boolean, change?: string) {
  const config = await configuration(token);
  const before = await effects();
  const barrier = await ownerClient();
  let pending: Promise<Awaited<ReturnType<typeof put>>> | undefined;
  try {
    await barrier.query('BEGIN');
    if (pair)
      await barrier.query(
        'SELECT version FROM channel_allotment_scopes WHERE channel_id=$1 AND room_type_id=$2 FOR UPDATE',
        [config.channelId, typeId],
      );
    else await barrier.query('SELECT id FROM properties WHERE id=$1 FOR UPDATE', [propertyId]);
    pending = put(token, config).then((response) => response);
    await expect
      .poll(
        async () =>
          (
            await rows(
              "SELECT count(*)::text AS n FROM pg_stat_activity WHERE datname=current_database() AND pid<>pg_backend_pid() AND wait_event_type='Lock' AND query LIKE $1",
              [pair ? '%channel_allotment_scopes%' : '%SELECT id FROM properties WHERE%'],
            )
          )[0]?.n,
        { timeout: 3000, interval: 10 },
      )
      .toBe('1');
    if (change) await barrier.query(change, [userId]);
    await barrier.query('COMMIT');
    return { response: await pending, before };
  } finally {
    await barrier.query('ROLLBACK');
    await barrier.end();
    if (pending) await pending;
  }
}
const changes = [
  ['role downgrade', "UPDATE users SET role='FRONT_DESK' WHERE id=$1"],
  ['selected property scope removal', 'DELETE FROM user_property_scopes WHERE user_id=$1'],
  ['account deactivation', 'UPDATE users SET is_active=false WHERE id=$1'],
] as const;
for (const pair of [false, true]) {
  const lock = pair ? 'pair-scope' : 'property';
  for (const [label, change] of changes)
    test(`PUT rechecks ${label} after ${lock} lock and rolls back all effects`, async () => {
      const token = await login();
      const { response, before } = await whileWaiting(token, pair, change);
      expect(response.status).toBe(403);
      expect(await effects()).toEqual(before);
    });
  test(`unchanged MANAGER waiting on ${lock} lock still commits one quota batch`, async () => {
    const { response, before } = await whileWaiting(await login(), pair);
    expect(response.status).toBe(204);
    const after = await effects();
    expect(after.quotas).toHaveLength(1);
    expect(after.quotas[0]?.allotment).toBe(1);
    expect(after.audit).toHaveLength(before.audit.length + 1);
    expect(after.outbox).toHaveLength(before.outbox.length + 1);
  });
}
test('OWNER retains global allotment permission without a property scope row', async () => {
  const token = await login('OWNER');
  await rows('DELETE FROM user_property_scopes WHERE user_id=$1', [userId]);
  expect((await whileWaiting(token, true)).response.status).toBe(204);
});
for (const [label, change] of changes)
  test(`locked ${label} stays stable through quota commit`, async () => {
    const token = await login(),
      config = await configuration(token);
    const barrier = await ownerClient(),
      revoker = await ownerClient();
    let pending: Promise<Awaited<ReturnType<typeof put>>> | undefined;
    let revoke: Promise<pg.QueryResult> | undefined;
    try {
      await barrier.query('BEGIN');
      await barrier.query('LOCK TABLE channel_allotments IN SHARE MODE');
      pending = put(token, config).then((response) => response);
      await expect
        .poll(
          async () =>
            (
              await rows(
                "SELECT count(*)::text AS n FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND query LIKE '%INSERT INTO%channel_allotments%'",
              )
            )[0]?.n,
          { timeout: 3000, interval: 10 },
        )
        .toBe('1');
      const pid = (await revoker.query<{ pid: number }>('SELECT pg_backend_pid() AS pid')).rows[0]!
        .pid;
      revoke = revoker.query(change, [userId]);
      await expect
        .poll(
          async () =>
            (
              await rows(
                "SELECT pid FROM pg_stat_activity WHERE pid=$1 AND wait_event_type='Lock'",
                [pid],
              )
            ).length,
          { timeout: 1500, interval: 10 },
        )
        .toBe(1);
      await barrier.query('COMMIT');
      expect((await pending).status).toBe(204);
      await revoke;
      expect(await rows('SELECT allotment FROM channel_allotments')).toEqual([{ allotment: 1 }]);
    } finally {
      await barrier.query('ROLLBACK');
      if (pending) await pending;
      if (revoke) await revoke;
      await revoker.end();
      await barrier.end();
    }
  });
