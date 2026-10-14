import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import pg from 'pg';
import { randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../../../../', import.meta.url));
const migration = process.env.DATABASE_MIGRATION_URL;
let admin: pg.Client | undefined,
  db: pg.Client | undefined,
  name = '',
  url = '';
function run() {
  return spawnSync(process.execPath, [root + 'scripts/migrate.mjs'], {
    cwd: root,
    env: { ...process.env, DATABASE_MIGRATION_URL: url, DATABASE_URL: '' },
    encoding: 'utf8',
    timeout: 30000,
  });
}
beforeEach(async () => {
  if (!migration) throw Error('HB-178 requires real PostgreSQL16 and DATABASE_MIGRATION_URL');
  admin = new pg.Client({ connectionString: migration });
  await admin.connect();
  const version = Number(
    (await admin.query<{ server_version_num: string }>('SHOW server_version_num')).rows[0]
      ?.server_version_num,
  );
  expect(version).toBeGreaterThanOrEqual(160000);
  expect(version).toBeLessThan(170000);
  name = 'hb178_post_' + randomUUID().replaceAll('-', '');
  await admin.query(`CREATE DATABASE "${name}"`);
  const connection = new URL(migration);
  connection.pathname = '/' + name;
  url = connection.href;
  const first = run();
  expect(first.status, 'Fresh genuine migration must pass').toBe(0);
  db = new pg.Client({ connectionString: url });
  await db.connect();
});
afterEach(async () => {
  try {
    if (db) await db.end();
  } finally {
    if (admin) {
      try {
        if (name) await admin.query(`DROP DATABASE IF EXISTS "${name}" WITH(FORCE)`);
      } finally {
        await admin.end();
      }
    }
    db = undefined;
    admin = undefined;
    name = '';
    url = '';
  }
});
describe('HB-178 real PostgreSQL post-migration CLI gate', () => {
  it('repeated deploy passes with published constraints and append-only privileges intact', async () => {
    expect(run().status).toBe(0);
    expect(
      (
        await db!.query(
          "SELECT has_table_privilege('app_rw','public.audit_logs','UPDATE') AS allowed",
        )
      ).rows,
    ).toEqual([{ allowed: false }]);
  });
  it('a public table without a primary key fails after Prisma reports no pending migrations', async () => {
    await db!.query('CREATE TABLE public.hb178_synthetic_no_pk(value integer)');
    const result = run();
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('MIGRATION_VERIFY_PRIMARY_KEYS');
    expect(
      (await db!.query('SELECT count(*)::int AS n FROM public.hb178_synthetic_no_pk')).rows,
    ).toEqual([{ n: 0 }]);
  });
  it('missing anti-duplicate exclusion fails repeated deploy', async () => {
    await db!.query(
      'ALTER TABLE public.room_assignments DROP CONSTRAINT excl_booking_room_one_assignment',
    );
    const result = run();
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('MIGRATION_VERIFY_EXCLUSIONS');
  });
  it.each([
    {
      name: 'wrong units',
      sql: 'EXCLUDE USING gist (room_id WITH =, valid_range WITH &&) WHERE (released_at IS NULL)',
    },
    {
      name: 'wrong release predicate',
      sql: 'EXCLUDE USING gist (booking_room_id WITH =, valid_range WITH &&) WHERE (released_at IS NOT NULL)',
    },
  ])('same-name exclusion with $name fails, not merely a name-presence check', async ({ sql }) => {
    await db!.query(
      'ALTER TABLE public.room_assignments DROP CONSTRAINT excl_booking_room_one_assignment',
    );
    await db!.query(
      'ALTER TABLE public.room_assignments ADD CONSTRAINT excl_booking_room_one_assignment ' + sql,
    );
    const result = run();
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('MIGRATION_VERIFY_EXCLUSIONS');
  });
  it.each(['app_rw', 'PUBLIC'])(
    'effective audit UPDATE granted to %s blocks deploy',
    async (role) => {
      // role is a test-owned literal, never client input; only this owned database's table ACL changes.
      await db!.query('GRANT UPDATE ON public.audit_logs TO ' + role);
      const result = run();
      expect(result.status).toBe(1);
      expect(result.stderr).toContain('MIGRATION_VERIFY_AUDIT_UPDATE');
    },
  );
  it('database connection failures keep privileged URLs and credentials out of CLI output', () => {
    const actual = new URL(url),
      missing = new URL(url);
    // Prisma may create a missing database. A nonexistent login role cannot authenticate instead.
    missing.username = 'hb178_missing_role_' + randomUUID().replaceAll('-', '');
    const syntheticCredential = 'HB178-' + randomUUID();
    missing.password = syntheticCredential;
    url = missing.href;
    const result = run(),
      output = result.stdout + result.stderr;
    expect(result.status).toBe(1);
    expect(output.includes(missing.href)).toBe(false);
    expect(output.includes(syntheticCredential)).toBe(false);
    const password = decodeURIComponent(actual.password);
    expect(password === '' || !output.includes(password)).toBe(true);
  });
});
