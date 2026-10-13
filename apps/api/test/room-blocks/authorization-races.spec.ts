import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { expect, test } from 'vitest';
import { roomBlockSchema } from '@pinehill/contracts';
import { databaseUrl } from '../idempotency/database.js';
import { http, login } from './http-fixture.js';
import { rows, roomId, propertyId, userId, booking, assign } from './inventory-seed.js';

const payload = () => ({
  roomId,
  startDate: '2026-11-01',
  endDate: '2026-11-04',
  reason: 'MAINTENANCE',
});
const post = (token: string) =>
  http()
    .post('/api/v1/room-blocks')
    .set('Authorization', `Bearer ${token}`)
    .set('Idempotency-Key', randomUUID())
    .send(payload());
const del = (token: string, id: string) =>
  http()
    .delete(`/api/v1/room-blocks/${id}`)
    .set('Authorization', `Bearer ${token}`)
    .set('Idempotency-Key', randomUUID())
    .query({ reason: 'Synthetic repaired' });

async function whileWaiting<T>(start: () => Promise<T>, revoke?: string): Promise<T> {
  const migration = process.env.DATABASE_MIGRATION_URL;
  if (!migration) throw Error('PostgreSQL16 migration connection is required');
  const url = new URL(migration);
  url.pathname = new URL(databaseUrl).pathname;
  const barrier = new pg.Client({ connectionString: url.href });
  await barrier.connect();
  let pending: Promise<T> | undefined;
  try {
    await barrier.query('BEGIN');
    await barrier.query('SELECT id FROM properties WHERE id=$1 FOR UPDATE', [propertyId]);
    pending = start();
    await expect
      .poll(
        async () =>
          (
            await rows(
              `SELECT count(*)::text AS n FROM pg_stat_activity
               WHERE datname=current_database() AND pid<>pg_backend_pid()
               AND wait_event_type='Lock' AND query LIKE '%SELECT id FROM properties WHERE%'`,
            )
          )[0]?.n,
        { timeout: 3000, interval: 10 },
      )
      .toBe('1');
    if (revoke) await barrier.query(revoke, [userId]);
    await barrier.query('COMMIT');
    return await pending;
  } finally {
    await barrier.query('ROLLBACK');
    await barrier.end();
    // A failed barrier assertion still releases the resource and drains the actual HTTP request.
    if (pending) await pending;
  }
}

async function effects() {
  return {
    blocks: await rows('SELECT id FROM room_blocks ORDER BY id'),
    cases: await rows('SELECT id FROM overbooking_cases ORDER BY id'),
    audit: await rows("SELECT id FROM audit_logs WHERE entity_type='RoomBlock' ORDER BY id"),
    outbox: await rows("SELECT id FROM outbox_events WHERE aggregate_type='RoomBlock' ORDER BY id"),
    completed: await rows("SELECT id FROM idempotency_keys WHERE status='COMPLETED' ORDER BY id"),
  };
}

const changes = [
  ['role downgrade', "UPDATE users SET role='FRONT_DESK' WHERE id=$1"],
  ['selected property scope removal', 'DELETE FROM user_property_scopes WHERE user_id=$1'],
  ['account deactivation', 'UPDATE users SET is_active=false WHERE id=$1'],
] as const;

for (const [label, change] of changes) {
  test(`create rechecks ${label} after the real inventory lock, with no override effects`, async () => {
    const booked = await booking();
    await assign(booked.room);
    const token = await login();
    const before = await effects();
    const result = await whileWaiting(() => post(token).then((response) => response), change);
    expect(result.status).toBe(403);
    expect(await effects()).toEqual(before);
  });

  test(`delete rechecks ${label} after the real inventory lock and keeps the original block`, async () => {
    const token = await login();
    const created = await post(token);
    expect(created.status).toBe(201);
    const id = roomBlockSchema.parse(created.body).id;
    const before = await effects();
    const result = await whileWaiting(() => del(token, id).then((response) => response), change);
    expect(result.status).toBe(403);
    expect(await effects()).toEqual(before);
  });
}

test('unchanged MANAGER waiting on the same lock still creates cases and can remove the block', async () => {
  const booked = await booking();
  await assign(booked.room);
  const token = await login();
  const created = await whileWaiting(() => post(token).then((response) => response));
  expect(created.status).toBe(201);
  const id = roomBlockSchema.parse(created.body).id;
  expect(await rows('SELECT id FROM overbooking_cases')).toHaveLength(3);
  expect((await whileWaiting(() => del(token, id).then((response) => response))).status).toBe(204);
  expect(await rows('SELECT id FROM room_blocks')).toEqual([]);
});

test('unchanged OWNER global access does not require a property scope row', async () => {
  const token = await login('OWNER');
  await rows('DELETE FROM user_property_scopes WHERE user_id=$1', [userId]);
  const result = await whileWaiting(() => post(token).then((response) => response));
  expect(result.status).toBe(201);
  expect((await del(token, roomBlockSchema.parse(result.body).id)).status).toBe(204);
});

for (const [label, change] of changes)
  test(`current ${label} cannot change between locked authorization and commit`, async () => {
    const token = await login();
    const url = new URL(process.env.DATABASE_MIGRATION_URL!);
    url.pathname = new URL(databaseUrl).pathname;
    const barrier = new pg.Client({ connectionString: url.href });
    const revoker = new pg.Client({ connectionString: url.href });
    await barrier.connect();
    await revoker.connect();
    let pending: Promise<Awaited<ReturnType<typeof post>>> | undefined;
    let revoke: Promise<pg.QueryResult> | undefined;
    try {
      await barrier.query('BEGIN');
      // INSERT stops after current-user/scope verification and before any durable effects.
      await barrier.query('LOCK TABLE room_blocks IN SHARE MODE');
      pending = post(token).then((response) => response);
      await expect
        .poll(
          async () =>
            (
              await rows(`SELECT count(*)::text AS n FROM pg_stat_activity
        WHERE datname=current_database() AND wait_event_type='Lock'
        AND query LIKE '%INSERT INTO%room_blocks%'`)
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
      const result = await pending;
      expect(result.status).toBe(201);
      await revoke;
      expect(await rows('SELECT id FROM room_blocks')).toHaveLength(1);
      expect(
        await rows(
          "SELECT id FROM outbox_events WHERE aggregate_type='RoomBlock' AND aggregate_id=$1",
          [roomBlockSchema.parse(result.body).id],
        ),
      ).toHaveLength(1);
    } finally {
      await barrier.query('ROLLBACK');
      if (pending) await pending;
      if (revoke) await revoke;
      await revoker.end();
      await barrier.end();
    }
  });
