import { expect, test } from 'vitest';
import { calculateAvailability } from '@pinehill/domain/inventory';
import { loadInventoryFacts } from '../../src/modules/inv/facts/loader.js';
import {
  db,
  rows,
  propertyId,
  otherPropertyId,
  typeId,
  dormTypeId,
  otherTypeId,
  roomId,
  room2Id,
  dormId,
  otherRoomId,
  stay,
  booking,
  assign,
  block,
  allotment,
} from './inventory-seed.js';
async function facts(
  type = typeId,
  property = propertyId,
  channel: 'WEB' | 'OTA_BOOKING' | 'AGENCY' = 'WEB',
) {
  return db.$transaction((tx) =>
    loadInventoryFacts(tx, {
      ...stay,
      propertyId: property,
      roomTypeId: type,
      channelCode: channel,
    }),
  );
}
function nightly(input: Awaited<ReturnType<typeof facts>>) {
  const result = calculateAvailability(input);
  if (result.ok) return result.value.nightly;
  if (result.error.code === 'E_INV_NO_AVAILABILITY') return result.error.availability.nightly;
  throw new Error(result.error.message);
}
test('loader expands regular units to bed0 and a DOR to six independently sellable beds', async () => {
  expect((await facts()).units.map((u) => u.bedNo)).toEqual([0, 0]);
  expect((await facts(dormTypeId)).units.map((u) => u.bedNo).sort()).toEqual([1, 2, 3, 4, 5, 6]);
  await block(dormId);
  expect(nightly(await facts(dormTypeId)).map((n) => n.supply)).toEqual([0, 0, 0]);
});
test('inactive rooms and overlapping blocks reduce supply by their union, not twice', async () => {
  await block();
  await block(roomId, '2026-11-02', '2026-11-03');
  expect(nightly(await facts()).map((n) => n.supply)).toEqual([1, 1, 1]);
  await rows("UPDATE rooms SET status='MAINTENANCE' WHERE id=$1", [room2Id]);
  expect(nightly(await facts()).map((n) => n.supply)).toEqual([0, 0, 0]);
});
test('demand includes all channels and unassigned oversold bookings without double-counting assignments', async () => {
  const first = await booking();
  await assign(first.room);
  await booking({ channel: 'OTA_BOOKING', oversold: true });
  const loaded = await facts();
  expect(new Set(loaded.demand.map((d) => d.channelCode))).toEqual(new Set(['WEB', 'OTA_BOOKING']));
  expect(nightly(loaded).map((n) => [n.supply, n.demand, n.pool, n.physicalAvailability])).toEqual([
    [2, 2, 0, 1],
    [2, 2, 0, 1],
    [2, 2, 0, 1],
  ]);
});
for (const status of [
  'HELD',
  'PENDING_PAYMENT',
  'CANCELLED',
  'EXPIRED',
  'DRAFT',
  'NO_SHOW',
  'CHECKED_OUT',
])
  test(`${status}: expired/inactive obligations do not retain physical or commercial availability`, async () => {
    const b = await booking({ status, deadline: new Date(0) });
    await assign(b.room);
    expect(nightly(await facts()).map((n) => [n.demand, n.physicalAvailability])).toEqual([
      [0, 2],
      [0, 2],
      [0, 2],
    ]);
  });
test('DB decision clock includes future holds and excludes exactly expired holds without Redis', async () => {
  const b = await booking({ status: 'PENDING_PAYMENT', deadline: new Date(Date.now() + 60000) });
  await assign(b.room);
  expect(nightly(await facts())[0]).toMatchObject({ demand: 1, physicalAvailability: 1 });
  await rows('UPDATE bookings SET hold_expires_at=clock_timestamp() WHERE id=$1', [b.id]);
  expect(nightly(await facts())[0]).toMatchObject({ demand: 0, physicalAvailability: 2 });
});
test('partial cancelled BookingRoom supplies inactive facts for its unreleased assignment', async () => {
  const b = await booking();
  await assign(b.room);
  await rows(
    "UPDATE booking_rooms SET status='CANCELLED',cancelled_at=clock_timestamp() WHERE id=$1",
    [b.room],
  );
  expect(nightly(await facts())[0]).toMatchObject({ demand: 0, physicalAvailability: 2 });
});
test('cross-property moves place allocated nights at actual destination and keep gaps at commitment', async () => {
  const b = await booking();
  await assign(b.room, roomId, '2026-11-01', '2026-11-02');
  await assign(b.room, otherRoomId, '2026-11-02', '2026-11-03');
  expect(nightly(await facts()).map((n) => [n.demand, n.physicalAvailability])).toEqual([
    [1, 1],
    [0, 2],
    [1, 2],
  ]);
  expect(
    nightly(await facts(otherTypeId, otherPropertyId)).map((n) => [
      n.demand,
      n.physicalAvailability,
    ]),
  ).toEqual([
    [0, 1],
    [1, 0],
    [0, 1],
  ]);
});
test('configured allotment and closed channel days override default quotas, used derives from demand', async () => {
  await allotment('OTA_BOOKING', 2);
  await booking({ channel: 'OTA_BOOKING' });
  expect(nightly(await facts(typeId, propertyId, 'OTA_BOOKING'))[0]).toMatchObject({
    used: 1,
    channelAvailability: 1,
  });
  await allotment('AGENCY', 2, true);
  expect(nightly(await facts(typeId, propertyId, 'AGENCY'))[0]).toMatchObject({
    channelAvailability: 0,
  });
});
