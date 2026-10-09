import { randomUUID } from 'node:crypto';
import { expect, test } from 'vitest';
import { roomBlockSchema, listResponseSchema, errorBodySchema } from '@pinehill/contracts';
import { http, login } from './http-fixture.js';
import {
  rows,
  roomId,
  otherRoomId,
  propertyId,
  otherPropertyId,
  userId,
  booking,
  assign,
} from './inventory-seed.js';
const payload = () => ({
  roomId,
  startDate: '2026-11-01',
  endDate: '2026-11-04',
  reason: 'MAINTENANCE',
  note: 'Synthetic repair',
});
const post = (token: string, key = randomUUID()) =>
  http()
    .post('/api/v1/room-blocks')
    .set('Authorization', `Bearer ${token}`)
    .set('Idempotency-Key', key);
const del = (token: string, id: string, key = randomUUID(), reason = 'Synthetic repaired') =>
  http()
    .delete(`/api/v1/room-blocks/${id}`)
    .query({ reason })
    .set('Authorization', `Bearer ${token}`)
    .set('Idempotency-Key', key);
for (const role of [
  'OWNER',
  'MANAGER',
  'FRONT_DESK',
  'RESERVATION_AGENT',
  'ACCOUNTANT',
  'HOUSEKEEPING',
  'SYSADMIN',
])
  test(`${role}: explicit create/read/delete permissions on production routes`, async () => {
    const token = await login(role),
      create = await post(token).send(payload());
    expect(create.status).toBe(['OWNER', 'MANAGER', 'FRONT_DESK'].includes(role) ? 201 : 403);
    const list = await http().get('/api/v1/room-blocks').set('Authorization', `Bearer ${token}`);
    expect(list.status).toBe(
      ['OWNER', 'MANAGER', 'FRONT_DESK', 'HOUSEKEEPING'].includes(role) ? 200 : 403,
    );
    const id = create.status === 201 ? roomBlockSchema.parse(create.body).id : randomUUID();
    const removed = await del(token, id);
    expect(removed.status).toBe(['OWNER', 'MANAGER'].includes(role) ? 204 : 403);
  });
test('create/list/delete real routes preserve note across separate requests and response contracts', async () => {
  const token = await login();
  const first = await post(token).send(payload());
  expect(first.status).toBe(201);
  const dto = roomBlockSchema.parse(first.body);
  expect(dto).toMatchObject(payload());
  const list = await http()
    .get('/api/v1/room-blocks')
    .query({ propertyId })
    .set('Authorization', `Bearer ${token}`);
  expect(list.status).toBe(200);
  expect(listResponseSchema(roomBlockSchema).parse(list.body).data).toEqual([dto]);
  expect((await del(token, dto.id)).status).toBe(204);
  const empty = await http().get('/api/v1/room-blocks').set('Authorization', `Bearer ${token}`);
  expect(listResponseSchema(roomBlockSchema).parse(empty.body).meta.total).toBe(0);
});
test('same create/delete keys replay once, including delete after row removal', async () => {
  const token = await login(),
    key = randomUUID(),
    first = await post(token, key).send(payload());
  expect(first.status).toBe(201);
  const again = await post(token, key).send(payload());
  expect(again.status).toBe(201);
  expect(again.body).toEqual(first.body);
  expect(again.headers['idempotency-replayed']).toBe('true');
  const deleteKey = randomUUID();
  expect((await del(token, roomBlockSchema.parse(first.body).id, deleteKey)).status).toBe(204);
  const replay = await del(token, roomBlockSchema.parse(first.body).id, deleteKey);
  expect(replay.status).toBe(204);
  expect(replay.headers['idempotency-replayed']).toBe('true');
  expect(
    (
      await rows("SELECT action FROM audit_logs WHERE entity_id=$1 AND entity_type='RoomBlock'", [
        roomBlockSchema.parse(first.body).id,
      ])
    )
      .map((r) => r.action)
      .sort(),
  ).toEqual(['ROOM_BLOCK_CREATED', 'ROOM_BLOCK_REMOVED']);
});
test('scope is checked before claim/replay and child IDs cannot cross properties', async () => {
  const token = await login(),
    key = randomUUID(),
    first = await post(token, key).send(payload());
  expect(first.status).toBe(201);
  await rows('DELETE FROM user_property_scopes WHERE user_id=$1', [userId]);
  const replay = await post(token, key).send(payload());
  expect(replay.status).toBe(403);
  expect(errorBodySchema.parse(replay.body).code).toBe('E_AUTH_OUT_OF_SCOPE');
  const wrong = await post(token).send({ ...payload(), roomId: otherRoomId });
  expect(wrong.status).toBe(403);
  for (const query of [{ propertyId: otherPropertyId }, { roomId: otherRoomId }]) {
    const result = await http()
      .get('/api/v1/room-blocks')
      .query(query)
      .set('Authorization', `Bearer ${token}`);
    expect(result.status).toBe(403);
  }
  const list = await http().get('/api/v1/room-blocks').set('Authorization', `Bearer ${token}`);
  expect(list.status).toBe(200);
  expect(listResponseSchema(roomBlockSchema).parse(list.body).data).toEqual([]);
  expect((await del(token, roomBlockSchema.parse(first.body).id)).status).toBe(403);
});
test('FRONT_DESK overlap is forbidden and a newly elevated MANAGER opens cases through real auth', async () => {
  const b = await booking();
  await assign(b.room);
  const token = await login('FRONT_DESK');
  expect((await post(token).send(payload())).status).toBe(403);
  await rows("UPDATE users SET role='MANAGER' WHERE id=$1", [userId]);
  expect((await post(token).send(payload())).status).toBe(201);
  expect((await rows('SELECT id FROM overbooking_cases')).length).toBe(3);
});
for (const change of [
  { startDate: '2026-02-30' },
  { endDate: '2026-11-01' },
  { endDate: '2026-10-31' },
  { reason: '' },
  { roomId: 'invalid' },
  { note: '' },
])
  test(`invalid request ${JSON.stringify(change)} has no block/audit/claim`, async () => {
    const token = await login(),
      result = await post(token).send({ ...payload(), ...change });
    expect(result.status).toBe(400);
    expect(await rows('SELECT id FROM room_blocks')).toEqual([]);
    expect(await rows('SELECT id FROM idempotency_keys')).toEqual([]);
  });
