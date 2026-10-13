import { z } from 'zod';
import { beforeEach, expect, test } from 'vitest';
import { randomUUID } from 'node:crypto';
import { authorizeActor } from '../../src/common/actor/authorized-actor.js';
import { AuditWriter } from '../../src/infrastructure/audit/audit-writer.js';
import { RoomBlocksService } from '../../src/modules/prop/room-blocks/service.js';
import { IdempotencyStore } from '../../src/common/idempotency/store.js';
import { identifyRequest } from '../../src/common/idempotency/request.js';
import {
  db,
  rows,
  clock,
  ids,
  userId,
  propertyId,
  roomId,
  room2Id,
  dormId,
  stay,
  booking,
  assign,
} from './inventory-seed.js';
export const actor = (role = 'MANAGER', scope = [propertyId]) =>
  authorizeActor(
    {
      id: userId,
      role,
      ip: null,
      correlationId: 'synthetic',
      sessionId: randomUUID(),
      surface: 'OPS_WEB',
      mustChangePassword: false,
    },
    scope,
    { allows: () => true },
  );
export const service = () => new RoomBlocksService(db, clock, ids, new AuditWriter(clock));
export const input = () => ({
  roomId,
  startDate: stay.checkIn,
  endDate: stay.checkOut,
  reason: 'MAINTENANCE' as const,
  note: 'Synthetic repair',
});
beforeEach(async () => {
  // Persisted identity agrees with the default actor used by these direct use-case tests.
  await rows("UPDATE users SET role='MANAGER' WHERE id=$1", [userId]);
});
export async function create(role = 'MANAGER', command = input()) {
  await rows('UPDATE users SET role=$1 WHERE id=$2', [role, userId]);
  return db.$transaction((tx) => service().create(tx, actor(role), command));
}
test('TC-PROP-04: FRONT_DESK rejects overlap, MANAGER commits block, audit and one case per affected night', async () => {
  const b = await booking();
  await assign(b.room);
  await booking({ channel: 'OTA_BOOKING', oversold: true });
  await expect(create('FRONT_DESK')).rejects.toMatchObject({
    status: 403,
    code: 'E_RBAC_FORBIDDEN',
  });
  expect(await rows('SELECT id FROM room_blocks')).toEqual([]);
  expect(await rows('SELECT id FROM overbooking_cases')).toEqual([]);
  const result = await create();
  expect(result).toMatchObject(input());
  expect(
    await rows('SELECT date::text,shortage_count,status FROM overbooking_cases ORDER BY date'),
  ).toEqual([
    { date: '2026-11-01', shortage_count: 1, status: 'OPEN' },
    { date: '2026-11-02', shortage_count: 1, status: 'OPEN' },
    { date: '2026-11-03', shortage_count: 1, status: 'OPEN' },
  ]);
  expect(
    (
      await rows(
        "SELECT after_json FROM audit_logs WHERE action='ROOM_BLOCK_CREATED' AND entity_id=$1",
        [result.id],
      )
    )[0]!.after_json,
  ).toMatchObject({ ...input(), propertyId });
});
for (const role of ['FRONT_DESK', 'MANAGER', 'OWNER'])
  test(`${role} creates a nonoverlapping block`, async () => {
    expect(await create(role)).toMatchObject(input());
  });
