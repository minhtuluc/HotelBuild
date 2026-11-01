/* eslint-disable max-lines -- HB-121 AC1…AC10 are ten independently named PG16 certification cases in the only spec file the ticket allows; splitting them would need files outside `allow`. */
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { expectMigrationHistory } from './baseline-fixture.js';

const root = fileURLToPath(new URL('../../../../', import.meta.url));
const owner = process.env.DATABASE_MIGRATION_URL;
const migrations = `${root}apps/api/prisma/migrations`;
const F6 = '0009_f6_chan_over';
const chan = ['channels', 'channel_property_settings', 'channel_mappings', 'channel_allotments'];
const chanF6 = [
  ...chan,
  'channel_sales_closures',
  'channel_sync_watermarks',
  'channel_cancel_tombstones',
];
const over = ['overbooking_cases', 'room_moves', 'room_merges', 'overbooking_scan_runs'];
const pre = ['bookings', 'room_assignments', 'payments'];

interface Row {
  id: string;
  version: string;
  seq: string;
  status?: string;
  [column: string]: unknown;
}
interface Fixture {
  user: Row;
  property: Row;
  type: Row;
  dorm: Row;
  room: Row;
  room2: Row;
  dormRoom: Row;
  web: Row;
  ota: Row;
  booking: (overrides?: Record<string, unknown>) => Promise<Row>;
  bookingRoom: (booking: Row, overrides?: Record<string, unknown>) => Promise<Row>;
}
function isFixture(value: unknown): value is {
  fixture: (db: { query: pg.Client['query'] }) => Promise<Fixture>;
} {
  return (
    typeof value === 'object' &&
    value !== null &&
    'fixture' in value &&
    typeof value.fixture === 'function'
  );
}
function isDocs(value: unknown): value is { sqlBlocks: (source: string) => { sql: string }[] } {
  return (
    typeof value === 'object' &&
    value !== null &&
    'sqlBlocks' in value &&
    typeof value.sqlBlocks === 'function'
  );
}
const helpers: unknown = await import(`${root}tests/helpers/database.mjs`);
const docs: unknown = await import(`${root}scripts/lib/docs.mjs`);
if (!isFixture(helpers) || !isDocs(docs)) throw new Error('Audit read-only helpers unavailable');

// Oracle: a reference database built only from the published csdl §3 fences, so a doc/DDL divergence
// fails here instead of shipping as silent drift.
const catalogs = {
  columns: `SELECT table_name,column_name,data_type,udt_name,is_nullable,column_default,numeric_precision,numeric_scale,is_generated,generation_expression FROM information_schema.columns WHERE table_schema='public' AND table_name=ANY($1::text[]) ORDER BY table_name,column_name`,
  constraints: `SELECT c.relname,k.conname,k.contype,k.convalidated,k.condeferrable,k.condeferred,pg_get_constraintdef(k.oid) definition FROM pg_constraint k JOIN pg_class c ON c.oid=k.conrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relname=ANY($1::text[]) ORDER BY c.relname,k.conname`,
  indexes: `SELECT tablename,indexname,indexdef FROM pg_indexes WHERE schemaname='public' AND tablename=ANY($1::text[]) ORDER BY tablename,indexname`,
  triggers: `SELECT c.relname,t.tgname,t.tgenabled,pg_get_triggerdef(t.oid) definition FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND NOT t.tgisinternal AND c.relname=ANY($1::text[]) ORDER BY c.relname,t.tgname`,
};
async function snapshot(client: pg.Client, tables: string[]) {
  const entries: [string, unknown][] = [];
  for (const [name, sql] of Object.entries(catalogs))
    entries.push([name, (await client.query(sql, [tables])).rows]);
  return Object.fromEntries(entries);
}

