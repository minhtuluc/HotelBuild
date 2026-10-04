import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

const root = fileURLToPath(new URL('../../../../', import.meta.url));
const chan = ['channels', 'channel_property_settings', 'channel_mappings', 'channel_allotments'];
const over = ['overbooking_cases', 'room_moves', 'room_merges'];
const owner = process.env.DATABASE_MIGRATION_URL;
interface Row {
  id: string;
  seq: string;
  version: string;
}
interface Fixture {
  user: Row;
  property: Row;
  type: Row;
  room: Row;
  room2: Row;
  dorm: Row;
  dormRoom: Row;
  web: Row;
  booking: (overrides?: Record<string, unknown>) => Promise<Row>;
  bookingRoom: (booking: Row, overrides?: Record<string, unknown>) => Promise<Row>;
}
function isFixtureModule(value: unknown): value is {
  fixture: (client: { query: pg.Client['query'] }) => Promise<Fixture>;
} {
  return (
    typeof value === 'object' &&
    value !== null &&
    'fixture' in value &&
    typeof value.fixture === 'function'
  );
}
function isDocsModule(value: unknown): value is {
  sqlBlocks: (source: string) => { sql: string }[];
} {
  return (
    typeof value === 'object' &&
    value !== null &&
    'sqlBlocks' in value &&
    typeof value.sqlBlocks === 'function'
  );
}
const helpers: unknown = await import(`${root}tests/helpers/database.mjs`);
const docs: unknown = await import(`${root}scripts/lib/docs.mjs`);
if (!isFixtureModule(helpers) || !isDocsModule(docs))
  throw new Error('Audit read-only helpers unavailable');

// The oracle is CURRENT csdl §3, independently loaded from the frozen migration.
// Full definitions retain numeric precision, nullability, defaults and FK delete actions.
const catalogs = {
  columns: `SELECT table_name,column_name,data_type,udt_name,is_nullable,column_default, numeric_precision,numeric_scale,is_generated,generation_expression FROM information_schema.columns WHERE table_schema='public' AND table_name=ANY($1::text[]) ORDER BY table_name,ordinal_position`,
  constraints: `SELECT c.relname,k.conname,k.contype,k.convalidated,k.condeferrable,k.condeferred, pg_get_constraintdef(k.oid) definition FROM pg_constraint k JOIN pg_class c ON c.oid=k.conrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relname=ANY($1::text[]) ORDER BY c.relname,k.conname`,
  indexes: `SELECT tablename,indexname,indexdef FROM pg_indexes WHERE schemaname='public' AND tablename=ANY($1::text[]) ORDER BY tablename,indexname`,
  triggers: `SELECT c.relname,t.tgname,t.tgenabled,pg_get_triggerdef(t.oid) definition FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND NOT t.tgisinternal AND c.relname=ANY($1::text[]) ORDER BY c.relname,t.tgname`,
};
async function catalog(client: pg.Client, tables: string[]) {
  const entries: [string, unknown][] = [];
  for (const [name, sql] of Object.entries(catalogs))
    entries.push([name, (await client.query(sql, [tables])).rows]);
  return Object.fromEntries(entries);
}