test('overlapping duplicate blocks form one shortage and one unresolved case per night', async () => {
  const b = await booking();
  await assign(b.room);
  await booking({ channel: 'OTA_AGODA' });
  await create();
  await create('OWNER');
  expect(
    (await rows('SELECT shortage_count FROM overbooking_cases')).map((r) => r.shortage_count),
  ).toEqual([1, 1, 1]);
  expect((await rows('SELECT id FROM room_blocks')).length).toBe(2);
});
test('blocked active assignment opens relocation cases even if another physical room is free', async () => {
  const b = await booking();
  await assign(b.room);
  await create();
  expect(
    (await rows('SELECT shortage_count FROM overbooking_cases')).map((r) => r.shortage_count),
  ).toEqual([1, 1, 1]);
});
test('full DOR block opens one case per night with the number of affected beds', async () => {
  const type = String(
    (await rows('SELECT room_type_id FROM rooms WHERE id=$1', [dormId]))[0]!.room_type_id,
  );
  for (const bed of [1, 2]) {
    const b = await booking({ type });
    await assign(b.room, dormId, stay.checkIn, stay.checkOut, bed);
  }
  await create('MANAGER', { ...input(), roomId: dormId });
  expect(
    (await rows('SELECT shortage_count FROM overbooking_cases')).map((r) => r.shortage_count),
  ).toEqual([2, 2, 2]);
});
test('DELETE requires reason and preserves full before snapshot including persisted note before hard deletion', async () => {
  const result = await create();
  await expect(
    db.$transaction((tx) => service().remove(tx, actor(), result.id, ' ')),
  ).rejects.toMatchObject({ status: 400 });
  await db.$transaction((tx) => service().remove(tx, actor(), result.id, 'Synthetic repaired'));
  expect(await rows('SELECT id FROM room_blocks')).toEqual([]);
  const log = (
    await rows(
      "SELECT before_json,reason FROM audit_logs WHERE action='ROOM_BLOCK_REMOVED' AND entity_id=$1",
      [result.id],
    )
  )[0]!;
  expect(log.reason).toBe('Synthetic repaired');
  expect(log.before_json).toMatchObject({
    id: result.id,
    room_id: roomId,
    created_by: userId,
    reason: 'MAINTENANCE',
    note: 'Synthetic repair',
    start_date: '2026-11-01',
    end_date: '2026-11-04',
  });
  expect(Object.keys(z.record(z.string(), z.unknown()).parse(log.before_json))).toEqual(
    expect.arrayContaining(['created_at', 'updated_at']),
  );
});
test('audit failure rolls back block, all cases and durable response in the actual command transaction', async () => {
  const b = await booking();
  await assign(b.room);
  const broken = new RoomBlocksService(db, clock, ids, new AuditWriter(clock));
  const store = new IdempotencyStore(db, clock, ids);
  const claim = await store.claim(
    identifyRequest(
      { type: 'USER', id: userId },
      {
        method: 'POST',
        url: '/room-blocks',
        headers: { 'idempotency-key': randomUUID() },
        body: input(),
      },
    ),
  );
  if (claim.kind !== 'claim') throw new Error('Fresh claim expected');
  await rows(
    "ALTER TABLE audit_logs ADD CONSTRAINT hb034_fail_create CHECK (action <> 'ROOM_BLOCK_CREATED') NOT VALID",
  );
  try {
    await expect(
      store.run(claim, async (tx) => ({
        status: 201,
        body: { ...(await broken.create(tx, actor(), input())) },
        headers: {},
      })),
    ).rejects.toThrow('Room block transaction failed');
  } finally {
    await rows('ALTER TABLE audit_logs DROP CONSTRAINT hb034_fail_create');
  }
  expect(await rows('SELECT id FROM room_blocks')).toEqual([]);
  expect(await rows('SELECT id FROM overbooking_cases')).toEqual([]);
  expect(await rows('SELECT id FROM idempotency_keys')).toEqual([]);
});
test('property scope remains enforced when use case is called directly', async () => {
  await expect(
    db.$transaction((tx) => service().create(tx, actor('MANAGER', []), input())),
  ).rejects.toMatchObject({ status: 403, code: 'E_AUTH_OUT_OF_SCOPE' });
});
test('a second room block detects unassigned commercial demand on its own affected nights', async () => {
  await booking({ channel: 'OTA_BOOKING', oversold: true });
  await booking({ channel: 'OTA_AIRBNB' });
  await create('FRONT_DESK', { ...input(), roomId: room2Id });
  expect(
    (await rows('SELECT shortage_count FROM overbooking_cases')).map((r) => r.shortage_count),
  ).toEqual([1, 1, 1]);
});
