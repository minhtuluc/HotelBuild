import { randomUUID } from 'node:crypto';
import { expect, test } from 'vitest';
import {
  propertySummarySchema,
  roomTypeSummarySchema,
  roomSummarySchema,
  errorBodySchema,
} from '@pinehill/contracts';
import {
  http,
  login,
  rows,
  userId,
  propId,
  otherId,
  typeId,
  emptyPropId,
  roomId,
  secondRoomId,
  otherRoomId,
  tag,
  write,
} from './fixture.js';
const newType = () => ({
  propertyId: emptyPropId,
  code: 'STD',
  capacityAdults: 2,
  capacityChildren: 0,
  basePrice: 650000,
  minPrice: 400000,
  maxPrice: 1800000,
  allowShared: false,
  bedCount: 2,
});
const roomInput = () => ({ propertyId: propId, roomTypeId: typeId, code: 'CS01-901', floor: 9 });
const audits = async (id: string) =>
  Number((await rows('SELECT count(*) AS n FROM audit_logs WHERE entity_id=$1', [id]))[0]!.n);
test('OWNER changes property: exact published DTO, ETag, version+1 and audit in same TX', async () => {
  const token = await login(),
    before = await tag('properties', propId, token),
    n = await audits(propId);
  const r = await write(
    'patch',
    'properties/' + propId,
    token,
    { overbookLimitPct: 5, checkInTime: '15:30', reason: 'Synthetic' },
    before,
  );
  expect(r.status).toBe(200);
  const body = propertySummarySchema.parse(r.body);
  expect(body.overbookLimitPct).toBe(5);
  expect(body.checkInTime).toBe('15:30');
  expect(body.version).toBe(Number(before.slice(1, -1)) + 1);
  expect(r.headers.etag).toBe('"' + body.version + '"');
  expect(await audits(propId)).toBe(n + 1);
  const a = (
    await rows(
      'SELECT before_json,after_json FROM audit_logs WHERE entity_id=$1 ORDER BY chain_seq DESC LIMIT 1',
      [propId],
    )
  )[0]!;
  expect(a.after_json).toMatchObject({ propertyId: propId, overbookLimitPct: 5 });
});
test('OWNER creates type then patches bounds using current version; canonical beds survive empty rooms', async () => {
  const token = await login();
  const created = await write('post', 'room-types', token, newType());
  expect(created.status).toBe(201);
  const before = roomTypeSummarySchema.parse(created.body);
  expect(before.bedCount).toBe(2);
  expect(before.sellingUnits).toBe(0);
  const r = await write(
    'patch',
    'room-types/' + before.id,
    token,
    { basePrice: 700000, reason: 'Synthetic' },
    '"' + before.version + '"',
  );
  expect(r.status).toBe(200);
  expect(roomTypeSummarySchema.parse(r.body).basePrice).toBe(700000);
  expect(await audits(before.id)).toBe(2);
});
test('MANAGER creates and patches physical room; monotonic room token and persisted note', async () => {
  const token = await login('MANAGER');
  const created = await write('post', 'rooms', token, roomInput());
  expect(created.status).toBe(201);
  const before = roomSummarySchema.parse(created.body);
  const r = await write(
    'patch',
    'rooms/' + before.id,
    token,
    { floor: 8, note: 'Synthetic', reason: 'Synthetic' },
    '"' + before.version + '"',
  );
  expect(r.status).toBe(200);
  const after = roomSummarySchema.parse(r.body);
  expect(after.floor).toBe(8);
  expect(after.version).toBeGreaterThan(before.version);
  expect(r.headers.etag).toBe('"' + after.version + '"');
  expect(
    (await rows('SELECT note,bed_count FROM rooms WHERE id=$1', [before.id]))[0],
  ).toMatchObject({ note: 'Synthetic', bed_count: 2 });
  expect(await audits(before.id)).toBe(2);
});
test('connecting is symmetric and both room versions advance; unlink clears both in one TX', async () => {
  const token = await login('MANAGER'),
    a = await tag('rooms', roomId, token),
    b = await tag('rooms', secondRoomId, token);
  const r = await write(
    'put',
    'rooms/' + roomId + '/connecting-room',
    token,
    { connectingRoomId: secondRoomId },
    a,
  );
  expect(r.status).toBe(200);
  expect(roomSummarySchema.parse(r.body).connectingRoomId).toBe(secondRoomId);
  expect(
    (await rows('SELECT connecting_room_id FROM rooms WHERE id=$1', [secondRoomId]))[0]!
      .connecting_room_id,
  ).toBe(roomId);
  expect(await tag('rooms', secondRoomId, token)).not.toBe(b);
  const cleared = await write(
    'put',
    'rooms/' + secondRoomId + '/connecting-room',
    token,
    { connectingRoomId: null },
    await tag('rooms', secondRoomId, token),
  );
  expect(cleared.status).toBe(200);
  expect(
    (
      await rows('SELECT connecting_room_id FROM rooms WHERE id=ANY($1::uuid[])', [
        [roomId, secondRoomId],
      ])
    ).every((x) => x.connecting_room_id === null),
  ).toBe(true);
});
test('relink detaches old reciprocal partners, including target old partner', async () => {
  const token = await login('MANAGER');
  const ids = (
    await rows('SELECT id FROM rooms WHERE room_type_id=$1 ORDER BY code LIMIT 4', [typeId])
  ).map((x) => String(x.id));
  await rows('UPDATE rooms SET connecting_room_id=$2 WHERE id=$1', [ids[0], ids[1]]);
  await rows('UPDATE rooms SET connecting_room_id=$1 WHERE id=$2', [ids[0], ids[1]]);
  await rows('UPDATE rooms SET connecting_room_id=$2 WHERE id=$1', [ids[2], ids[3]]);
  await rows('UPDATE rooms SET connecting_room_id=$1 WHERE id=$2', [ids[2], ids[3]]);
  const r = await write(
    'put',
    'rooms/' + ids[0] + '/connecting-room',
    token,
    { connectingRoomId: ids[2] },
    await tag('rooms', ids[0]!, token),
  );
  expect(r.status).toBe(200);
  const graph = await rows('SELECT id,connecting_room_id FROM rooms WHERE id=ANY($1::uuid[])', [
    ids,
  ]);
  expect(new Map(graph.map((x) => [x.id, x.connecting_room_id]))).toEqual(
    new Map([
      [ids[0], ids[2]],
      [ids[1], null],
      [ids[2], ids[0]],
      [ids[3], null],
    ]),
  );
});
test('missing/malformed/stale IfMatch produce428/412 without mutation', async () => {
  const token = await login(),
    n = await audits(propId);
  for (const [header, status] of [
    [null, 428],
    ['2', 412],
    ['"0"', 412],
    ['"999999"', 412],
  ] as const) {
    const r = await write(
      'patch',
      'properties/' + propId,
      token,
      { name: 'Synthetic', reason: 'Synthetic' },
      header,
    );
    expect(r.status).toBe(status);
  }
  expect(await audits(propId)).toBe(n);
});
for (const role of ['HOUSEKEEPING', 'FRONT_DESK', 'RESERVATION_AGENT', 'ACCOUNTANT', 'SYSADMIN'])
  test(`${role} cannot write property/type/room/link`, async () => {
    const token = await login(role);
    for (const [method, path, body] of [
      ['patch', 'properties/' + propId, { name: 'Synthetic' }],
      ['post', 'room-types', newType()],
      ['post', 'rooms', roomInput()],
      ['patch', 'rooms/' + roomId, { floor: 8 }],
      ['put', 'rooms/' + roomId + '/connecting-room', { connectingRoomId: secondRoomId }],
    ] as const)
      expect((await write(method, path, token, body, '"1"')).status).toBe(403);
  });
