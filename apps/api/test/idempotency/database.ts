import { randomBytes, randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { PrismaClient } from '@prisma/client';
import { hash } from '@node-rs/argon2';
import pg from 'pg';
import { beforeAll, beforeEach, afterAll, expect } from 'vitest';
export const clock = {
  value: Date.UTC(2026, 9, 9),
  now() {
    return new Date(this.value);
  },
};
export const ids = { generate: () => randomUUID() };
export const password = 'Synthetic-HB029-only!';
export let databaseUrl = '',
  userId = '',
  secondUserId = '',
  propertyId = '',
  otherPropertyId = '';
export let db: PrismaClient;
let admin: pg.Client, owner: pg.Client;
const name = `hb029_${randomUUID().replaceAll('-', '')}`;
const role = `hb029_${randomUUID().replaceAll('-', '')}`;
const root = fileURLToPath(new URL('../../../../', import.meta.url));
export async function rows(sql: string, values: unknown[] = []) {
  return (await owner.query<Record<string, unknown>>(sql, values)).rows;
}
export async function count() {
  return Number((await rows("SELECT value FROM system_settings WHERE key='H029'"))[0]!.value);
}
export async function auditCount() {
  return Number(
    (await rows("SELECT count(*) AS n FROM audit_logs WHERE action='H029_COMMAND'"))[0]!.n,
  );
}
beforeAll(async () => {
  const url = process.env.DATABASE_MIGRATION_URL;
  if (!url) throw new Error('HB029 requires PostgreSQL16; no skip fallback');
  admin = new pg.Client({ connectionString: url });
  await admin.connect();
  await admin.query(`CREATE DATABASE "${name}"`);
  const ownerUrl = new URL(url);
  ownerUrl.pathname = `/${name}`;
  const migration = spawnSync(process.execPath, [`${root}scripts/migrate.mjs`], {
    cwd: root,
    env: { ...process.env, DATABASE_MIGRATION_URL: ownerUrl.href, DATABASE_URL: '' },
    encoding: 'utf8',
  });
  expect(migration.status).toBe(0);
  owner = new pg.Client({ connectionString: ownerUrl.href });
  await owner.connect();
  const pass = randomBytes(24).toString('hex');
  const quoted = (
    await admin.query<{ literal: string }>('SELECT quote_literal($1) AS literal', [pass])
  ).rows[0]!.literal;
  await admin.query(`CREATE ROLE "${role}" LOGIN INHERIT PASSWORD ${quoted}`);
  await admin.query(`GRANT app_rw TO "${role}"`);
  const runtime = new URL(ownerUrl);
  runtime.username = role;
  runtime.password = pass;
  databaseUrl = runtime.href;
  db = new PrismaClient({ datasourceUrl: databaseUrl });
  const encoded = await hash(password, { memoryCost: 19456, timeCost: 2, parallelism: 1 });
  for (const username of ['h029-first', 'h029-second']) {
    const id = String(
      (
        await rows(
          "INSERT INTO users(username,password_hash,full_name,role) VALUES($1,$2,'Synthetic','FRONT_DESK') RETURNING id",
          [username, encoded],
        )
      )[0]!.id,
    );
    if (username.endsWith('first')) userId = id;
    else secondUserId = id;
  }
  for (const code of ['H029-A', 'H029-B']) {
    const id = String(
      (
        await rows(
          'INSERT INTO properties(code,name,address,phone,latitude,longitude) VALUES($1,$1,$1,$1,0,0) RETURNING id',
          [code],
        )
      )[0]!.id,
    );
    if (code.endsWith('A')) propertyId = id;
    else otherPropertyId = id;
  }
  await rows(
    'INSERT INTO user_property_scopes(user_id,property_id) VALUES($1::uuid,$3::uuid),($2::uuid,$3::uuid)',
    [userId, secondUserId, propertyId],
  );
  await rows("INSERT INTO system_settings(key,value,value_type) VALUES('H029','0','NUMBER')");
}, 60000);
beforeEach(async () => {
  clock.value += 61000;
  await rows('DELETE FROM idempotency_keys');
  await rows("UPDATE system_settings SET value='0' WHERE key='H029'");
  await rows("UPDATE users SET role='FRONT_DESK',is_active=true WHERE id=ANY($1::uuid[])", [
    [userId, secondUserId],
  ]);
  await rows(
    'INSERT INTO user_property_scopes(user_id,property_id) VALUES($1::uuid,$3::uuid),($2::uuid,$3::uuid) ON CONFLICT DO NOTHING',
    [userId, secondUserId, propertyId],
  );
});
afterAll(async () => {
  await db?.$disconnect();
  await owner?.end();
  if (admin) {
    await admin.query(`DROP DATABASE IF EXISTS "${name}" WITH(FORCE)`);
    await admin.query(`DROP ROLE IF EXISTS "${role}"`);
    await admin.end();
  }
}, 30000);