describe('HB-121 F6 CHAN/OVER forward migration on PostgreSQL 16', () => {
  let admin: pg.Client | undefined;
  let db: pg.Client;
  let reference: pg.Client;
  let url = '';
  const names: string[] = [];
  const clients: pg.Client[] = [];
  const migrate = () =>
    spawnSync(process.execPath, [`${root}scripts/migrate.mjs`], {
      cwd: root,
      encoding: 'utf8',
      timeout: 60000,
      env: { ...process.env, DATABASE_URL: '', DATABASE_MIGRATION_URL: url },
    });

  beforeAll(async () => {
    if (!owner) throw new Error('HB-121 requires DATABASE_MIGRATION_URL and real PostgreSQL 16');
    admin = new pg.Client({ connectionString: owner });
    await admin.connect();
    const version = Number(
      (await admin.query<{ server_version_num: string }>('SHOW server_version_num')).rows[0]
        ?.server_version_num,
    );
    expect(version).toBeGreaterThanOrEqual(160000);
    expect(version).toBeLessThan(170000);
    const urls: string[] = [];
    for (const part of ['migrated', 'reference']) {
      const name = `hb121_${part}_${randomUUID().replaceAll('-', '')}`;
      await admin.query(`CREATE DATABASE "${name}"`);
      names.push(name);
      const base = new URL(owner);
      base.pathname = `/${name}`;
      urls.push(base.href);
      const client = new pg.Client({ connectionString: base.href });
      clients.push(client);
      await client.connect();
      await client.query("SET TIME ZONE 'UTC'; SET statement_timeout='10s'");
    }
    [db, reference] = [clients[0]!, clients[1]!];
    url = urls[0]!;
    // AC6 starting point: a clean `scripts/migrate.mjs` run from an empty database.
    const first = migrate();
    expect(first.error).toBeUndefined();
    expect(first.status, first.stderr).toBe(0);
    for (const block of docs.sqlBlocks(await readFile(`${root}docs/04-thiet-ke/csdl.md`, 'utf8')))
      await reference.query(block.sql);
    await expectMigrationHistory(db, root);
  }, 120000);

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
    await db.query('ROLLBACK');
    // Nothing may leak from a failed negative path or a committed concurrency probe.
    const counts = [...chanF6, ...over, ...pre, 'room_types', 'rooms', 'users'].map(
      (table) => `(SELECT count(*) FROM ${table})`,
    );
    expect(await rows(`SELECT (${counts.join('+')})::text count`)).toEqual([{ count: '0' }]);
  });

  const rows = async (sql: string, params: unknown[] = []) =>
    (await db.query<Record<string, unknown>>(sql, params)).rows;
  const fixture = () => helpers.fixture({ query: db.query.bind(db) });
  async function insert(table: string, values: Record<string, unknown>) {
    const keys = Object.keys(values);
    const params = keys.map((_, i) => `$${i + 1}`).join(',');
    return (
      await db.query<Row>(
        `INSERT INTO ${table} (${keys.join(',')}) VALUES (${params}) RETURNING *`,
        Object.values(values),
      )
    ).rows[0]!;
  }
  async function rejects(
    sql: string,
    params: readonly unknown[],
    code: string,
    constraint?: string,
  ) {
    await db.query('SAVEPOINT audit_negative');
    try {
      await expect(db.query(sql, [...params])).rejects.toMatchObject({
        code,
        ...(constraint ? { constraint } : {}),
      });
    } finally {
      await db.query('ROLLBACK TO SAVEPOINT audit_negative; RELEASE SAVEPOINT audit_negative');
    }
  }
  const change = (
    table: string,
    id: string,
    column: string,
    value: unknown,
    code = '23514',
    constraint?: string,
  ) => rejects(`UPDATE ${table} SET ${column}=$1 WHERE id=$2`, [value, id], code, constraint);
  const allotment = (f: Fixture) =>
    insert('channel_allotments', {
      channel_id: f.web.id,
      room_type_id: f.type.id,
      date: '2030-01-01',
      allotment: 2,
    });
  const move = (f: Fixture, b: Row, room: Row, values: Record<string, unknown> = {}) =>
    insert('room_moves', {
      booking_id: b.id,
      booking_room_id: room.id,
      move_type: 'SAME_TYPE_SAME_PROPERTY',
      to_room_id: f.room2.id,
      reason: 'HB-121 audit',
      ...values,
    });
  const merge = (f: Fixture, b: Row, values: Record<string, unknown>) =>
    insert('room_merges', {
      primary_booking_id: b.id,
      room_id: f.room.id,
      discount_pct: 20,
      move_type: 'MERGE_SHARE',
      ...values,
    });

  it('HB121_CHAN_catalog_matches_design', async () => {
    expect(await snapshot(db, chanF6)).toEqual(await snapshot(reference, chanF6));
    const f = await fixture();
    const defaults =
      'SELECT jsonb_build_array(sync_status,consecutive_sync_failures,last_sync_at,last_sync_error,overbook_allowed) d FROM channels WHERE id=$1';
    expect(await rows(defaults, [f.web.id])).toEqual([{ d: ['OK', 0, null, null, false] }]);
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
      "INSERT INTO channels(code,name,multiplier) VALUES('WEB','Dup',1)",
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
    const row = await allotment(f);
    for (const field of ['allotment', 'used'])
      await change('channel_allotments', row.id, field, -1);
    await change(
      'channel_allotments',
      row.id,
      'is_closed',
      true,
      '23514',
      'ck_channel_allotments_closed',
    );
    // AC8 closure provenance: source/actor/reason live beside the effective allotment flag.
    const closure = await insert('channel_sales_closures', {
      channel_id: f.web.id,
      room_type_id: f.type.id,
      date: '2030-01-01',
      source: 'MANUAL',
      reason: 'Manual',
      closed_by: f.user.id,
    });
    expect(closure.version).toBe('1');
    await change('channel_sales_closures', closure.id, 'source', 'UNKNOWN');
    await change('channel_sales_closures', closure.id, 'closed_by', randomUUID(), '23503');
    await rejects(
      "INSERT INTO channel_sales_closures(channel_id,room_type_id,date,source) VALUES($1,$2,'2030-01-01','MANUAL')",
      [f.web.id, f.type.id],
      '23505',
      'uq_channel_sales_closures_active',
    );
    // A manual close must not swallow the automatic latch (manual reopen keeps auto closure).
    await insert('channel_sales_closures', {
      channel_id: f.web.id,
      room_type_id: f.type.id,
      date: '2030-01-01',
      source: 'AUTOMATIC',
    });
    expect(
      await rows('UPDATE channel_sales_closures SET version=999 WHERE id=$1 RETURNING version', [
        closure.id,
      ]),
    ).toEqual([{ version: '2' }]);
    await change(
      'channel_sales_closures',
      closure.id,
      'reopened_at',
      '2030-01-02T00:00:00Z',
      '23514',
      'ck_channel_sales_closures_reopener',
    );
    expect(
      await rows(
        "UPDATE channel_sales_closures SET reopened_at='2030-01-02T00:00:00Z',reopened_by=$1 WHERE id=$2 RETURNING source,reopened_by",
        [f.user.id, closure.id],
      ),
    ).toEqual([{ source: 'MANUAL', reopened_by: f.user.id }]);
  });

  it('HB121_OVER_catalog_matches_design', async () => {
    expect(await snapshot(db, over)).toEqual(await snapshot(reference, over));
    const f = await fixture();
    const b = await f.booking({ check_out: '2030-01-05' });
    const r = await f.bookingRoom(b);
    const mv = await move(f, b, r);
    expect(
      await rows(
        'SELECT jsonb_build_array(price_locked,compensation_amount,transport_cost) d FROM room_moves WHERE id=$1',
        [mv.id],
      ),
    ).toEqual([{ d: [true, 0, 0] }]);
    const open = await insert('overbooking_cases', {
      property_id: f.property.id,
      room_type_id: f.type.id,
      date: '2030-01-01',
      shortage_count: 1,
    });
    for (const [field, invalid] of [
      ['shortage_count', 0],
      ['status', 'UNKNOWN'],
      ['status', 'RESOLVED'],
      ['status', 'ESCALATED'],
    ] as const)
      await change('overbooking_cases', open.id, field, invalid);
    // F6-D07: RESOLVED needs a timestamp plus exactly one durable actor model.
    await rejects(
      "UPDATE overbooking_cases SET status='RESOLVED',resolved_at=now(),resolution_source='USER' WHERE id=$1",
      [open.id],
      '23514',
      'ck_overbooking_resolved',
    );
    await rejects(
      "UPDATE overbooking_cases SET status='RESOLVED',resolved_at=now(),resolution_source='SYSTEM',resolved_by=$2 WHERE id=$1",
      [open.id, f.user.id],
      '23514',
      'ck_overbooking_resolved',
    );
    expect(
      await rows(
        "UPDATE overbooking_cases SET status='RESOLVED',resolved_at=now(),resolution_source='SYSTEM' WHERE id=$1 RETURNING resolved_by,status",
        [open.id],
      ),
    ).toEqual([{ resolved_by: null, status: 'RESOLVED' }]);
    for (const [field, invalid] of [
      ['price_locked', false],
      ['compensation_amount', -1],
      ['transport_cost', -1],
      ['keep_score', -1],
      ['keep_score', 174],
      ['move_type', 'UNKNOWN'],
      ['status', 'UNKNOWN'],
      ['to_room_id', null],
    ] as const)
      await change('room_moves', mv.id, field, invalid);
    await change('room_moves', mv.id, 'booking_id', randomUUID(), '23503');
    await change('room_moves', mv.id, 'price_locked', false, '23514', 'ck_room_moves_price_lock');
    const shared = await merge(f, b, {
      secondary_booking_id: (await f.booking({ check_out: '2030-01-05' })).id,
      discount_pct: 20,
    });
    for (const [field, invalid] of [
      ['move_type', 'UNKNOWN'],
      ['discount_pct', -1],
      ['discount_pct', 101],
      ['discount_amount', -1],
      ['status', 'UNKNOWN'],
    ] as const)
      await change('room_merges', shared.id, field, invalid);
  });

  it('HB121_prerequisites_present', async () => {
    expect(await snapshot(db, pre)).toEqual(await snapshot(reference, pre));
    expect(
      await rows(
        "SELECT data_type,increment_by,cycle FROM pg_sequences WHERE schemaname='public' AND sequencename='bookings_seq'",
      ),
    ).toEqual([{ data_type: 'bigint', increment_by: '1', cycle: false }]);
    const f = await fixture();
    const first = await f.booking();
    const second = await f.booking();
    expect(BigInt(second.seq)).toBeGreaterThan(BigInt(first.seq));
    await change('bookings', second.id, 'seq', first.seq, '23505', 'bookings_seq_key');
    await db.query('SAVEPOINT rolled_back_booking');
    const rolledBack = await f.booking();
    await db.query(
      'ROLLBACK TO SAVEPOINT rolled_back_booking; RELEASE SAVEPOINT rolled_back_booking',
    );
    // Sequence values are never reused, so ordering stays deterministic after a rollback.
    expect(BigInt((await f.booking()).seq)).toBeGreaterThan(BigInt(rolledBack.seq));
    const br = await f.bookingRoom(first);
    const mv = await move(f, first, br);
    const shared = await merge(f, first, {
      secondary_booking_id: (await f.booking()).id,
      discount_pct: 0,
    });
    for (const [table, target, field, value] of [
      ['bookings', first, 'children', 1],
      ['room_moves', mv, 'reason', 'Updated'],
      ['room_merges', shared, 'discount_pct', 1],
    ] as const) {
      expect(target.version).toBe('1');
      expect(
        await rows(`UPDATE ${table} SET ${field}=$1,version=999 WHERE id=$2 RETURNING version`, [
          value,
          target.id,
        ]),
      ).toEqual([{ version: '2' }]);
    }
    const other = await f.bookingRoom(second);
    const sql =
      'INSERT INTO room_assignments(booking_room_id,room_id,bed_no,start_date,end_date) VALUES($1,$2,$3,$4,$5) RETURNING *';
    const assign = async (unit: Row, room: string, bed: number, start: string, end: string) =>
      (await db.query<Row>(sql, [unit.id, room, bed, start, end])).rows[0]!;
    const active = await assign(br, f.room.id, 0, '2030-01-01', '2030-01-03');
    expect(
      await rows('SELECT valid_range::text v FROM room_assignments WHERE id=$1', [active.id]),
    ).toEqual([{ v: '[2030-01-01,2030-01-03)' }]);
    await rejects(
      sql,
      [other.id, f.room.id, 0, '2030-01-02', '2030-01-03'],
      '23P01',
      'excl_room_assignments_no_double_booking',
    );
    await rejects(
      sql,
      [br.id, f.room2.id, 0, '2030-01-02', '2030-01-03'],
      '23P01',
      'excl_booking_room_one_assignment',
    );
    // DOR sells per bed, so a second selling unit only collides on the same bed.
    const dormA = await f.bookingRoom(await f.booking({ room_type_id: f.dorm.id }));
    const dormB = await f.bookingRoom(await f.booking({ room_type_id: f.dorm.id }));
    const dormC = await f.bookingRoom(await f.booking({ room_type_id: f.dorm.id }));
    await assign(dormA, f.dormRoom.id, 1, '2030-01-01', '2030-01-03');
    await assign(dormB, f.dormRoom.id, 2, '2030-01-01', '2030-01-03');
    await rejects(
      sql,
      [dormC.id, f.dormRoom.id, 1, '2030-01-01', '2030-01-03'],
      '23P01',
      'excl_room_assignments_no_double_booking',
    );
  });

  it('HB121_open_case_unique', async () => {
    const f = await fixture();
    const cases = (type: string, date = '2030-01-01') =>
      [
        'INSERT INTO overbooking_cases(property_id,room_type_id,date,shortage_count) VALUES($1,$2,$3,1)',
        [f.property.id, type, date],
      ] as const;
    await insert('overbooking_cases', {
      property_id: f.property.id,
      room_type_id: f.type.id,
      date: '2030-01-01',
      shortage_count: 1,
    });
    await rejects(...cases(f.type.id), '23505', 'uq_overbooking_open_case');
    // Same key on another room type is a different case, not a duplicate.
    await insert('overbooking_cases', {
      property_id: f.property.id,
      room_type_id: f.dorm.id,
      date: '2030-01-01',
      shortage_count: 1,
    });
    await db.query(
      "UPDATE overbooking_cases SET status='RESOLVED',resolved_at=now(),resolution_source='SYSTEM' WHERE room_type_id=$1",
      [f.type.id],
    );
    await insert('overbooking_cases', {
      property_id: f.property.id,
      room_type_id: f.type.id,
      date: '2030-01-01',
      shortage_count: 1,
    });
    // Two scans racing on one key: the loser blocks on the partial UNIQUE, so the database never
    // holds two open cases. Another connection cannot see this test's open transaction, so the
    // probe commits and cleans its own property/room-type fixture.
    const pair = [
      new pg.Client({ connectionString: url }),
      new pg.Client({ connectionString: url }),
    ];
    try {
      for (const client of pair) {
        await client.connect();
        await client.query("SET statement_timeout='10s'");
      }
      const [winner, loser] = pair;
      const property = await winner!.query<{ id: string }>(
        "INSERT INTO properties(code,name,address,phone,latitude,longitude) VALUES($1,'Race','Race','+84900000000',11,108) RETURNING id",
        [`RACE-${randomUUID().slice(0, 8)}`],
      );
      const pid = property.rows[0]!.id;
      const type = await winner!.query<{ id: string }>(
        "INSERT INTO room_types(property_id,code,name,capacity_adults,base_price,min_price,max_price) VALUES($1,'STD','Race',2,650000,450000,1600000) RETURNING id",
        [pid],
      );
      const tid = type.rows[0]!.id;
      const probe =
        "INSERT INTO overbooking_cases(property_id,room_type_id,date,shortage_count) VALUES($1,$2,'2030-02-01',1)";
      await winner!.query('BEGIN');
      await loser!.query('BEGIN');
      await winner!.query(probe, [pid, tid]);
      const blocked = loser!.query(probe, [pid, tid]);
      await delay(150);
      await winner!.query('COMMIT');
      await expect(blocked).rejects.toMatchObject({
        code: '23505',
        constraint: 'uq_overbooking_open_case',
      });
      await loser!.query('ROLLBACK');
    } finally {
      await pair[0]!.query('DELETE FROM overbooking_cases').catch(() => undefined);
      await pair[0]!.query('DELETE FROM room_types').catch(() => undefined);
      await pair[0]!.query('DELETE FROM properties').catch(() => undefined);
      for (const client of pair) await client.end();
    }
  });

  it('HB121_no_duplicate_migration_when_complete', async () => {
    // Baseline already owns these tables; re-creating them would reset data and diverge from §3.
    const sql = await readFile(`${migrations}/${F6}/migration.sql`, 'utf8');
    for (const table of [...chan, ...over.slice(0, 3), 'webhook_inbox', 'event_deliveries'])
      expect(sql).not.toMatch(
        new RegExp(`CREATE\\s+TABLE\\s+(?:IF\\s+NOT\\s+EXISTS\\s+)?${table}\\b`, 'i'),
      );
    const f6 = (await readdir(migrations, { withFileTypes: true }))
      .filter((e) => e.isDirectory() && e.name.endsWith('_f6_chan_over'))
      .map((e) => e.name)
      .sort();
    // The version gap is closed by 0003; 0009 must be the only new F6 file and must not repeat it.
    expect(f6).toEqual(['0003_f6_chan_over', F6]);
    expect(sql).not.toMatch(/ADD\s+COLUMN\s+version\b/i);
    const tables = await rows(
      "SELECT c.relname,count(*)::int n FROM pg_class c JOIN pg_namespace ns ON ns.oid=c.relnamespace WHERE ns.nspname='public' AND c.relkind='r' AND c.relname=ANY($1::text[]) GROUP BY c.relname ORDER BY c.relname",
      [[...chanF6, ...over]],
    );
    expect(tables).toEqual([...chanF6, ...over].sort().map((relname) => ({ relname, n: 1 })));
    // AC5: the AC7/AC8 objects exist on the baseline tables, not only in the document.
    const added = await rows(
      "SELECT table_name,column_name FROM information_schema.columns WHERE table_schema='public' AND ((table_name='bookings' AND column_name LIKE 'duplicate_suspected%') OR (table_name='payments' AND column_name='room_move_id') OR (table_name='overbooking_cases' AND column_name='resolution_source') OR (table_name='room_merges' AND column_name='secondary_room_id')) ORDER BY table_name,column_name",
    );
    expect(added).toEqual([
      { table_name: 'bookings', column_name: 'duplicate_suspected' },
      { table_name: 'bookings', column_name: 'duplicate_suspected_at' },
      { table_name: 'bookings', column_name: 'duplicate_suspected_by' },
      { table_name: 'bookings', column_name: 'duplicate_suspected_reason' },
      { table_name: 'bookings', column_name: 'duplicate_suspected_version' },
      { table_name: 'overbooking_cases', column_name: 'resolution_source' },
      { table_name: 'payments', column_name: 'room_move_id' },
      { table_name: 'room_merges', column_name: 'secondary_room_id' },
    ]);
  });

  it('HB121_forward_migration_only_for_proven_gap', async () => {
    const f = await fixture();
    const b = await f.booking();
    const count =
      'SELECT (SELECT count(*) FROM bookings)::int bookings, (SELECT count(*) FROM channel_allotments)::int allotments';
    const before = await rows(count);
    const replay = migrate();
    expect(replay.status, replay.stderr).toBe(0);
    // Prisma history makes the second deploy a certified no-op and keeps every row untouched.
    await expectMigrationHistory(db, root);
    expect(await rows('SELECT id,version::text FROM bookings WHERE id=$1', [b.id])).toEqual([
      { id: b.id, version: '1' },
    ]);
    expect(await rows(count)).toEqual(before);
    // `prisma migrate diff` proves schema.prisma ↔ migration parity (the repo's drift gate).
    const drift = spawnSync(process.execPath, [`${root}apps/api/prisma/drift.mjs`], {
      cwd: root,
      encoding: 'utf8',
      timeout: 90000,
      env: { ...process.env, DATABASE_URL: '', DATABASE_MIGRATION_URL: url },
    });
    expect(drift.status, drift.stderr).toBe(0);
    expect(drift.stdout).toContain('No drift');
  }, 120000);

  it('HB121_f6_optimistic_versions', async () => {
    const f = await fixture();
    // Case resolve (F6-D07) keeps a database-authoritative version, not updated_at.
    const open = await insert('overbooking_cases', {
      property_id: f.property.id,
      room_type_id: f.type.id,
      date: '2030-01-01',
      shortage_count: 1,
    });
    expect(open.version).toBe('1');
    expect(
      await rows(
        "UPDATE overbooking_cases SET status='RESOLVED',resolved_at=now(),resolution_source='USER',resolved_by=$1,version=999 WHERE id=$2 RETURNING version",
        [f.user.id, open.id],
      ),
    ).toEqual([{ version: '2' }]);
    const mapping = await insert('channel_mappings', {
      channel_id: f.web.id,
      room_type_id: f.type.id,
      external_room_code: 'VERSION',
    });
    expect(mapping.version).toBe('1');
    expect(
      await rows(
        'UPDATE channel_mappings SET status=$1,version=999 WHERE id=$2 RETURNING version',
        ['INACTIVE', mapping.id],
      ),
    ).toEqual([{ version: '2' }]);
    // Closure configuration (sales-closure) carries its own version.
    const closure = await insert('channel_sales_closures', {
      channel_id: f.web.id,
      room_type_id: f.type.id,
      date: '2030-01-01',
      source: 'MANUAL',
      closed_by: f.user.id,
    });
    expect(closure.version).toBe('1');
    expect(
      await rows(
        "UPDATE channel_sales_closures SET reason='Pool low',version=999 WHERE id=$1 RETURNING version",
        [closure.id],
      ),
    ).toEqual([{ version: '2' }]);
    // Review flag: bookings.version is the If-Match token, duplicate_suspected_version the decision.
    const b = await f.booking();
    expect(b.version).toBe('1');
    const flag =
      'UPDATE bookings SET duplicate_suspected=true,duplicate_suspected_by=$1,duplicate_suspected_reason=$2,duplicate_suspected_at=now(),duplicate_suspected_version=999,version=999 WHERE id=$3 RETURNING version,duplicate_suspected_version';
    expect(await rows(flag, [f.user.id, 'Same phone as PH-300101-00001', b.id])).toEqual([
      { version: '2', duplicate_suspected_version: '1' },
    ]);
    // A no-op edit neither bumps the decision counter nor accepts a client-supplied one.
    expect(
      await rows(
        'UPDATE bookings SET duplicate_suspected=duplicate_suspected,duplicate_suspected_version=42 WHERE id=$1 RETURNING duplicate_suspected_version',
        [b.id],
      ),
    ).toEqual([{ duplicate_suspected_version: '1' }]);
  });

  it('HB121_ota_order_review_and_closure_persistence', async () => {
    const f = await fixture();
    const watermark = (account: string, at: string) =>
      insert('channel_sync_watermarks', {
        channel_id: f.web.id,
        account_key: account,
        provider: 'booking',
        watermark_at: at,
      });
    await watermark('account-a', '2030-01-01T00:00:00Z');
    // The same provider code under a second account is a separate stream, never merged.
    await watermark('account-b', '2029-12-01T00:00:00Z');
    await rejects(
      "INSERT INTO channel_sync_watermarks(channel_id,account_key,provider,watermark_at) VALUES($1,'account-a','booking','2029-01-01T00:00:00Z')",
      [f.web.id],
      '23505',
    );
    await rejects(
      "UPDATE channel_sync_watermarks SET watermark_at='2029-12-31T23:59:59Z' WHERE channel_id=$1 AND account_key='account-a'",
      [f.web.id],
      '23514',
    );
    expect(
      await rows(
        "UPDATE channel_sync_watermarks SET watermark_at='2030-01-02T00:00:00Z',version=999 WHERE channel_id=$1 AND account_key='account-a' RETURNING watermark_at,version",
        [f.web.id],
      ),
    ).toEqual([{ watermark_at: new Date('2030-01-02T00:00:00.000Z'), version: '2' }]);
    // Cancel tombstone outlives the 7-day inbox purge and is unique per account + booking code.
    const stone = {
      channel_id: f.ota.id,
      account_key: 'account-a',
      provider_booking_code: 'OTA-1',
      provider_updated_at: '2030-01-01T00:00:00Z',
      cancelled_at: '2030-01-01T00:05:00Z',
    };
    await insert('channel_cancel_tombstones', stone);
    await insert('channel_cancel_tombstones', { ...stone, account_key: 'account-b' });
    await rejects(
      "INSERT INTO channel_cancel_tombstones(channel_id,account_key,provider_booking_code,provider_updated_at,cancelled_at) VALUES($1,'account-a','OTA-1','2030-01-02T00:00:00Z','2030-01-02T00:05:00Z')",
      [f.ota.id],
      '23505',
    );
    await db.query('DELETE FROM webhook_inbox');
    expect(
      await rows('SELECT count(*)::int n FROM channel_cancel_tombstones WHERE channel_id=$1', [
        f.ota.id,
      ]),
    ).toEqual([{ n: 2 }]);
    // Review flag keeps actor/reason/version; the legacy boolean-only path still advances the counter.
    const b = await f.booking();
    await db.query(
      'UPDATE bookings SET duplicate_suspected=true,duplicate_suspected_by=$1,duplicate_suspected_reason=$2,duplicate_suspected_at=now() WHERE id=$3',
      [f.user.id, 'Duplicate OTA booking', b.id],
    );
    expect(
      await rows(
        'SELECT duplicate_suspected_by,duplicate_suspected_reason,duplicate_suspected_version::text version FROM bookings WHERE id=$1',
        [b.id],
      ),
    ).toEqual([
      {
        duplicate_suspected_by: f.user.id,
        duplicate_suspected_reason: 'Duplicate OTA booking',
        version: '1',
      },
    ]);
    expect(
      await rows(
        'UPDATE bookings SET duplicate_suspected=false WHERE id=$1 RETURNING duplicate_suspected_version::text version',
        [b.id],
      ),
    ).toEqual([{ version: '2' }]);
    // Actor-without-timestamp is rejected so the F6 review decision stays atomic.
    await rejects(
      'UPDATE bookings SET duplicate_suspected_by=$1,duplicate_suspected_at=NULL WHERE id=$2',
      [f.user.id, b.id],
      '23514',
      'ck_bookings_duplicate_flag',
    );
    // Scan freshness is durable per property: one RUNNING run, latest success queryable.
    const run = await insert('overbooking_scan_runs', { property_id: f.property.id });
    expect(run.status).toBe('RUNNING');
    await rejects(
      'INSERT INTO overbooking_scan_runs(property_id) VALUES($1)',
      [f.property.id],
      '23505',
      'uq_overbooking_scan_runs_running',
    );
    expect(
      await rows(
        "UPDATE overbooking_scan_runs SET status='SUCCEEDED',finished_at=now(),duration_ms=42,scanned_count=7,version=999 WHERE id=$1 RETURNING status,version",
        [run.id],
      ),
    ).toEqual([{ status: 'SUCCEEDED', version: '2' }]);
    await rejects(
      "UPDATE overbooking_scan_runs SET status='FAILED',finished_at=NULL WHERE id=$1",
      [run.id],
      '23514',
    );
  });

  it('HB121_approval_guards_follow_actual_br', async () => {
    const f = await fixture();
    const b = await f.booking({ check_out: '2030-01-05' });
    const r = await f.bookingRoom(b);
    const free = await move(f, b, r);
    // F6-D04: same-property zero-cost relocation (tiers 1–2 / SPLIT_ROOMS) needs no manager.
    expect(
      await rows(
        "UPDATE room_moves SET status='APPROVED' WHERE id=$1 RETURNING status,approved_by",
        [free.id],
      ),
    ).toEqual([{ status: 'APPROVED', approved_by: null }]);
    expect(
      await rows("UPDATE room_moves SET status='EXECUTED' WHERE id=$1 RETURNING status", [free.id]),
    ).toEqual([{ status: 'EXECUTED' }]);
    for (const [field, value] of [
      ['compensation_amount', 5001],
      ['transport_cost', 200000],
    ] as const) {
      const paid = await move(f, b, r, { [field]: value });
      await rejects(
        "UPDATE room_moves SET status='APPROVED' WHERE id=$1",
        [paid.id],
        '23514',
        'ck_room_moves_approval',
      );
      expect(
        await rows(
          "UPDATE room_moves SET status='APPROVED',approved_by=$1 WHERE id=$2 RETURNING status",
          [f.user.id, paid.id],
        ),
      ).toEqual([{ status: 'APPROVED' }]);
    }
    await change('room_moves', free.id, 'price_locked', false, '23514', 'ck_room_moves_price_lock');
    const walkOut = await move(f, b, r, { move_type: 'WALK_OUT', to_room_id: null });
    await change(
      'room_moves',
      walkOut.id,
      'status',
      'EXECUTED',
      '23514',
      'ck_room_moves_walkout_doc',
    );
    expect(
      await rows(
        "UPDATE room_moves SET walk_out_doc_no='AUDIT-DOC',status='EXECUTED' WHERE id=$1 RETURNING status",
        [walkOut.id],
      ),
    ).toEqual([{ status: 'EXECUTED' }]);
    // MERGE_SHARE needs both consents; mixed-gender approval is service-enforced (gender is not stored).
    const shared = await merge(f, b, {
      secondary_booking_id: (await f.booking({ check_out: '2030-01-05' })).id,
      discount_pct: 0,
    });
    await change('room_merges', shared.id, 'status', 'ACTIVE', '23514', 'ck_room_merges_consent');
    expect(
      await rows(
        "UPDATE room_merges SET consent_primary=true,consent_secondary=true,status='ACTIVE' WHERE id=$1 RETURNING status,approved_by",
        [shared.id],
      ),
    ).toEqual([{ status: 'ACTIVE', approved_by: null }]);
    // The DDL keeps the money condition and deliberately leaves CHECKED_IN/gender to the service.
    const checks = await rows(
      "SELECT k.conname,pg_get_constraintdef(k.oid) definition FROM pg_constraint k WHERE k.conrelid='public.room_moves'::regclass AND k.contype='c'",
    );
    expect(checks.map((c) => c.conname)).toEqual(
      expect.arrayContaining(['ck_room_moves_approval', 'ck_room_moves_price_lock']),
    );
    expect(JSON.stringify(checks)).not.toContain('CHECKED_IN');
    expect(
      String(checks.find((c) => c.conname === 'ck_room_moves_approval')?.definition),
    ).toContain('compensation_amount + transport_cost');
  });

  it('HB121_connecting_and_compensation_approved_model', async () => {
    const f = await fixture();
    const b = await f.booking({ check_out: '2030-01-05' });
    // F6-D01: connecting is ONE booking with two reciprocal rooms and no consent flow.
    const connecting = await merge(f, b, {
      secondary_booking_id: null,
      secondary_room_id: f.room2.id,
      move_type: 'MERGE_CONNECTING',
      discount_pct: 10,
    });
    expect(connecting.secondary_booking_id ?? null).toBeNull();
    expect(
      await rows(
        "UPDATE room_merges SET status='ACTIVE' WHERE id=$1 RETURNING status,consent_primary,consent_secondary",
        [connecting.id],
      ),
    ).toEqual([{ status: 'ACTIVE', consent_primary: false, consent_secondary: false }]);
    const another = await f.booking({ check_out: '2030-01-05' });
    const shape =
      'INSERT INTO room_merges(primary_booking_id,secondary_booking_id,secondary_room_id,room_id,move_type,discount_pct) VALUES($1,$2,$3,$4,$5,0)';
    // Connecting never carries a second booking; SHARE never carries a second room.
    await rejects(
      shape,
      [another.id, b.id, f.dormRoom.id, f.room.id, 'MERGE_CONNECTING'],
      '23514',
      'ck_room_merges_secondary',
    );
    await rejects(
      shape,
      [another.id, (await f.booking()).id, f.dormRoom.id, f.room.id, 'MERGE_SHARE'],
      '23514',
      'ck_room_merges_secondary',
    );
    await rejects(
      "INSERT INTO room_merges(primary_booking_id,room_id,move_type,discount_pct) VALUES($1,$2,'MERGE_CONNECTING',0)",
      [another.id, f.dormRoom.id],
      '23514',
      'ck_room_merges_secondary',
    );
    await rejects(
      'INSERT INTO room_merges(primary_booking_id,secondary_booking_id,room_id,move_type,discount_pct) VALUES($1,$1,$2,$3,0)',
      [another.id, f.dormRoom.id, 'MERGE_SHARE'],
      '23514',
      'ck_room_merges_distinct',
    );
    // One ACTIVE merge per booking and per room, including the connecting secondary room.
    const room3 = await insert('rooms', {
      property_id: f.property.id,
      room_type_id: f.type.id,
      code: 'CS01-203',
      name: '203',
      bed_count: 2,
    });
    const room4 = await insert('rooms', {
      property_id: f.property.id,
      room_type_id: f.type.id,
      code: 'CS01-204',
      name: '204',
      bed_count: 2,
    });
    const third = await f.booking({ check_out: '2030-01-05' });
    const active =
      "INSERT INTO room_merges(primary_booking_id,secondary_room_id,room_id,move_type,discount_pct,status) VALUES($1,$2,$3,'MERGE_CONNECTING',0,'ACTIVE')";
    await rejects(active, [b.id, room4.id, room3.id], '23505', 'uq_room_merges_active_primary');
    await rejects(active, [another.id, room3.id, f.room.id], '23505', 'uq_room_merges_active_room');
    await rejects(
      active,
      [third.id, f.room2.id, room3.id],
      '23505',
      'uq_room_merges_active_secondary_room',
    );
    // F6-D06: one durable compensation Payment per approved RoomMove; the refund fund is untouched.
    const unit = await f.bookingRoom(b);
    const paid = await move(f, b, unit, {
      compensation_amount: 5001,
      status: 'APPROVED',
      approved_by: f.user.id,
    });
    const pay = (key: string, method = 'CASH', status = 'PENDING') =>
      insert('payments', {
        booking_id: b.id,
        type: 'COMPENSATION',
        method,
        amount: 5001,
        status,
        idempotency_key: key,
        created_by: f.user.id,
        room_move_id: paid.id,
      });
    const first = await pay('compensation-1');
    expect(first.room_move_id).toBe(paid.id);
    await rejects(
      "INSERT INTO payments(booking_id,type,method,amount,idempotency_key,created_by,room_move_id) VALUES($1,'COMPENSATION','BANK_TRANSFER',5001,'c2',$2,$3)",
      [b.id, f.user.id, paid.id],
      '23505',
      'uq_payments_room_move',
    );
    // A terminal failure releases the slot for one new attempt (a timeout keeps PENDING instead).
    await db.query("UPDATE payments SET status='FAILED' WHERE id=$1", [first.id]);
    const retried = await insert('payments', {
      booking_id: b.id,
      type: 'COMPENSATION',
      method: 'BANK_TRANSFER',
      amount: 5001,
      idempotency_key: 'c3',
      created_by: f.user.id,
      room_move_id: paid.id,
    });
    expect(
      await rows(
        "UPDATE payments SET status='SUCCEEDED',paid_at=now() WHERE id=$1 RETURNING status",
        [retried.id],
      ),
    ).toEqual([{ status: 'SUCCEEDED' }]);
    await rejects(
      "INSERT INTO payments(booking_id,type,method,amount,idempotency_key,created_by,room_move_id) VALUES($1,'COMPENSATION','CASH',5001,'c4',$2,$3)",
      [b.id, f.user.id, paid.id],
      '23505',
      'uq_payments_room_move',
    );
    await rejects(
      "INSERT INTO payments(booking_id,type,method,amount,idempotency_key,created_by,room_move_id) VALUES($1,'DEPOSIT','CASH',5001,'d1',$2,$3)",
      [b.id, f.user.id, paid.id],
      '23514',
      'ck_payments_compensation',
    );
    await rejects(
      "INSERT INTO payments(booking_id,type,method,amount,idempotency_key,created_by,room_move_id) VALUES($1,'COMPENSATION','VNPAY',5001,'c5',$2,$3)",
      [b.id, f.user.id, paid.id],
      '23514',
      'ck_payments_compensation',
    );
    // Compensation never routes through the refund quota table.
    expect(
      await rows(
        "SELECT count(*)::int n FROM information_schema.columns WHERE table_schema='public' AND table_name='refund_allocations' AND column_name='room_move_id'",
      ),
    ).toEqual([{ n: 0 }]);
  });
});