test('missing idempotency key and missing deletion reason reject without changing inventory', async () => {
  const token = await login();
  const missingKey = await http()
    .post('/api/v1/room-blocks')
    .set('Authorization', `Bearer ${token}`)
    .send(payload());
  expect(missingKey.status).toBe(400);
  const first = await post(token).send(payload());
  expect(first.status).toBe(201);
  const result = await http()
    .delete(`/api/v1/room-blocks/${roomBlockSchema.parse(first.body).id}`)
    .set('Authorization', `Bearer ${token}`)
    .set('Idempotency-Key', randomUUID());
  expect(result.status).toBe(400);
  expect((await rows('SELECT id FROM room_blocks')).length).toBe(1);
});
test('list applies date overlap, mandatory property scope and stable UUID cursor pagination', async () => {
  const token = await login();
  for (let i = 0; i < 3; i++) expect((await post(token).send(payload())).status).toBe(201);
  const first = await http()
    .get('/api/v1/room-blocks')
    .query({ limit: 2, from: '2026-11-02', to: '2026-11-03' })
    .set('Authorization', `Bearer ${token}`);
  expect(first.status).toBe(200);
  const page = listResponseSchema(roomBlockSchema).parse(first.body);
  expect(page.meta).toMatchObject({ total: 3, hasMore: true, limit: 2 });
  const second = await http()
    .get('/api/v1/room-blocks')
    .query({ limit: 2, cursor: page.meta.nextCursor! })
    .set('Authorization', `Bearer ${token}`);
  expect(second.status).toBe(200);
  expect(listResponseSchema(roomBlockSchema).parse(second.body).data).toHaveLength(1);
  expect(page.data.map((r) => r.id)).not.toContain(
    listResponseSchema(roomBlockSchema).parse(second.body).data[0]!.id,
  );
  const boundary = await http()
    .get('/api/v1/room-blocks')
    .query({ from: '2026-11-04' })
    .set('Authorization', `Bearer ${token}`);
  expect(boundary.status).toBe(200);
  expect(listResponseSchema(roomBlockSchema).parse(boundary.body).data).toEqual([]);
});

test('operational note and deletion reason mask phone/email/ID before audit, replay and HOUSEKEEPING reads', async () => {
  const token = await login(),
    key = randomUUID(),
    note = 'Repair contact +84 900 000 034, synthetic.guest@example.test, CCCD 012345678934';
  const response = await post(token, key).send({ ...payload(), note });
  expect(response.status).toBe(201);
  const dto = roomBlockSchema.parse(response.body);
  const safe = 'Repair contact ****0034, ****test, CCCD ****8934';
  expect(dto.note).toBe(safe);
  const replay = await post(token, key).send({ ...payload(), note });
  expect(roomBlockSchema.parse(replay.body).note).toBe(safe);
  const altered = await post(token, key).send({ ...payload(), note: note.replace('900', '800') });
  expect(altered.status).toBe(409);
  expect(errorBodySchema.parse(altered.body).code).toBe('E_SYS_IDEMPOTENCY_KEY_REUSED');
  const housekeeping = await login('HOUSEKEEPING');
  const list = await http()
    .get('/api/v1/room-blocks')
    .set('Authorization', `Bearer ${housekeeping}`);
  expect(list.status).toBe(200);
  expect(listResponseSchema(roomBlockSchema).parse(list.body).data[0]!.note).toBe(safe);
  await rows("UPDATE users SET role='MANAGER' WHERE id=$1", [userId]);
  expect((await del(token, dto.id, randomUUID(), note)).status).toBe(204);
  const audit = await rows(
    "SELECT before_json,after_json,reason FROM audit_logs WHERE entity_type='RoomBlock' AND entity_id=$1",
    [dto.id],
  );
  const text = JSON.stringify(audit);
  for (const pii of ['900 000 034', 'synthetic.guest@example.test', '012345678934'])
    expect(text).not.toContain(pii);
  expect(audit.find((r) => r.before_json !== null)!.reason).toBe(safe);
});

test('a maximum date-span block completes without enumerating empty years, cases visit only actual demand nights', async () => {
  const token = await login();
  const b = await booking();
  await assign(b.room);
  const result = await post(token)
    .send({ ...payload(), startDate: '0001-01-01', endDate: '9999-12-31' })
    .timeout({ response: 2000, deadline: 3000 });
  expect(result.status).toBe(201);
  expect(
    await rows('SELECT date::text,shortage_count FROM overbooking_cases ORDER BY date'),
  ).toEqual([
    { date: '2026-11-01', shortage_count: 1 },
    { date: '2026-11-02', shortage_count: 1 },
    { date: '2026-11-03', shortage_count: 1 },
  ]);
});
