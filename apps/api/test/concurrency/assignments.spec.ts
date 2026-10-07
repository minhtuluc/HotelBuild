import pg from 'pg';
import { afterAll, beforeAll, expect, test } from 'vitest';
import { AppError } from '../../src/common/app-error.js';
import { mapPostgresError } from '../../src/infrastructure/prisma/map-postgres-error.js';
import { createFixture } from './fixture.js';

let fixture: Awaited<ReturnType<typeof createFixture>> | undefined;
beforeAll(async () => {
  fixture = await createFixture();
}, 90000);
afterAll(async () => {
  await fixture?.close();
});
function current() {
  if (!fixture) throw new Error('Real PostgreSQL fixture unavailable');
  return fixture;
}
const insert = `INSERT INTO room_assignments(booking_room_id,room_id,bed_no,start_date,end_date)
  VALUES($1,$2,$3,$4::date,$5::date) RETURNING id`;
function gate() {
  let release = () => {};
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { promise, release };
}

test('TC-INV-01: 200 transactions via 50 independent concurrent backends yield 1 commit and 199 conflicts', async () => {
  const f = current();
  const pool = new pg.Pool({ connectionString: f.url, max: 50, connectionTimeoutMillis: 10000 });
  const start = gate(),
    firstWave = gate();
  const pids = new Set<number>();
  const startTime = performance.now();
  let firstWaveCount = 0;
  let firstWaveDistinct = 0;
  const watchdog = setTimeout(() => firstWave.release(), 10000);
  try {
    const tasks = f.contenders.map(async (bookingRoom) => {
      await start.promise;
      const client = await pool.connect();
      try {
        await client.query("BEGIN; SET LOCAL ROLE app_rw; SET LOCAL statement_timeout='10s'");
        const identity = (
          await client.query<{ pid: number; current_user: string }>(
            'SELECT pg_backend_pid() pid,current_user',
          )
        ).rows[0]!;
        expect(identity.current_user).toBe('app_rw');
        pids.add(identity.pid);
        firstWaveCount++;
        if (firstWaveCount === 50) {
          firstWaveDistinct = pids.size;
          clearTimeout(watchdog);
          firstWave.release();
        }
        await firstWave.promise;
        await client.query(insert, [bookingRoom, f.room, 0, '2030-01-01', '2030-01-02']);
        await client.query('COMMIT');
        return { committed: true, error: null };
      } catch (error) {
        await client.query('ROLLBACK');
        return { committed: false, error: mapPostgresError(error) };
      } finally {
        client.release();
      }
    });
    start.release(); // All 200 tasks launched; pool bounds simultaneous server connections, no client await loop.
    const results = await Promise.all(tasks);
    expect(results.filter((result) => result.committed)).toHaveLength(1);
    const conflicts = results.filter((result) => !result.committed);
    expect(conflicts).toHaveLength(199);
    for (const result of conflicts) {
      expect(result.error).toBeInstanceOf(AppError);
      expect(result.error).toMatchObject({ status: 409, code: 'E_INV_ROOM_TAKEN' });
    }
    expect(firstWaveDistinct).toBe(50);
    expect(pids.size).toBe(50);
    expect(
      (
        await f.db.query<{ count: string }>(
          'SELECT count(*) FROM room_assignments WHERE released_at IS NULL',
        )
      ).rows,
    ).toEqual([{ count: '1' }]);
    const milliseconds = performance.now() - startTime;
    expect(milliseconds).toBeLessThan(60000);
    process.stdout.write(
      JSON.stringify({
        attempts: 200,
        firstWaveBackends: firstWaveDistinct,
        uniqueBackends: pids.size,
        commits: 1,
        conflicts: 199,
        milliseconds: Math.ceil(milliseconds),
      }) + '\n',
    );
  } finally {
    clearTimeout(watchdog);
    await pool.end();
  }
}, 60000);

test('BR-INV-03: same BookingRoom cannot occupy two different rooms during the same night', async () => {
  const f = current();
  const br = await f.bookingRoom();
  await f.db.query(insert, [br, f.room2, 0, '2030-02-01', '2030-02-02']);
  try {
    await f.db.query(insert, [br, f.room, 0, '2030-02-01', '2030-02-02']);
    throw new Error('Expected real exclusion failure');
  } catch (error) {
    expect(error).toMatchObject({ code: '23P01', constraint: 'excl_booking_room_one_assignment' });
    expect(mapPostgresError(error)).toMatchObject({ code: 'E_INV_ROOM_TAKEN' });
  }
});

test('TC-INV-02: distinct DOR beds coexist; duplicate bed conflicts; whole DOR claim rejected', async () => {
  const f = current();
  for (const bed of [1, 2])
    await f.db.query(insert, [await f.bookingRoom(true), f.dorm, bed, '2030-03-01', '2030-03-02']);
  await expect(
    f.db.query(insert, [await f.bookingRoom(true), f.dorm, 1, '2030-03-01', '2030-03-02']),
  ).rejects.toMatchObject({ code: '23P01', constraint: 'excl_room_assignments_no_double_booking' });
  // DOR bed_no=0 is invalid before EXCLUDE; preserve 23514, never misclassify as room conflict.
  await expect(
    f.db.query(insert, [await f.bookingRoom(true), f.dorm, 0, '2030-03-01', '2030-03-02']),
  ).rejects.toMatchObject({ code: '23514' });
  expect(
    (
      await f.db.query<{ count: string }>(
        'SELECT count(*) FROM room_assignments WHERE room_id=$1 AND released_at IS NULL',
        [f.dorm],
      )
    ).rows,
  ).toEqual([{ count: '2' }]);
});

test('half-open adjacent nights commit; released unit can be reused', async () => {
  const f = current();
  const first = (
    await f.db.query<{ id: string }>(insert, [
      await f.bookingRoom(),
      f.room2,
      0,
      '2030-04-01',
      '2030-04-02',
    ])
  ).rows[0]!;
  await f.db.query(insert, [await f.bookingRoom(), f.room2, 0, '2030-04-02', '2030-04-03']);
  await f.db.query('UPDATE room_assignments SET released_at=now() WHERE id=$1', [first.id]);
  await f.db.query(insert, [await f.bookingRoom(), f.room2, 0, '2030-04-01', '2030-04-02']);
  expect(
    (
      await f.db.query<{ count: string }>(
        "SELECT count(*) FROM room_assignments WHERE room_id=$1 AND released_at IS NULL AND valid_range && daterange('2030-04-01','2030-04-03','[)')",
        [f.room2],
      )
    ).rows,
  ).toEqual([{ count: '2' }]);
});
