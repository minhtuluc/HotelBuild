import { randomUUID } from 'node:crypto';
import assert from 'node:assert/strict';
import { extractDDL } from '../../scripts/extract-sql.mjs';

export const realPostgres = process.env.OOAD_DB === 'postgres';

export async function openDatabase() {
  let db;
  if (realPostgres) {
    if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required; no embedded fallback');
    const { Client } = await import('pg');
    const admin = new Client({ connectionString: process.env.DATABASE_URL });
    await admin.connect();
    const version = Number((await admin.query('SHOW server_version_num')).rows[0].server_version_num);
    if (version < 160000 || version >= 170000) {
      await admin.end();
      throw new Error(`Expected real PostgreSQL 16, got server_version_num=${version}`);
    }
    const name = `ooad_test_${randomUUID().replaceAll('-', '')}`;
    const connection = new URL(process.env.DATABASE_URL);
    connection.pathname = `/${name}`;
    let client;
    try {
      await admin.query(`CREATE DATABASE "${name}"`);
      client = new Client({ connectionString: connection.href });
      await client.connect();
      db = {
        query: (sql, params) => client.query(sql, params),
        exec: (sql) => client.query(sql),
        connect: async () => {
          const extra = new Client({ connectionString: connection.href });
          await extra.connect();
          await extra.query("SET statement_timeout = '10s'");
          return extra;
        },
        close: async () => {
          await client.end();
          try { await admin.query(`DROP DATABASE "${name}" WITH (FORCE)`); }
          finally { await admin.end(); }
        },
      };
    } catch (error) {
      if (client) await client.end();
      try { await admin.query(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`); }
      finally { await admin.end(); }
      throw error;
    }
    console.log('Backend: real PostgreSQL 16; isolated temporary database; multi-session tests enabled.');
  } else {
    const [{ PGlite }, { btree_gist }, { pgcrypto }] = await Promise.all([
      import('@electric-sql/pglite'), import('@electric-sql/pglite/contrib/btree_gist'),
      import('@electric-sql/pglite/contrib/pgcrypto'),
    ]);
    const embedded = new PGlite({ extensions: { btree_gist, pgcrypto } });
    db = { query: (sql, params) => embedded.query(sql, params), exec: (sql) => embedded.exec(sql), close: () => embedded.close() };
    console.log('Backend: embedded PGlite (not PostgreSQL 16 certification); concurrent sessions unsupported.');
  }
  try {
    await db.exec("SET TIME ZONE 'UTC'; SET statement_timeout = '10s';");
    const blocks = await extractDDL();
    for (const block of blocks) {
      try { await db.exec(block.sql); }
      catch (error) { throw new Error(`DDL docs/04-thiet-ke/csdl.md:${block.line}: ${error.message}`, { cause: error }); }
    }
    console.log(`Loaded ${blocks.length} SQL blocks from csdl.md §3 only. ${(await db.query('SELECT version()')).rows[0].version}`);
    return db;
  } catch (error) { await db.close(); throw error; }
}

export async function rejectsSQL(db, sql, params, code) {
  await db.exec('SAVEPOINT expected_failure');
  let caught;
  try { await db.query(sql, params); } catch (error) { caught = error; }
  finally { await db.exec('ROLLBACK TO SAVEPOINT expected_failure; RELEASE SAVEPOINT expected_failure;'); }
  assert.ok(caught, `Expected SQLSTATE ${code}; SQL unexpectedly succeeded: ${sql}`);
  assert.equal(caught.code, code, caught.message);
}

export async function insert(db, table, values) {
  const keys = Object.keys(values);
  // Table and column names are test-owned constants, never untrusted input.
  return (await db.query(`INSERT INTO ${table} (${keys.join(',')}) VALUES (${keys.map((_, i) => `$${i + 1}`).join(',')}) RETURNING *`, Object.values(values))).rows[0];
}

export async function fixture(db) {
  const user = await insert(db, 'users', { username: 'manager', password_hash: 'test-only', full_name: 'Test manager', role: 'MANAGER' });
  const otherUser = await insert(db, 'users', { username: 'owner', password_hash: 'test-only', full_name: 'Independent owner', role: 'OWNER' });
  const property = await insert(db, 'properties', { code: 'CS01', name: 'Test property', address: 'Test', phone: '+84900000000', latitude: 11, longitude: 108 });
  const type = await insert(db, 'room_types', { property_id: property.id, code: 'STD', name: 'Standard', capacity_adults: 2, base_price: 650000, min_price: 450000, max_price: 1600000 });
  const dorm = await insert(db, 'room_types', { property_id: property.id, code: 'DOR', name: 'Dorm', capacity_adults: 6, allow_shared: true, base_price: 200000, min_price: 100000, max_price: 400000 });
  const room = await insert(db, 'rooms', { property_id: property.id, room_type_id: type.id, code: 'CS01-201', name: '201', bed_count: 2 });
  const room2 = await insert(db, 'rooms', { property_id: property.id, room_type_id: type.id, code: 'CS01-202', name: '202', bed_count: 2 });
  const dormRoom = await insert(db, 'rooms', { property_id: property.id, room_type_id: dorm.id, code: 'CS01-301', name: '301', bed_count: 6 });
  const web = await insert(db, 'channels', { code: 'WEB', name: 'Web', multiplier: 1 });
  const ota = await insert(db, 'channels', { code: 'OTA_BOOKING', name: 'OTA', multiplier: 1.2 });
  const policy = await insert(db, 'cancellation_policies', { code: 'TEST', name: 'Test policy' });
  const plan = await insert(db, 'rate_plans', { code: 'FLEX7', name: 'Flexible', deposit_percent: 50, cancellation_policy_id: policy.id });
  const guest = await insert(db, 'guests', { full_name: 'Test guest', phone: '+84912345678' });
  let serial = 0;
  const booking = async (overrides = {}) => insert(db, 'bookings', {
    code: `PH-300101-${String(++serial).padStart(5, '0')}`, guest_id: guest.id, property_id: property.id,
    room_type_id: type.id, rate_plan_id: plan.id, channel_id: web.id,
    check_in: '2030-01-01', check_out: '2030-01-03', adults: 1, deposit_percent: 50, ...overrides,
  });
  const bookingRoom = async (b, overrides = {}) => insert(db, 'booking_rooms', { booking_id: b.id, room_type_id: b.room_type_id, adults: 1, price_per_night: 650000, ...overrides });
  const assignment = async (br, overrides = {}) => insert(db, 'room_assignments', { booking_room_id: br.id, room_id: room.id, bed_no: 0, start_date: '2030-01-01', end_date: '2030-01-03', ...overrides });
  return { user, otherUser, property, type, dorm, room, room2, dormRoom, web, ota, policy, plan, guest, booking, bookingRoom, assignment };
}
