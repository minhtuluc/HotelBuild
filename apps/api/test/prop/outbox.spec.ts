import { randomUUID } from 'node:crypto';
import { expect, test } from 'vitest';
import {
  propertySummarySchema,
  roomTypeSummarySchema,
  roomSummarySchema,
} from '@pinehill/contracts';
import {
  login,
  rows,
  propId,
  typeId,
  roomId,
  secondRoomId,
  tag,
  write,
  emptyPropId,
} from './fixture.js';
const events = async (id: string) =>
  await rows(
    'SELECT event_type,payload_json FROM outbox_events WHERE aggregate_id=$1 ORDER BY created_at,id',
    [id],
  );
const auditCount = async (id: string) =>
  Number((await rows('SELECT count(*) AS n FROM audit_logs WHERE entity_id=$1', [id]))[0]!.n);
test('base price command and durable replay produce exactly one RateChanged and one inventory signal', async () => {
  const token = await login(),
    version = await tag('room-types', typeId, token),
    key = randomUUID(),
    old = (await events(typeId)).length;
  const body = { basePrice: 700000, reason: 'Synthetic' };
  const first = await write('patch', 'room-types/' + typeId, token, body, version, key);
  expect(first.status).toBe(200);
  const second = await write('patch', 'room-types/' + typeId, token, body, version, key);
  expect(second.status).toBe(200);
  const current = (await events(typeId)).slice(old);
  expect(current.map((x) => x.event_type).sort()).toEqual(['InventoryChanged', 'RateChanged']);
  for (const event of current)
    expect(event.payload_json).toMatchObject({
      schemaVersion: 1,
      entityType: 'RoomType',
      entityId: typeId,
      propertyId: propId,
      version: roomTypeSummarySchema.parse(first.body).version,
    });
});
test('property availability configuration emits a versioned whole-property inventory signal', async () => {
  const token = await login(),
    version = await tag('properties', propId, token),
    old = (await events(propId)).length;
  const response = await write(
    'patch',
    'properties/' + propId,
    token,
    { overbookLimitPct: 5, reason: 'Synthetic' },
    version,
  );
  expect(response.status).toBe(200);
  const current = (await events(propId)).slice(old);
  expect(current).toHaveLength(1);
  expect(current[0]!.event_type).toBe('InventoryChanged');
  expect(current[0]!.payload_json).toMatchObject({
    propertyId: propId,
    entityType: 'Property',
    entityId: propId,
    version: propertySummarySchema.parse(response.body).version,
    scope: 'ALL_DATES',
  });
});
test('creating a type has price and inventory configuration events without fabricated date bounds', async () => {
  const token = await login();
  const response = await write('post', 'room-types', token, {
    propertyId: emptyPropId,
    code: 'STD',
    capacityAdults: 2,
    capacityChildren: 0,
    basePrice: 650000,
    minPrice: 400000,
    maxPrice: 1800000,
    allowShared: false,
  });
  expect(response.status).toBe(201);
  const current = await events(roomTypeSummarySchema.parse(response.body).id);
  expect(current.map((x) => x.event_type).sort()).toEqual(['InventoryChanged', 'RateChanged']);
});
test('physical room creation and status changes each create one inventory outbox signal', async () => {
  const token = await login('MANAGER');
  const created = await write('post', 'rooms', token, {
    propertyId: propId,
    roomTypeId: typeId,
    code: 'CS01-901',
    floor: 9,
  });
  expect(created.status).toBe(201);
  const room = roomSummarySchema.parse(created.body);
  expect(await events(room.id)).toHaveLength(1);
  const updated = await write(
    'patch',
    'rooms/' + room.id,
    token,
    { status: 'MAINTENANCE' },
    '"' + room.version + '"',
  );
  expect(updated.status).toBe(200);
  const current = await events(room.id);
  expect(current).toHaveLength(2);
  expect(current.every((x) => x.event_type === 'InventoryChanged')).toBe(true);
  expect(current[1]!.payload_json).toMatchObject({
    propertyId: propId,
    roomTypeId: typeId,
    version: roomSummarySchema.parse(updated.body).version,
    scope: 'ALL_DATES',
  });
});
test('link configuration signals the whole property and every affected room for a cross-type graph', async () => {
  const token = await login('MANAGER'),
    version = await tag('rooms', roomId, token),
    old = (await events(roomId)).length;
  const target = String(
    (
      await rows('SELECT id FROM rooms WHERE property_id=$1 AND room_type_id<>$2 LIMIT 1', [
        propId,
        typeId,
      ])
    )[0]!.id,
  );
  const response = await write(
    'put',
    'rooms/' + roomId + '/connecting-room',
    token,
    { connectingRoomId: target },
    version,
  );
  expect(response.status).toBe(200);
  const current = (await events(roomId)).slice(old);
  expect(current).toHaveLength(1);
  expect(current[0]!.payload_json).toMatchObject({
    entityId: roomId,
    propertyId: propId,
    scope: 'ALL_DATES',
    affectedRoomIds: [roomId, target].sort(),
  });
});
function scenario(resource: string): {
  kind: 'properties' | 'room-types' | 'rooms';
  id: string;
  body: object;
  path: string;
  method: 'put' | 'patch';
} {
  const kind =
      resource === 'property' ? 'properties' : resource === 'type' ? 'room-types' : 'rooms',
    id = resource === 'property' ? propId : resource === 'type' ? typeId : roomId;
  const body =
    resource === 'property'
      ? { overbookLimitPct: 5, reason: 'Synthetic' }
      : resource === 'type'
        ? { basePrice: 700000, reason: 'Synthetic' }
        : resource === 'link'
          ? { connectingRoomId: secondRoomId }
          : { status: 'MAINTENANCE' };
  return {
    kind,
    id,
    body,
    path: kind + '/' + id + (resource === 'link' ? '/connecting-room' : ''),
    method: resource === 'link' ? 'put' : 'patch',
  };
}
for (const resource of ['property', 'type', 'room', 'link'])
  test(`outbox rejection rolls back ${resource} data, version, all audits and claim`, async () => {
    const { kind, id, body, path, method } = scenario(resource);
    const token = await login(),
      version = await tag(kind, id, token),
      key = randomUUID(),
      audits = await auditCount(id),
      old = (await events(id)).length;
    const literal = String((await rows('SELECT quote_literal($1) AS v', [id]))[0]!.v);
    await rows(
      'ALTER TABLE outbox_events ADD CONSTRAINT hb033_outbox_reject CHECK(aggregate_id <> ' +
        literal +
        '::uuid) NOT VALID',
    );
    try {
      expect((await write(method, path, token, body, version, key)).status).toBe(500);
      expect(await tag(kind, id, token)).toBe(version);
      expect(await auditCount(id)).toBe(audits);
      expect(await events(id)).toHaveLength(old);
      expect(
        (await rows('SELECT count(*) AS n FROM idempotency_keys WHERE key=$1', [key]))[0]!.n,
      ).toBe('0');
      if (resource === 'link')
        expect(
          (
            await rows('SELECT connecting_room_id FROM rooms WHERE id=ANY($1::uuid[])', [
              [roomId, secondRoomId],
            ])
          ).every((x) => x.connecting_room_id === null),
        ).toBe(true);
    } finally {
      await rows('ALTER TABLE outbox_events DROP CONSTRAINT hb033_outbox_reject');
    }
  });
