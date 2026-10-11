import { expect, test } from 'vitest';
import pg from 'pg';
import { setTimeout as delay } from 'node:timers/promises';
import { housekeepingTaskSchema, errorBodySchema } from '@pinehill/contracts';
import { databaseUrl } from '../idempotency/database.js';
import {
  patch,
  login,
  rows,
  ownTask,
  roomId,
  userId,
  secondUserId,
  propertyId,
  otherPropertyId,
} from './fixture.js';
async function waitForRoomLock() {
  for (let attempt = 0; attempt < 80; attempt++) {
    const waiting = await rows(
      "SELECT pid FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND query LIKE '%FROM rooms%FOR UPDATE%'",
    );
    if (waiting.length) return;
    await delay(10);
  }
  throw new Error('Command did not reach the shared handover Room lock');
}
// Catches absent locking/version comparison: two incompatible updates cannot both commit.
test('two commands with the same task version commit one mutation and one audit', async () => {
  const token = await login('HOUSEKEEPING');
  const results = await Promise.all([
    patch(token, { note: 'First command' }),
    patch(token, { note: 'Second command' }),
  ]);
  expect(results.map((r) => r.status).sort()).toEqual([200, 412]);
  expect(
    (await rows('SELECT version,note FROM housekeeping_tasks WHERE id=$1', [ownTask]))[0],
  ).toMatchObject({
    version: '2',
    note: housekeepingTaskSchema.parse(results.find((r) => r.status === 200)!.body).note,
  });
  expect(
    await rows(
      "SELECT id FROM audit_logs WHERE entity_id=$1 AND action='HOUSEKEEPING_TASK_UPDATED'",
      [ownTask],
    ),
  ).toHaveLength(1);
});
test.each(['assignment', 'scope', 'role', 'property'])(
  'a %s change while waiting for handover lock denies the command after reread',
  async (change) => {
    const token = await login('HOUSEKEEPING');
    const blocker = new pg.Client({ connectionString: databaseUrl });
    await blocker.connect();
    let result: Promise<{ status: number }> | undefined;
    try {
      await blocker.query('BEGIN');
      await blocker.query('SELECT id FROM rooms WHERE id=$1::uuid FOR UPDATE', [roomId]);
      result = patch(token, { status: 'IN_PROGRESS' }).then((response) => response);
      await waitForRoomLock();
      if (change === 'assignment')
        await rows('UPDATE housekeeping_tasks SET assigned_to=$1 WHERE id=$2', [
          secondUserId,
          ownTask,
        ]);
      if (change === 'scope')
        await rows('DELETE FROM user_property_scopes WHERE user_id=$1 AND property_id=$2', [
          userId,
          propertyId,
        ]);
      if (change === 'role') await rows("UPDATE users SET role='SYSADMIN' WHERE id=$1", [userId]);
      if (change === 'property')
        await blocker.query("UPDATE rooms SET property_id=$1,code='HB148-MOVED' WHERE id=$2", [
          otherPropertyId,
          roomId,
        ]);
      await blocker.query('COMMIT');
      expect((await result).status).toBe(403);
      expect(
        (await rows('SELECT status FROM housekeeping_tasks WHERE id=$1', [ownTask]))[0]!.status,
      ).toBe('PENDING');
      expect(
        await rows(
          "SELECT id FROM audit_logs WHERE entity_id=$1 AND action='HOUSEKEEPING_TASK_UPDATED'",
          [ownTask],
        ),
      ).toEqual([]);
    } finally {
      await blocker.query('ROLLBACK');
      await blocker.end();
      if (result) await result;
      if (change === 'property')
        await rows("UPDATE rooms SET property_id=$1,code='R1' WHERE id=$2", [propertyId, roomId]);
    }
  },
);
test('room lock timeout exhausts bounded retries without mutation/audit and may be retried safely', async () => {
  const token = await login('HOUSEKEEPING');
  const blocker = new pg.Client({ connectionString: databaseUrl });
  await blocker.connect();
  try {
    await blocker.query('BEGIN');
    await blocker.query('SELECT id FROM rooms WHERE id=$1::uuid FOR UPDATE', [roomId]);
    const result = await patch(token, { status: 'IN_PROGRESS' });
    expect(result.status).toBe(409);
    expect(errorBodySchema.parse(result.body).code).toBe('E_SYS_REQUEST_IN_PROGRESS');
    expect(
      (await rows('SELECT status,version FROM housekeeping_tasks WHERE id=$1', [ownTask]))[0],
    ).toMatchObject({ status: 'PENDING', version: '1' });
    expect(
      await rows(
        "SELECT id FROM audit_logs WHERE entity_id=$1 AND action='HOUSEKEEPING_TASK_UPDATED'",
        [ownTask],
      ),
    ).toEqual([]);
  } finally {
    await blocker.query('ROLLBACK');
    await blocker.end();
  }
  expect((await patch(token, { status: 'IN_PROGRESS' })).status).toBe(200);
});
test('cleaning changes never alter room status, assignments, commercial stock or outbox', async () => {
  const token = await login('HOUSEKEEPING');
  const before = await rows(`SELECT (SELECT jsonb_agg(r ORDER BY id) FROM rooms r) AS rooms,
    (SELECT count(*) FROM room_assignments) AS assignments, (SELECT count(*) FROM channel_allotments) AS allotments,
    (SELECT count(*) FROM bookings) AS bookings, (SELECT count(*) FROM room_blocks) AS blocks, (SELECT count(*) FROM outbox_events) AS outbox`);
  expect(
    (
      await patch(token, {
        status: 'IN_PROGRESS',
        note: 'Synthetic +84912345678 test@example.test',
      })
    ).status,
  ).toBe(200);
  expect((await patch(token, { status: 'DONE' }, ownTask, '"2"')).status).toBe(200);
  expect(
    await rows(`SELECT (SELECT jsonb_agg(r ORDER BY id) FROM rooms r) AS rooms,
    (SELECT count(*) FROM room_assignments) AS assignments, (SELECT count(*) FROM channel_allotments) AS allotments,
    (SELECT count(*) FROM bookings) AS bookings, (SELECT count(*) FROM room_blocks) AS blocks, (SELECT count(*) FROM outbox_events) AS outbox`),
  ).toEqual(before);
  const stored = await rows(
    "SELECT note FROM housekeeping_tasks WHERE id=$1 UNION ALL SELECT after_json::text AS note FROM audit_logs WHERE entity_id=$1 AND action='HOUSEKEEPING_TASK_UPDATED'",
    [ownTask],
  );
  expect(JSON.stringify(stored)).not.toMatch(/84912345678|test@example/);
});
