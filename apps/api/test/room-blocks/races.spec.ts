import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import pg from 'pg';
import { expect, test } from 'vitest';
import { authorizeActor } from '../../src/common/actor/authorized-actor.js';
import { AuditWriter } from '../../src/infrastructure/audit/audit-writer.js';
import { RoomBlocksService } from '../../src/modules/prop/room-blocks/service.js';
import { IdempotencyStore } from '../../src/common/idempotency/store.js';
import { identifyRequest } from '../../src/common/idempotency/request.js';
import { databaseUrl } from '../idempotency/database.js';
import {
  db,
  rows,
  clock,
  ids,
  userId,
  propertyId,
  typeId,
  roomId,
  booking,
  stay,
} from './inventory-seed.js';
const actor = () =>
  authorizeActor(
    {
      id: userId,
      role: 'MANAGER',
      ip: null,
      correlationId: 'synthetic',
      sessionId: randomUUID(),
      surface: 'OPS_WEB',
      mustChangePassword: false,
    },
    [propertyId],
    { allows: () => true },
  );
const input = () => ({
  roomId,
  startDate: stay.checkIn,
  endDate: stay.checkOut,
  reason: 'MAINTENANCE' as const,
});
async function owner() {
  const url = new URL(process.env.DATABASE_MIGRATION_URL!);
  url.pathname = new URL(databaseUrl).pathname;
  const client = new pg.Client({ connectionString: url.href });
  await client.connect();
  return client;
}
async function waiting(pid: number) {
  const until = Date.now() + 2500;
  while (Date.now() < until) {
    if (
      (
        await rows("SELECT pid FROM pg_stat_activity WHERE pid=$1 AND wait_event_type='Lock'", [
          pid,
        ])
      ).length
    )
      return;
    await delay(10);
  }
  throw new Error('Expected actual PostgreSQL lock waiter');
}
async function executeBlock() {
  const store = new IdempotencyStore(db, clock, ids),
    transactions: string[] = [],
    pids: number[] = [];
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
  if (claim.kind !== 'claim') throw new Error('Expected fresh claim');
  const run = store.run(claim, async (tx) => {
    const info = (
      await tx.$queryRaw<
        { id: string; pid: number }[]
      >`SELECT pg_current_xact_id()::text AS id,pg_backend_pid() AS pid`
    )[0]!;
    transactions.push(info.id);
    pids.push(info.pid);
    const result = await new RoomBlocksService(db, clock, ids, new AuditWriter(clock)).create(
      tx,
      actor(),
      input(),
    );
    return { status: 201, body: { ...result }, headers: {} };
  });
  return { run, transactions, pids };
}
async function firstPid(pids: number[]) {
  const until = Date.now() + 2000;
  while (pids.length === 0 && Date.now() < until) await delay(5);
  return pids[0]!;
}
test('new booking assignment wins between pre-read and resource lock: rollback, fresh attempt and no missing case', async () => {
  const b = await booking(),
    barrier = await owner(),
    writer = new pg.Client({ connectionString: databaseUrl });
  await writer.connect();
  let commit: Promise<pg.QueryResult> | undefined,
    operation: Awaited<ReturnType<typeof executeBlock>> | undefined;
  try {
    await barrier.query('BEGIN');
    await barrier.query('SELECT id FROM properties WHERE id=$1 FOR UPDATE', [propertyId]);
    await writer.query('BEGIN');
    await writer.query('SELECT id FROM bookings WHERE id=$1 FOR UPDATE', [b.id]);
    const pid = Number(
      (await writer.query<{ pid: number }>('SELECT pg_backend_pid() AS pid')).rows[0]!.pid,
    );
    const write = (async () => {
      await writer.query('SELECT id FROM properties WHERE id=$1 FOR UPDATE', [propertyId]);
      await writer.query('SELECT id FROM room_types WHERE id=$1 FOR UPDATE', [typeId]);
      await writer.query('SELECT id FROM rooms WHERE id=$1 FOR UPDATE', [roomId]);
      await writer.query(
        'INSERT INTO room_assignments(booking_room_id,room_id,start_date,end_date) VALUES($1,$2,$3,$4)',
        [b.room, roomId, stay.checkIn, stay.checkOut],
      );
      return writer.query('COMMIT');
    })();
    commit = write;
    await waiting(pid);
    operation = await executeBlock();
    await waiting(await firstPid(operation.pids));
    await barrier.query('COMMIT');
    await commit;
    await expect(operation.run).resolves.toMatchObject({ status: 201 });
    expect(new Set(operation.transactions).size).toBe(2);
    expect(
      (await rows('SELECT booking_room_id FROM room_assignments')).map((r) => r.booking_room_id),
    ).toEqual([b.room]);
    expect(
      (await rows('SELECT shortage_count FROM overbooking_cases')).map((r) => r.shortage_count),
    ).toEqual([1, 1, 1]);
    expect(
      (await rows("SELECT action FROM audit_logs WHERE action='ROOM_BLOCK_CREATED'")).length,
    ).toBe(1);
    expect((await rows('SELECT status FROM idempotency_keys')).map((r) => r.status)).toEqual([
      'COMPLETED',
    ]);
  } finally {
    await barrier.query('ROLLBACK');
    await commit?.catch(() => undefined);
    await operation?.run.catch(() => undefined);
    await writer.query('ROLLBACK');
    await writer.end();
    await barrier.end();
  }
}, 15000);
test('block wins the lock race: competing assignment rolls back, existing booking survives', async () => {
  const b = await booking(),
    barrier = await owner(),
    writer = new pg.Client({ connectionString: databaseUrl });
  await writer.connect();
  let operation: Awaited<ReturnType<typeof executeBlock>> | undefined;
  try {
    await barrier.query('BEGIN');
    await barrier.query('SELECT id FROM rooms WHERE id=$1 FOR UPDATE', [roomId]);
    operation = await executeBlock();
    await waiting(await firstPid(operation.pids));
    await writer.query('BEGIN');
    const pid = Number(
      (await writer.query<{ pid: number }>('SELECT pg_backend_pid() AS pid')).rows[0]!.pid,
    );
    // Block already holds property/type; the competing workflow has an empty allocation set.
    const insertion = (async () => {
      await writer.query('SELECT id FROM bookings WHERE id=$1 FOR UPDATE', [b.id]);
      await writer.query('SELECT id FROM properties WHERE id=$1 FOR UPDATE', [propertyId]);
      await writer.query('SELECT id FROM room_types WHERE id=$1 FOR UPDATE', [typeId]);
      await writer.query('SELECT id FROM rooms WHERE id=$1 FOR UPDATE', [roomId]);
      return writer.query(
        'INSERT INTO room_assignments(booking_room_id,room_id,start_date,end_date) VALUES($1,$2,$3,$4)',
        [b.room, roomId, stay.checkIn, stay.checkOut],
      );
    })();
    const failure = expect(insertion).rejects.toMatchObject({ code: '23P01' });
    await waiting(pid);
    await barrier.query('COMMIT');
    await operation.run;
    await failure;
    await writer.query('ROLLBACK');
    expect(new Set(operation.transactions).size).toBe(1);
    expect(await rows('SELECT id FROM room_assignments')).toEqual([]);
    expect((await rows('SELECT id FROM bookings')).map((r) => r.id)).toEqual([b.id]);
    expect((await rows('SELECT id FROM room_blocks')).length).toBe(1);
  } finally {
    await barrier.query('ROLLBACK');
    await writer.query('ROLLBACK');
    await operation?.run.catch(() => undefined);
    await writer.end();
    await barrier.end();
  }
}, 15000);
test('real held inventory lock exhausts three whole transaction attempts and returns E_INV_LOCK_TIMEOUT', async () => {
  const barrier = await owner();
  try {
    await barrier.query('BEGIN');
    await barrier.query('SELECT id FROM properties WHERE id=$1 FOR UPDATE', [propertyId]);
    const operation = await executeBlock();
    await expect(operation.run).rejects.toMatchObject({ code: 'E_INV_LOCK_TIMEOUT', status: 409 });
    expect(new Set(operation.transactions).size).toBe(3);
    expect(await rows('SELECT id FROM room_blocks')).toEqual([]);
    expect(await rows('SELECT id FROM idempotency_keys')).toEqual([]);
  } finally {
    await barrier.query('ROLLBACK');
    await barrier.end();
  }
}, 15000);
