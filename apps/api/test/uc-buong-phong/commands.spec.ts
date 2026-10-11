import { expect, test } from 'vitest';
import { randomUUID } from 'node:crypto';
import { housekeepingTaskSchema } from '@pinehill/contracts';
import {
  patch,
  login,
  rows,
  ownTask,
  secondTask,
  outsideTask,
  userId,
  secondUserId,
  secondLogin,
  clock,
  propertyId,
  http,
} from './fixture.js';
// Catches invalid task transitions, missing transactional audit, or replay incrementing the task twice.
test('assigned staff advances cleaning one step; durable replay changes neither version nor audit', async () => {
  const token = await login('HOUSEKEEPING'),
    key = randomUUID();
  const first = await patch(
    token,
    { status: 'IN_PROGRESS', note: 'Ready to clean' },
    ownTask,
    '"1"',
    key,
  );
  expect(first.status).toBe(200);
  expect(first.headers.etag).toBe('"2"');
  expect(housekeepingTaskSchema.parse(first.body)).toMatchObject({
    status: 'IN_PROGRESS',
    version: 2,
    completedAt: null,
  });
  const replay = await patch(
    token,
    { status: 'IN_PROGRESS', note: 'Ready to clean' },
    ownTask,
    '"1"',
    key,
  );
  expect(replay.status).toBe(200);
  expect(replay.headers['idempotency-replayed']).toBe('true');
  expect(replay.headers.etag).toBe('"2"');
  expect(replay.body).toEqual(first.body);
  const done = await patch(token, { status: 'DONE' }, ownTask, '"2"');
  expect(done.status).toBe(200);
  expect(housekeepingTaskSchema.parse(done.body)).toMatchObject({
    status: 'DONE',
    version: 3,
    completedAt: clock.now().toISOString(),
  });
  const audit = await rows(
    "SELECT before_json,after_json,actor_id FROM audit_logs WHERE entity_id=$1 AND action='HOUSEKEEPING_TASK_UPDATED' ORDER BY chain_seq",
    [ownTask],
  );
  expect(audit).toHaveLength(2);
  expect(audit[0]).toMatchObject({
    actor_id: userId,
    before_json: { status: 'PENDING', version: 1 },
    after_json: { status: 'IN_PROGRESS', version: 2 },
  });
});
test('state skips and reversal return409; staff cannot inspect, reopen or reassign', async () => {
  const token = await login('HOUSEKEEPING');
  expect((await patch(token, { status: 'DONE' })).status).toBe(409);
  expect((await patch(token, { status: 'INSPECTED' })).status).toBe(403);
  expect((await patch(token, { assignedTo: secondUserId })).status).toBe(403);
  expect((await patch(token, { status: 'IN_PROGRESS' })).status).toBe(200);
  expect((await patch(token, { status: 'PENDING' }, ownTask, '"2"')).status).toBe(403);
  expect((await patch(token, { status: 'DONE' }, ownTask, '"2"')).status).toBe(200);
  expect((await patch(token, { status: 'IN_PROGRESS' }, ownTask, '"3"')).status).toBe(409);
});
test('BR-FO-07 lets FRONT_DESK inspect/reopen but not clean or assign', async () => {
  await rows(
    "UPDATE housekeeping_tasks SET status='DONE',completed_at=clock_timestamp() WHERE id=$1",
    [ownTask],
  );
  const token = await login('FRONT_DESK');
  const inspected = await patch(token, { status: 'INSPECTED' }, ownTask, '"2"');
  expect(inspected.status).toBe(200);
  expect(housekeepingTaskSchema.parse(inspected.body).completedAt).not.toBeNull();
  expect((await patch(token, { assignedTo: secondUserId }, ownTask, '"3"')).status).toBe(403);
  const reopened = await patch(
    token,
    { status: 'PENDING', reason: 'Inspection requires another clean' },
    ownTask,
    '"3"',
  );
  expect(reopened.status).toBe(200);
  expect(reopened.body).toMatchObject({ status: 'PENDING', completedAt: null, version: 4 });
  expect((await patch(token, { status: 'IN_PROGRESS' }, ownTask, '"4"')).status).toBe(403);
});
test.each(['MANAGER', 'OWNER'])(
  '%s assigns only active housekeeping staff scoped to the task property',
  async (role) => {
    const token = await login(role);
    expect((await patch(token, { assignedTo: secondUserId })).status).toBe(200);
    expect((await patch(token, { assignedTo: userId }, ownTask, '"2"')).status).toBe(400);
    await rows('DELETE FROM user_property_scopes WHERE user_id=$1 AND property_id=$2', [
      secondUserId,
      propertyId,
    ]);
    expect((await patch(token, { assignedTo: secondUserId }, ownTask, '"2"')).status).toBe(400);
    expect((await patch(token, { assignedTo: null }, ownTask, '"2"')).status).toBe(200);
  },
);
test('assignment, scope and role are rechecked before a cached command replay', async () => {
  const token = await login('HOUSEKEEPING'),
    key = randomUUID();
  expect((await patch(token, { status: 'IN_PROGRESS' }, ownTask, '"1"', key)).status).toBe(200);
  await rows('UPDATE housekeeping_tasks SET assigned_to=$1 WHERE id=$2', [secondUserId, ownTask]);
  expect((await patch(token, { status: 'IN_PROGRESS' }, ownTask, '"1"', key)).status).toBe(403);
  expect((await patch(token, { note: 'Forbidden' }, secondTask)).status).toBe(403);
  expect((await patch(token, { note: 'Forbidden' }, outsideTask)).status).toBe(403);
  expect((await patch(await secondLogin('SYSADMIN'), { note: 'Forbidden' })).status).toBe(403);
});
test('precondition and strict write validation fail without task mutation', async () => {
  const token = await login('HOUSEKEEPING');
  expect((await patch(token, { status: 'IN_PROGRESS' }, ownTask, null)).status).toBe(428);
  for (const tag of ['*', 'W/"1"', '"9007199254740993"', '"0"'])
    expect((await patch(token, { status: 'IN_PROGRESS' }, ownTask, tag)).status).toBe(412);
  for (const body of [
    {},
    { bookingId: 'forbidden' },
    { note: 'x'.repeat(501) },
    { reason: 'No actual change' },
  ])
    expect((await patch(token, body)).status).toBe(400);
  expect(
    (await rows('SELECT status,version FROM housekeeping_tasks WHERE id=$1', [ownTask]))[0],
  ).toMatchObject({ status: 'PENDING', version: '1' });
});
test('audit failure rolls back task/version and does not cache a success', async () => {
  const token = await login('HOUSEKEEPING');
  await rows(
    "CREATE FUNCTION hb148_audit_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action='HOUSEKEEPING_TASK_UPDATED' THEN RAISE EXCEPTION 'Synthetic audit rejection'; END IF; RETURN NEW; END $$",
  );
  await rows(
    'CREATE TRIGGER hb148_audit_failure BEFORE INSERT ON audit_logs FOR EACH ROW EXECUTE FUNCTION hb148_audit_failure()',
  );
  try {
    const result = await patch(token, { status: 'IN_PROGRESS' });
    expect(result.status).toBe(500);
    expect(
      (await rows('SELECT status,version FROM housekeeping_tasks WHERE id=$1', [ownTask]))[0],
    ).toMatchObject({ status: 'PENDING', version: '1' });
    expect(
      await rows("SELECT id FROM idempotency_keys WHERE status='COMPLETED' AND method='PATCH'"),
    ).toEqual([]);
  } finally {
    await rows('DROP TRIGGER hb148_audit_failure ON audit_logs');
    await rows('DROP FUNCTION hb148_audit_failure()');
  }
});