test('MANAGER cannot write OWNER configs or cross scope room/type resources', async () => {
  const token = await login('MANAGER');
  expect(
    (await write('patch', 'properties/' + propId, token, { name: 'Synthetic' }, '"1"')).status,
  ).toBe(403);
  expect((await write('post', 'room-types', token, newType())).status).toBe(403);
  const r = await write('post', 'rooms', token, { ...roomInput(), propertyId: otherId });
  expect(r.status).toBe(403);
  expect(errorBodySchema.parse(r.body).code).toBe('E_AUTH_OUT_OF_SCOPE');
  const x = await write('patch', 'rooms/' + otherRoomId, token, { floor: 8 }, '"1"');
  expect(x.status).toBe(403);
});
test('strict validation: HH:mm, max5percent, nonempty reason, no actor injection', async () => {
  const token = await login(),
    version = await tag('properties', propId, token);
  for (const body of [
    { checkInTime: '24:01', reason: 'Synthetic' },
    { overbookLimitPct: 6, reason: 'Synthetic' },
    { name: 'X' },
    { name: 'X', reason: ' ' },
    { name: 'X', reason: 'Synthetic', actorId: randomUUID() },
  ])
    expect((await write('patch', 'properties/' + propId, token, body, version)).status).toBe(400);
});
test('type bounds and canonical beds fail422; unsafe or fractional money never stored', async () => {
  const token = await login();
  for (const body of [
    { ...newType(), minPrice: 700000 },
    { ...newType(), basePrice: 0.1 },
    { ...newType(), basePrice: Number.MAX_SAFE_INTEGER + 1 },
    { ...newType(), bedCount: 3 },
  ]) {
    const r = await write('post', 'room-types', token, body);
    expect(r.status).toBe(422);
    expect(errorBodySchema.parse(r.body).code).toBe('E_RATE_CONFIGURATION_INVALID');
  }
  expect(
    (await rows('SELECT count(*) AS n FROM room_types WHERE property_id=$1', [emptyPropId]))[0]!.n,
  ).toBe('0');
});
test('new room code follows BR, duplicates409, cross-property type rejected', async () => {
  const token = await login('MANAGER');
  expect((await write('post', 'rooms', token, { ...roomInput(), code: 'RANDOM' })).status).toBe(
    400,
  );
  const first = await write('post', 'rooms', token, roomInput());
  expect(first.status).toBe(201);
  expect((await write('post', 'rooms', token, roomInput())).status).toBe(409);
  const foreign = String(
    (await rows('SELECT id FROM room_types WHERE property_id=$1 LIMIT 1', [otherId]))[0]!.id,
  );
  expect(
    (await write('post', 'rooms', token, { ...roomInput(), roomTypeId: foreign })).status,
  ).toBe(403);
});
test('same-key replay stores one result; scope revocation denies replay', async () => {
  const token = await login('MANAGER'),
    key = randomUUID(),
    version = await tag('rooms', roomId, token),
    n = await audits(roomId),
    body = { floor: 9, reason: 'Synthetic' };
  const one = await write('patch', 'rooms/' + roomId, token, body, version, key);
  expect(one.status).toBe(200);
  const two = await write('patch', 'rooms/' + roomId, token, body, version, key);
  expect(two.status).toBe(200);
  expect(two.body).toEqual(one.body);
  expect(two.headers.etag).toBe(one.headers.etag);
  expect(two.headers['idempotency-replayed']).toBe('true');
  expect(await audits(roomId)).toBe(n + 1);
  await rows('DELETE FROM user_property_scopes WHERE user_id=$1', [userId]);
  expect((await write('patch', 'rooms/' + roomId, token, body, version, key)).status).toBe(403);
});
test('audit rejection rolls back value/version and idempotency claim', async () => {
  const token = await login(),
    version = await tag('properties', propId, token),
    key = randomUUID();
  await rows(
    "ALTER TABLE audit_logs ADD CONSTRAINT hb033_reject CHECK(action NOT LIKE 'PROP_%') NOT VALID",
  );
  try {
    expect(
      (
        await write(
          'patch',
          'properties/' + propId,
          token,
          { overbookLimitPct: 5, reason: 'Synthetic' },
          version,
          key,
        )
      ).status,
    ).toBe(500);
    expect(await tag('properties', propId, token)).toBe(version);
    expect(
      (await rows('SELECT count(*) AS n FROM idempotency_keys WHERE key=$1', [key]))[0]!.n,
    ).toBe('0');
  } finally {
    await rows('ALTER TABLE audit_logs DROP CONSTRAINT hb033_reject');
  }
});
test('reason and room note redact labeled PII/secrets in stored data and audit', async () => {
  const token = await login('MANAGER');
  const r = await write(
    'patch',
    'rooms/' + roomId,
    token,
    { note: 'passport: ABC123456789; token=hb033-secret', reason: 'password=hb033-secret' },
    await tag('rooms', roomId, token),
  );
  expect(r.status).toBe(200);
  const stored = await rows('SELECT note FROM rooms WHERE id=$1', [roomId]);
  expect(JSON.stringify(stored)).not.toContain('ABC123456789');
  expect(JSON.stringify(stored)).not.toContain('hb033-secret');
  const a = await rows(
    'SELECT before_json,after_json,reason FROM audit_logs WHERE entity_id=$1 ORDER BY chain_seq DESC LIMIT 1',
    [roomId],
  );
  expect(JSON.stringify(a)).not.toContain('hb033-secret');
});
test('self/cross-property link rejected and no DELETE resource routes', async () => {
  const token = await login();
  for (const target of [roomId, otherRoomId])
    expect(
      (
        await write(
          'put',
          'rooms/' + roomId + '/connecting-room',
          token,
          { connectingRoomId: target },
          await tag('rooms', roomId, token),
        )
      ).status,
    ).toBe(400);
  for (const path of ['properties/' + propId, 'room-types/' + typeId, 'rooms/' + roomId])
    expect(
      (
        await http()
          .delete('/api/v1/' + path)
          .set('Authorization', `Bearer ${token}`)
      ).status,
    ).toBe(404);
});

