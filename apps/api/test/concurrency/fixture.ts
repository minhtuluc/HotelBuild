import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { expect } from 'vitest';

const root = fileURLToPath(new URL('../../../../', import.meta.url));
async function id(db: pg.Client, sql: string, values: unknown[] = []): Promise<string> {
  return (await db.query<{ id: string }>(sql, values)).rows[0]!.id;
}
export async function createFixture() {
  const owner = process.env.DATABASE_MIGRATION_URL;
  if (!owner) throw new Error('HB-008 requires real PostgreSQL16 and DATABASE_MIGRATION_URL');
  const admin = new pg.Client({ connectionString: owner, connectionTimeoutMillis: 5000 });
  const database = `hb008_${randomUUID().replaceAll('-', '')}`;
  const connection = new URL(owner);
  connection.pathname = `/${database}`;
  let db: pg.Client | undefined;
  let created = false;
  const close = async () => {
    try {
      await db?.end();
      if (created) await admin.query(`DROP DATABASE "${database}" WITH (FORCE)`);
    } finally {
      await admin.end();
    }
  };
  try {
    await admin.connect();
    expect(
      (await admin.query<{ server_version_num: string }>('SHOW server_version_num')).rows[0]
        ?.server_version_num,
    ).toMatch(/^16/);
    expect(
      Number(
        (await admin.query<{ max_connections: string }>('SHOW max_connections')).rows[0]
          ?.max_connections,
      ),
    ).toBeGreaterThanOrEqual(60);
    await admin.query(`CREATE DATABASE "${database}"`);
    created = true;
    const migration = spawnSync(process.execPath, [`${root}scripts/migrate.mjs`], {
      cwd: root,
      env: { ...process.env, DATABASE_MIGRATION_URL: connection.href, DATABASE_URL: '' },
      encoding: 'utf8',
      timeout: 60000,
    });
    expect(migration.status, 'Published migrations must succeed before concurrency checks').toBe(0);
    db = new pg.Client({ connectionString: connection.href });
    await db.connect();
    await db.query("SET TIME ZONE 'UTC'; SET statement_timeout='10s'");
    const property = await id(
      db,
      "INSERT INTO properties(code,name,address,phone,latitude,longitude) VALUES('HB008','Fixture','Synthetic','+84900000000',11,108) RETURNING id",
    );
    const type = await id(
      db,
      "INSERT INTO room_types(property_id,code,name,capacity_adults,base_price,min_price,max_price) VALUES($1,'STD','Private',2,650000,450000,1600000) RETURNING id",
      [property],
    );
    const dormType = await id(
      db,
      "INSERT INTO room_types(property_id,code,name,capacity_adults,allow_shared,base_price,min_price,max_price) VALUES($1,'DOR','Dorm',6,true,200000,100000,400000) RETURNING id",
      [property],
    );
    const room = await id(
      db,
      "INSERT INTO rooms(property_id,room_type_id,code,name) VALUES($1,$2,'P1','Private1') RETURNING id",
      [property, type],
    );
    const room2 = await id(
      db,
      "INSERT INTO rooms(property_id,room_type_id,code,name) VALUES($1,$2,'P2','Private2') RETURNING id",
      [property, type],
    );
    const dorm = await id(
      db,
      "INSERT INTO rooms(property_id,room_type_id,code,name,bed_count) VALUES($1,$2,'D1','Dorm',6) RETURNING id",
      [property, dormType],
    );
    const guest = await id(
      db,
      "INSERT INTO guests(full_name,phone) VALUES('Synthetic guest','+84912345678') RETURNING id",
    );
    const channel = await id(
      db,
      "INSERT INTO channels(code,name,multiplier) VALUES('WEB','Web',1) RETURNING id",
    );
    const policy = await id(
      db,
      "INSERT INTO cancellation_policies(code,name) VALUES('HB008','Fixture') RETURNING id",
    );
    const plan = await id(
      db,
      "INSERT INTO rate_plans(code,name,deposit_percent,cancellation_policy_id) VALUES('FLEX7','Fixture',50,$1) RETURNING id",
      [policy],
    );
    await db.query(
      `INSERT INTO bookings(code,guest_id,property_id,room_type_id,rate_plan_id,channel_id,check_in,check_out,adults,deposit_percent)
      SELECT 'PH-300101-'||lpad(i::text,5,'0'),$1,$2,$3,$4,$5,'2030-01-01','2030-12-31',1,50 FROM generate_series(1,200) i`,
      [guest, property, type, plan, channel],
    );
    const contenders = (
      await db.query<{
        id: string;
      }>(`INSERT INTO booking_rooms(booking_id,room_type_id,adults,price_per_night)
      SELECT id,room_type_id,1,650000 FROM bookings RETURNING id`)
    ).rows.map((row) => row.id);
    let serial = 1000;
    const client = db;
    const bookingRoom = async (shared = false) =>
      id(
        client,
        `WITH booking AS (
      INSERT INTO bookings(code,guest_id,property_id,room_type_id,rate_plan_id,channel_id,check_in,check_out,adults,deposit_percent)
      VALUES($1,$2,$3,$4,$5,$6,'2030-01-01','2030-12-31',1,50) RETURNING id,room_type_id)
      INSERT INTO booking_rooms(booking_id,room_type_id,adults,price_per_night)
      SELECT id,room_type_id,1,650000 FROM booking RETURNING id`,
        [
          `PH-300101-${String(++serial).padStart(5, '0')}`,
          guest,
          property,
          shared ? dormType : type,
          plan,
          channel,
        ],
      );
    return { db, url: connection.href, room, room2, dorm, contenders, bookingRoom, close };
  } catch (error) {
    await close();
    throw error;
  }
}