test('OWNER cannot inherit inspection or cleaning; MANAGER inspects but cannot skip cleaning', async () => {
  const owner = await login('OWNER');
  expect((await patch(owner, { status: 'INSPECTED' })).status).toBe(403);
  expect((await patch(owner, { status: 'IN_PROGRESS' })).status).toBe(403);
  const manager = await login('MANAGER');
  expect((await patch(manager, { status: 'INSPECTED' })).status).toBe(409);
  expect((await patch(manager, { status: 'DONE' })).status).toBe(403);
  await rows(
    "UPDATE housekeeping_tasks SET status='DONE',completed_at=clock_timestamp() WHERE id=$1",
    [ownTask],
  );
  expect((await patch(manager, { status: 'INSPECTED' }, ownTask, '"2"')).status).toBe(200);
});
test('inactive or nonexistent assignees are rejected without changing assignment', async () => {
  const manager = await login('MANAGER');
  await rows('UPDATE users SET is_active=false WHERE id=$1', [secondUserId]);
  expect((await patch(manager, { assignedTo: secondUserId })).status).toBe(400);
  expect((await patch(manager, { assignedTo: randomUUID() })).status).toBe(400);
  expect(
    (await rows('SELECT assigned_to,version FROM housekeeping_tasks WHERE id=$1', [ownTask]))[0],
  ).toEqual({ assigned_to: userId, version: '1' });
});
test('same key with different note is a409 and missing/invalid task never mutates a task', async () => {
  const token = await login('HOUSEKEEPING'),
    key = randomUUID();
  expect((await patch(token, { note: 'Original note' }, ownTask, '"1"', key)).status).toBe(200);
  expect((await patch(token, { note: 'Altered note' }, ownTask, '"1"', key)).status).toBe(409);
  expect((await patch(token, { note: 'Unknown task' }, randomUUID())).status).toBe(404);
  expect((await patch(token, { note: 'Invalid task' }, 'not-uuid')).status).toBe(400);
  expect(
    (await rows('SELECT note,version FROM housekeeping_tasks WHERE id=$1', [ownTask]))[0],
  ).toEqual({ note: 'Original note', version: '2' });
});
test('anonymous callers cannot list or patch tasks', async () => {
  expect(
    (await http().get('/api/v1/housekeeping/tasks').query({ businessDate: '2026-11-01' })).status,
  ).toBe(401);
  expect(
    (
      await http()
        .patch(`/api/v1/housekeeping/tasks/${ownTask}`)
        .set('Idempotency-Key', randomUUID())
        .set('If-Match', '"1"')
        .send({ status: 'IN_PROGRESS' })
    ).status,
  ).toBe(401);
});