test('DOR cannot become whole-room inventory through allowShared=false', async () => {
  const token = await login();
  const r = await write('post', 'room-types', token, {
    ...newType(),
    code: 'DOR',
    capacityAdults: 6,
    bedCount: 6,
    allowShared: false,
  });
  expect(r.status).toBe(422);
  expect(errorBodySchema.parse(r.body).code).toBe('E_RATE_CONFIGURATION_INVALID');
  expect(
    (
      await rows("SELECT count(*) AS n FROM room_types WHERE property_id=$1 AND code='DOR'", [
        emptyPropId,
      ])
    )[0]!.n,
  ).toBe('0');
});
test('room type status changes appear in response and both audit snapshots', async () => {
  const token = await login(),
    created = await write('post', 'room-types', token, newType());
  expect(created.status).toBe(201);
  const before = roomTypeSummarySchema.parse(created.body),
    r = await write(
      'patch',
      'room-types/' + before.id,
      token,
      { status: 'INACTIVE', reason: 'Synthetic' },
      '"' + before.version + '"',
    );
  expect(r.status).toBe(200);
  const body: unknown = r.body;
  expect(body).toMatchObject({ status: 'INACTIVE' });
  const a = (
    await rows(
      'SELECT before_json,after_json FROM audit_logs WHERE entity_id=$1 ORDER BY chain_seq DESC LIMIT 1',
      [before.id],
    )
  )[0]!;
  expect(a.before_json).toMatchObject({ status: 'ACTIVE' });
  expect(a.after_json).toMatchObject({ status: 'INACTIVE' });
});
