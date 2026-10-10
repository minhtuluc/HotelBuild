import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { expect } from 'vitest';
import { baselineFixture } from '../migration/baseline-fixture.js';

export const root = fileURLToPath(new URL('../../../../', import.meta.url));
export async function allotmentFixture() {
  const owner = process.env.DATABASE_MIGRATION_URL;
  if (!owner) throw new Error('Allotment scope requires real PostgreSQL16 owner URL');
  const admin = new pg.Client({ connectionString: owner });
  const name = `allotments_${randomUUID().replaceAll('-', '')}`;
  const parsed = new URL(owner);
  parsed.pathname = `/${name}`;
  const url = parsed.href;
  const db = new pg.Client({ connectionString: url });
  let created = false;
  let directory: string | undefined;
  const migrate = (script = `${root}scripts/migrate.mjs`) => {
    const result = spawnSync(process.execPath, [script], {
      cwd: root,
      encoding: 'utf8',
      timeout: 60000,
      env: { ...process.env, DATABASE_URL: '', DATABASE_MIGRATION_URL: url },
    });
    expect(result.status, result.stderr).toBe(0);
  };
  const close = async () => {
    try {
      await db.end();
    } finally {
      try {
        if (created) await admin.query(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
      } finally {
        try {
          await admin.end();
        } finally {
          if (directory) await rm(directory, { recursive: true, force: true });
        }
      }
    }
  };
  try {
    await admin.connect();
    expect(
      (await admin.query<{ server_version_num: string }>('SHOW server_version_num')).rows[0]
        ?.server_version_num,
    ).toMatch(/^16/);
    await admin.query(`CREATE DATABASE "${name}"`);
    created = true;
    await db.connect();
    await db.query("SET TIME ZONE 'UTC'; SET statement_timeout='10s'");
    const frozen = await baselineFixture(root);
    directory = frozen.directory;
    migrate(frozen.migrate);
    const property = (
      await db.query<{ id: string }>(
        "INSERT INTO properties(code,name,address,phone,latitude,longitude) VALUES('FIXTURE','Fixture','Fixture','+84900000000',11,108) RETURNING id",
      )
    ).rows[0]!.id;
    const type = (
      await db.query<{ id: string }>(
        "INSERT INTO room_types(property_id,code,name,capacity_adults,base_price,min_price,max_price) VALUES($1,'STD','Fixture',2,650000,450000,1600000) RETURNING id",
        [property],
      )
    ).rows[0]!.id;
    await db.query(
      "INSERT INTO rooms(property_id,room_type_id,code,name,bed_count) VALUES($1,$2,'R1','Fixture',2),($1,$2,'R2','Fixture',2)",
      [property, type],
    );
    const channel = async () =>
      (
        await db.query<{ id: string }>(
          "INSERT INTO channels(code,name,multiplier) SELECT code,'Fixture',1 FROM unnest(ARRAY['WEB','PHONE','WALKIN','OTA_BOOKING','OTA_AGODA','OTA_AIRBNB','AGENCY']) code WHERE NOT EXISTS(SELECT 1 FROM channels c WHERE c.code=code.code) LIMIT 1 RETURNING id",
        )
      ).rows[0]!.id;
    const legacyChannel = await channel();
    await db.query(
      "INSERT INTO channel_allotments(channel_id,room_type_id,date,allotment,version) VALUES($1,$2,'2030-01-01',1,9),($1,$2,'2030-01-02',1,1)",
      [legacyChannel, type],
    );
    const legacyRows = (await db.query('SELECT * FROM channel_allotments ORDER BY date')).rows;
    migrate();
    return { db, url, type, channel, legacyChannel, legacyRows, migrate, close };
  } catch (error) {
    await close();
    throw error;
  }
}
