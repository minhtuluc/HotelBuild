import { expect, test } from 'vitest';
import {
  listResponseSchema,
  propertySummarySchema,
  propertyPublicSummarySchema,
  roomTypeSummarySchema,
  roomSummarySchema,
  errorBodySchema,
} from '@pinehill/contracts';
import { http, login, rows, userId, propId, otherId, typeId, dormId, rawPage } from './fixture.js';
const read = (path: string, token: string, query: Record<string, string | number> = {}) =>
  http()
    .get('/api/v1/' + path)
    .set('Authorization', `Bearer ${token}`)
    .query(query);
test('seed active properties total3, active rooms55 and exact minimal DTO', async () => {
  const response = await read('properties', await login(), { status: 'ACTIVE' });
  expect(response.status).toBe(200);
  const body = listResponseSchema(propertySummarySchema).parse(response.body);
  expect(body.meta.total).toBe(3);
  expect(body.data.map((x) => x.activeRoomCount).sort((a, b) => a - b)).toEqual([13, 18, 24]);
  expect(Object.keys(rawPage(response.body).data[0]!).sort()).toEqual(
    [
      'id',
      'name',
      'status',
      'activeRoomCount',
      'overbookLimitPct',
      'checkInTime',
      'checkOutTime',
      'version',
    ].sort(),
  );
  expect(response.headers['cache-control']).toBe('no-store');
});
test('public properties expose only public metadata and active rows without auth', async () => {
  const r = await http().get('/api/v1/public/properties');
  expect(r.status).toBe(200);
  const p = listResponseSchema(propertyPublicSummarySchema).parse(r.body);
  expect(p.meta.total).toBe(3);
  expect(Object.keys(rawPage(r.body).data[0]!).sort()).toEqual(
    ['id', 'name', 'checkInTime', 'checkOutTime'].sort(),
  );
});
test('room types use actual active selling units: CS01=34, DOR6bed, STD2bed', async () => {
  const r = await read('room-types', await login(), { propertyId: propId });
  expect(r.status).toBe(200);
  const p = listResponseSchema(roomTypeSummarySchema).parse(r.body);
  expect(p.meta.total).toBe(5);
  expect(p.data.reduce((n, x) => n + x.sellingUnits!, 0)).toBe(34);
  expect(p.data.find((x) => x.id === dormId)?.bedCount).toBe(6);
  expect(p.data.find((x) => x.id === typeId)?.bedCount).toBe(2);
});
test('rooms match scoped seed and include numeric microsecond version', async () => {
  const r = await read('rooms', await login('MANAGER'), { propertyId: propId });
  expect(r.status).toBe(200);
  const p = listResponseSchema(roomSummarySchema).parse(r.body);
  expect(p.meta.total).toBe(24);
  expect(
    p.data.every(
      (x) =>
        x.propertyId === propId && Number.isSafeInteger(x.version) && x.version > 1000000000000000,
    ),
  ).toBe(true);
});
for (const role of ['OWNER', 'MANAGER', 'FRONT_DESK', 'HOUSEKEEPING'])
  test(`${role} reads only granted scope except explicit OWNER chain access`, async () => {
    const token = await login(role);
    for (const path of ['properties', 'room-types', 'rooms']) {
      const r = await read(path, token);
      expect(r.status).toBe(200);
      if (role !== 'OWNER')
        expect(rawPage(r.body).data.every((x) => (x.propertyId ?? x.id) === propId)).toBe(true);
    }
  });
for (const role of ['RESERVATION_AGENT', 'ACCOUNTANT', 'SYSADMIN'])
  test(`${role} has no internal PROP read permission`, async () => {
    const token = await login(role);
    for (const path of ['properties', 'room-types', 'rooms'])
      expect((await read(path, token)).status).toBe(403);
  });
test('scope cannot be widened by property or a room type from another property', async () => {
  const token = await login('MANAGER');
  const foreign = String(
    (await rows('SELECT id FROM room_types WHERE property_id=$1 LIMIT 1', [otherId]))[0]!.id,
  );
  for (const [path, q] of [
    ['room-types', { propertyId: otherId }],
    ['rooms', { roomTypeId: foreign }],
    ['rooms', { propertyId: propId, roomTypeId: foreign }],
  ] as const) {
    const r = await read(path, token, q);
    expect(r.status).toBe(403);
    expect(errorBodySchema.parse(r.body).code).toBe('E_AUTH_OUT_OF_SCOPE');
  }
});
test('empty property scope returns zero filtered rows and count', async () => {
  const token = await login('HOUSEKEEPING');
  await rows('DELETE FROM user_property_scopes WHERE user_id=$1', [userId]);
  for (const path of ['properties', 'room-types', 'rooms']) {
    const r = await read(path, token);
    expect(r.status).toBe(200);
    expect(rawPage(r.body).data).toEqual([]);
    expect(rawPage(r.body).meta.total).toBe(0);
  }
});
test('strict query validation and cursor belongs to filtered set', async () => {
  const token = await login();
  for (const query of [
    { status: 'BAD' },
    { limit: 0 },
    { propertyId: 'bad' },
    { unknown: 'x' },
    { cursor: 'bad' },
  ])
    expect((await read('rooms', token, query)).status).toBe(400);
  const one = await read('rooms', token, { propertyId: propId, limit: 1 });
  expect(one.status).toBe(200);
  expect(rawPage(one.body).meta.total).toBe(24);
  expect(rawPage(one.body).meta.hasMore).toBe(true);
  const next = await read('rooms', token, {
    propertyId: propId,
    limit: 1,
    cursor: rawPage(one.body).meta.nextCursor!,
  });
  expect(next.status).toBe(200);
  expect(rawPage(next.body).data[0]!.id).not.toBe(rawPage(one.body).data[0]!.id);
  expect(
    (
      await read('rooms', token, {
        propertyId: otherId,
        cursor: rawPage(one.body).meta.nextCursor!,
      })
    ).status,
  ).toBe(400);
});