describe('HB-121 scoped PostgreSQL 16 baseline audit (not F6 business acceptance)', () => {
  let admin: pg.Client | undefined;
  let db: pg.Client;
  let reference: pg.Client;
  const names: string[] = [];
  const clients: pg.Client[] = [];
  beforeAll(async () => {
    if (!owner)
      throw new Error(
        'HB-121 requires DATABASE_MIGRATION_URL and real PostgreSQL 16; no embedded fallback',
      );
    admin = new pg.Client({ connectionString: owner });
    await admin.connect();
    const version = Number(
      (await admin.query<{ server_version_num: string }>('SHOW server_version_num')).rows[0]
        ?.server_version_num,
    );
    expect(version).toBeGreaterThanOrEqual(160000);
    expect(version).toBeLessThan(170000);
    const urls: string[] = [];
    for (const part of ['baseline', 'design']) {
      const name = `hb121_${part}_${randomUUID().replaceAll('-', '')}`;
      await admin.query(`CREATE DATABASE "${name}"`);
      names.push(name);
      const url = new URL(owner);
      url.pathname = `/${name}`;
      urls.push(url.href);
      const client = new pg.Client({ connectionString: url.href });
      clients.push(client);
      await client.connect();
      await client.query("SET TIME ZONE 'UTC'; SET statement_timeout='10s'");
    }
    [db, reference] = [clients[0]!, clients[1]!];
    const migrated = spawnSync(process.execPath, [`${root}scripts/migrate.mjs`], {
      cwd: root,
      encoding: 'utf8',
      timeout: 60000,
      env: { ...process.env, DATABASE_URL: '', DATABASE_MIGRATION_URL: urls[0]! },
    });
    expect(migrated.error).toBeUndefined();
    expect(migrated.status, migrated.stderr).toBe(0);
    for (const block of docs.sqlBlocks(await readFile(`${root}docs/04-thiet-ke/csdl.md`, 'utf8')))
      await reference.query(block.sql);
    expect((await db.query('SELECT migration_name FROM _prisma_migrations')).rows).toEqual([
      { migration_name: '0001_baseline' },
    ]);
  }, 90000);
  afterAll(async () => {
    for (const client of clients) await client.end();
    if (admin) {
      try {
        for (const name of names) await admin.query(`DROP DATABASE "${name}" WITH (FORCE)`);
      } finally {
        await admin.end();
      }
    }
  });
  beforeEach(async () => {
    await db.query('BEGIN');
  });
  afterEach(async () => {
    if (db) {
      await db.query('ROLLBACK');
      // Fixture writes must not survive the transaction, including failed SQL paths.
      const counts = [...chan, ...over, 'bookings', 'room_assignments'].map(
        (table) => `(SELECT count(*) FROM ${table})`,
      );
      expect(await rows(`SELECT (${counts.join('+')})::text count`)).toEqual([{ count: '0' }]);
    }
  });
  async function rejects(sql: string, params: unknown[], code: string, constraint?: string) {
    await db.query('SAVEPOINT audit_negative');
    try {
      await expect(db.query(sql, params)).rejects.toMatchObject({
        code,
        ...(constraint ? { constraint } : {}),
      });
    } finally {
      await db.query('ROLLBACK TO SAVEPOINT audit_negative; RELEASE SAVEPOINT audit_negative');
    }
  }
  const rows = async (sql: string, params: unknown[] = []) =>
    (await db.query<Record<string, unknown>>(sql, params)).rows;
  const fixture = () => helpers.fixture({ query: db.query.bind(db) });
  async function insert(table: string, values: Record<string, unknown>) {
    const keys = Object.keys(values);
    return (
      await db.query<Row>(
        `INSERT INTO ${table} (${keys.join(',')}) VALUES (${keys.map((_, i) => `$${i + 1}`).join(',')}) RETURNING *`,
        Object.values(values),
      )
    ).rows[0]!;
  }
  async function change(
    table: string,
    id: string,
    column: string,
    value: unknown,
    code = '23514',
    constraint?: string,
  ) {
    await rejects(`UPDATE ${table} SET ${column}=$1 WHERE id=$2`, [value, id], code, constraint);
  }
  async function overFixture() {
    const f = await fixture();
    const first = await f.booking({ check_out: '2030-01-05' });
    const second = await f.booking({ check_out: '2030-01-05' });
    const room = await f.bookingRoom(first);
    const move = await insert('room_moves', {
      booking_id: first.id,
      booking_room_id: room.id,
      move_type: 'SAME_TYPE_SAME_PROPERTY',
      to_room_id: f.room2.id,
      reason: 'Audit fixture',
    });
    const merge = await insert('room_merges', {
      primary_booking_id: first.id,
      secondary_booking_id: second.id,
      room_id: f.room.id,
      move_type: 'MERGE_SHARE',
      discount_pct: 0,
    });
    const activeCase = await insert('overbooking_cases', {
      property_id: f.property.id,
      room_type_id: f.type.id,
      date: '2030-01-01',
      shortage_count: 1,
    });
    return { f, first, second, room, move, merge, activeCase };
  }

  it('HB121_CHAN_catalog_matches_design', async () => {
    expect(await catalog(db, chan)).toEqual(await catalog(reference, chan));
    const f = await fixture();
    expect(
      await rows(
        'SELECT jsonb_build_array(sync_status,consecutive_sync_failures,last_sync_at,last_sync_error,overbook_allowed) defaults FROM channels WHERE id=$1',
        [f.web.id],
      ),
    ).toEqual([{ defaults: ['OK', 0, null, null, false] }]);
    for (const [field, invalid] of [
      ['code', 'UNKNOWN'],
      ['multiplier', 0],
      ['commission_pct', -1],
      ['commission_pct', 51],
      ['hold_minutes', -1],
      ['status', 'UNKNOWN'],
      ['sync_status', 'UNKNOWN'],
      ['consecutive_sync_failures', -1],
    ] as const)
      await change('channels', f.web.id, field, invalid);
    await rejects(
      "INSERT INTO channels(code,name,multiplier) VALUES ('WEB','Duplicate',1)",
      [],
      '23505',
      'channels_code_key',
    );
    const mapping = await insert('channel_mappings', {
      channel_id: f.web.id,
      room_type_id: f.type.id,
      external_room_code: 'AUDIT',
    });
    await change('channel_mappings', mapping.id, 'status', 'UNKNOWN');
    await change('channel_mappings', mapping.id, 'channel_id', randomUUID(), '23503');
    await rejects(
      "INSERT INTO channel_mappings(channel_id,room_type_id,external_room_code) VALUES($1,$2,'OTHER')",
      [f.web.id, f.type.id],
      '23505',
      'uq_channel_mappings_room',
    );
    const allotment = await insert('channel_allotments', {
      channel_id: f.web.id,
      room_type_id: f.type.id,
      date: '2030-01-01',
      allotment: 1,
    });
    for (const field of ['allotment', 'used'])
      await change('channel_allotments', allotment.id, field, -1);
    const closed = 'ck_channel_allotments_closed';
    await change('channel_allotments', allotment.id, 'is_closed', true, '23514', closed);
    await db.query(
      "UPDATE channels SET sync_status='DEGRADED',consecutive_sync_failures=1,last_sync_at=now(),last_sync_error='Synthetic test failure' WHERE id=$1",
      [f.web.id],
    );
    // Confirmed OTA demand may exceed cached allotment; closure needs a timestamp.
    await db.query(
      "UPDATE channel_allotments SET used=2,is_closed=true,closed_at=now(),closed_reason='Audit closure' WHERE id=$1",
      [allotment.id],
    );
  });

  it('HB121_OVER_catalog_matches_design', async () => {
    expect(await catalog(db, over)).toEqual(await catalog(reference, over));
    const { f, first, move, merge, activeCase } = await overFixture();
    expect(
      await rows(
        'SELECT jsonb_build_array(price_locked,compensation_amount,transport_cost) defaults FROM room_moves WHERE id=$1',
        [move.id],
      ),
    ).toEqual([{ defaults: [true, 0, 0] }]);
    for (const [field, invalid] of [
      ['shortage_count', 0],
      ['status', 'UNKNOWN'],
      ['status', 'RESOLVED'],
      ['status', 'ESCALATED'],
    ] as const)
      await change('overbooking_cases', activeCase.id, field, invalid);
    await rejects(
      "INSERT INTO overbooking_cases(property_id,room_type_id,date,shortage_count) VALUES($1,$2,'2030-01-01',1)",
      [f.property.id, f.type.id],
      '23505',
      'uq_overbooking_open_case',
    );
    for (const [field, invalid] of [
      ['price_locked', false],
      ['compensation_amount', -1],
      ['transport_cost', -1],
      ['keep_score', -1],
      ['keep_score', 174],
      ['move_type', 'UNKNOWN'],
      ['status', 'UNKNOWN'],
      ['to_room_id', null],
      ['status', 'APPROVED'],
    ] as const)
      await change('room_moves', move.id, field, invalid);
    await change('room_moves', move.id, 'booking_id', randomUUID(), '23503');
    for (const [field, invalid] of [
      ['move_type', 'UNKNOWN'],
      ['discount_pct', -1],
      ['discount_pct', 101],
      ['discount_amount', -1],
      ['status', 'UNKNOWN'],
      ['status', 'ACTIVE'],
    ] as const) {
      await change('room_merges', merge.id, field, invalid);
    }
    await change('room_merges', merge.id, 'secondary_booking_id', first.id);
    // Observe strict baseline approval only; this is NOT AC9/10 business acceptance.
    await db.query(
      "UPDATE room_moves SET approved_by=$1,status='APPROVED',compensation_amount=5001,transport_cost=1 WHERE id=$2",
      [f.user.id, move.id],
    );
    await db.query("UPDATE room_moves SET move_type='WALK_OUT',to_room_id=NULL WHERE id=$1", [
      move.id,
    ]);
    await change('room_moves', move.id, 'status', 'EXECUTED', '23514', 'ck_room_moves_walkout_doc');
    await db.query(
      "UPDATE room_moves SET walk_out_doc_no='AUDIT-DOC',status='EXECUTED' WHERE id=$1",
      [move.id],
    );
    await db.query(
      "UPDATE room_merges SET approved_by=$1,consent_primary=true,consent_secondary=true,status='ACTIVE' WHERE id=$2",
      [f.user.id, merge.id],
    );
    const consent = 'ck_room_merges_consent';
    await change('room_merges', merge.id, 'consent_primary', false, '23514', consent);
    await db.query(
      "UPDATE overbooking_cases SET status='RESOLVED',resolved_at=now(),resolved_by=$1 WHERE id=$2",
      [f.user.id, activeCase.id],
    );
    await insert('overbooking_cases', {
      property_id: f.property.id,
      room_type_id: f.type.id,
      date: '2030-01-01',
      shortage_count: 1,
    });
    // SQL uniqueness permits another row after resolution; actual shortage/rescan is AC4 NOT_RUN.
  });

  it('HB121_prerequisites_present', async () => {
    const prerequisiteTables = ['bookings', 'room_moves', 'room_merges', 'room_assignments'];
    expect(await catalog(db, prerequisiteTables)).toEqual(
      await catalog(reference, prerequisiteTables),
    );
    expect(
      await rows(
        "SELECT data_type,increment_by,cycle FROM pg_sequences WHERE schemaname='public' AND sequencename='bookings_seq'",
      ),
    ).toEqual([{ data_type: 'bigint', increment_by: '1', cycle: false }]);
    const { f, first, second, move, merge, room } = await overFixture();
    expect(BigInt(second.seq)).toBeGreaterThan(BigInt(first.seq));
    await change('bookings', second.id, 'seq', first.seq, '23505', 'bookings_seq_key');
    await db.query('SAVEPOINT rolled_back_booking');
    const rolledBack = await f.booking();
    await db.query(
      'ROLLBACK TO SAVEPOINT rolled_back_booking; RELEASE SAVEPOINT rolled_back_booking',
    );
    const afterRollback = await f.booking();
    expect(BigInt(afterRollback.seq)).toBeGreaterThan(BigInt(rolledBack.seq));
    for (const [table, row, field, value] of [
      ['bookings', first, 'children', 1],
      ['room_moves', move, 'reason', 'Updated audit reason'],
      ['room_merges', merge, 'discount_pct', 1],
    ] as const) {
      expect(row.version).toBe('1');
      expect(
        await rows(`UPDATE ${table} SET ${field}=$1,version=999 WHERE id=$2 RETURNING version`, [
          value,
          row.id,
        ]),
      ).toEqual([{ version: '2' }]);
    }
    const otherRoom = await f.bookingRoom(second);
    const sql =
      'INSERT INTO room_assignments(booking_room_id,room_id,bed_no,start_date,end_date) VALUES($1,$2,$3,$4,$5) RETURNING *';
    const assignment = async (br: Row, roomId: string, bed: number, start: string, end: string) =>
      (await db.query<Row>(sql, [br.id, roomId, bed, start, end])).rows[0]!;
    const active = await assignment(room, f.room.id, 0, '2030-01-01', '2030-01-03');
    expect(
      await rows('SELECT valid_range::text FROM room_assignments WHERE id=$1', [active.id]),
    ).toEqual([{ valid_range: '[2030-01-01,2030-01-03)' }]);
    await rejects(
      sql,
      [otherRoom.id, f.room.id, 0, '2030-01-02', '2030-01-03'],
      '23P01',
      'excl_room_assignments_no_double_booking',
    );
    await rejects(
      sql,
      [room.id, f.room2.id, 0, '2030-01-02', '2030-01-03'],
      '23P01',
      'excl_booking_room_one_assignment',
    );
    await assignment(room, f.room2.id, 0, '2030-01-03', '2030-01-05');
    await assignment(otherRoom, f.room.id, 0, '2030-01-03', '2030-01-05');
    await db.query(
      "UPDATE room_assignments SET released_at=now(),release_reason='Audit release' WHERE id=$1",
      [active.id],
    );
    await assignment(otherRoom, f.room.id, 0, '2030-01-01', '2030-01-03');
    const dormA = await f.bookingRoom(await f.booking({ room_type_id: f.dorm.id }));
    const dormB = await f.bookingRoom(await f.booking({ room_type_id: f.dorm.id }));
    await assignment(dormA, f.dormRoom.id, 1, '2030-01-01', '2030-01-03');
    await assignment(dormB, f.dormRoom.id, 2, '2030-01-01', '2030-01-03');
    const dormConflict = await f.bookingRoom(await f.booking({ room_type_id: f.dorm.id }));
    await rejects(
      sql,
      [dormConflict.id, f.dormRoom.id, 1, '2030-01-01', '2030-01-03'],
      '23P01',
      'excl_room_assignments_no_double_booking',
    );
  });
});
