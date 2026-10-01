import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';

const root = fileURLToPath(new URL('../../../../', import.meta.url));
const source = '8a3b9f9540237fac404c25c1405af007043fb50d';
const schema = `${root}apps/api/prisma/schema.prisma`;
const migration = `${root}apps/api/prisma/migrations/0001_baseline/migration.sql`;
const owner = process.env.DATABASE_MIGRATION_URL;
const run = (script: string, env: Record<string, string>, args: string[] = []) =>
  spawnSync(process.execPath, [script, ...args], {
    cwd: root,
    env: { ...process.env, DATABASE_URL: '', DATABASE_MIGRATION_URL: '', ...env },
    encoding: 'utf8',
    timeout: 60000,
  });
const migrate = (url: string) => run(`${root}scripts/migrate.mjs`, { DATABASE_MIGRATION_URL: url });
const require = createRequire(import.meta.url);

interface Block {
  sql: string;
  line: number;
}
const docsPath = `${root}scripts/lib/docs.mjs`;
function isDocs(value: unknown): value is {
  sqlBlocks: (source: string, heading?: RegExp, level?: number) => Block[];
} {
  return (
    typeof value === 'object' &&
    value !== null &&
    'sqlBlocks' in value &&
    typeof value.sqlBlocks === 'function'
  );
}
const docs: unknown = await import(docsPath);
if (!isDocs(docs)) throw new Error('SQL parser export missing');
interface Fixtures {
  room: { id: string };
  booking: () => Promise<{ id: string }>;
  bookingRoom: (b: { id: string }) => Promise<{ id: string }>;
}
function isFixtures(value: unknown): value is {
  fixture: (db: { query: pg.Client['query'] }) => Promise<Fixtures>;
} {
  return (
    typeof value === 'object' &&
    value !== null &&
    'fixture' in value &&
    typeof value.fixture === 'function'
  );
}
const frozenDocument = spawnSync('git', ['show', `${source}:docs/04-thiet-ke/csdl.md`], {
  cwd: root,
  encoding: 'utf8',
});
if (frozenDocument.status !== 0) throw new Error('Frozen SQL source unavailable');
const frozenBlocks = docs.sqlBlocks(frozenDocument.stdout);
const frozenDDL = frozenBlocks
  .map((block) => `-- docs/04-thiet-ke/csdl.md:${block.line}\n${block.sql}\n`)
  .join('');

// All catalog queries intentionally retain SQL-only objects and privileges.
const catalogs = {
  schemas: `SELECT nspname,nspacl FROM pg_namespace WHERE nspname='public'`,
  relations: `SELECT c.relname, c.relkind, c.relpersistence, c.relrowsecurity,
    c.relforcerowsecurity, c.relreplident, c.reloptions, c.relacl
    FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='public' AND c.relname NOT IN ('_prisma_migrations','_prisma_migrations_pkey')
    ORDER BY c.relname`,
  columns: `SELECT c.relname, a.attname, a.attnum, format_type(a.atttypid,a.atttypmod) type,
    a.attnotnull, a.attidentity, a.attgenerated, a.attacl,
    pg_get_expr(d.adbin,d.adrelid) expression
    FROM pg_attribute a JOIN pg_class c ON c.oid=a.attrelid
    JOIN pg_namespace n ON n.oid=c.relnamespace
    LEFT JOIN pg_attrdef d ON d.adrelid=c.oid AND d.adnum=a.attnum
    WHERE n.nspname='public' AND a.attnum>0 AND NOT a.attisdropped
    AND c.relname NOT IN ('_prisma_migrations','_prisma_migrations_pkey') ORDER BY c.relname,a.attnum`,
  constraints: `SELECT c.relname,k.conname,k.contype,k.condeferrable,k.condeferred,k.convalidated,
    pg_get_constraintdef(k.oid) definition FROM pg_constraint k
    JOIN pg_class c ON c.oid=k.conrelid JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='public' AND c.relname <> '_prisma_migrations'
    ORDER BY c.relname,k.conname`,
  indexes: `SELECT tablename,indexname,indexdef FROM pg_indexes WHERE schemaname='public'
    AND tablename <> '_prisma_migrations' ORDER BY tablename,indexname`,
  triggers: `SELECT c.relname,t.tgname,t.tgenabled,pg_get_triggerdef(t.oid) definition
    FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid
    JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public'
    AND NOT t.tgisinternal AND c.relname <> '_prisma_migrations' ORDER BY c.relname,t.tgname`,
  functions: `SELECT p.proname,pg_get_function_identity_arguments(p.oid) arguments,
    pg_get_functiondef(p.oid) definition,p.proacl FROM pg_proc p
    JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public'
    AND p.prokind='f' ORDER BY p.proname,arguments`,
  sequences: `SELECT sequencename,data_type,start_value,min_value,max_value,increment_by,
    cycle,cache_size FROM pg_sequences WHERE schemaname='public' ORDER BY sequencename`,
  defaults: `SELECT r.rolname,n.nspname,d.defaclobjtype,d.defaclacl FROM pg_default_acl d
    JOIN pg_roles r ON r.oid=d.defaclrole LEFT JOIN pg_namespace n ON n.oid=d.defaclnamespace
    ORDER BY r.rolname,n.nspname,d.defaclobjtype`,
  privileges: `SELECT table_name,grantee,privilege_type,is_grantable FROM information_schema.table_privileges
    WHERE table_schema='public' AND table_name <> '_prisma_migrations'
    ORDER BY table_name,grantee,privilege_type`,
};
async function snapshot(client: pg.Client) {
  const entries: [string, unknown][] = [];
  for (const [name, sql] of Object.entries(catalogs)) {
    entries.push([name, (await client.query(sql)).rows]);
  }
  return Object.fromEntries(entries);
}

describe('frozen baseline and migration CLI', () => {
  it('preserves source-commit extractor stdout byte for byte', async () => {
    expect(await readFile(migration, 'utf8')).toBe(`-- Source SHA: ${source}\n${frozenDDL}`);
  });
  it.each(['', 'postgresql://owner:guard-secret@127.0.0.1/postgres'])(
    'rejects missing or runtime-identical owner with no secret output: %s',
    (url) => {
      const result = run(`${root}scripts/migrate.mjs`, {
        DATABASE_MIGRATION_URL: url,
        DATABASE_URL: url,
      });
      expect(result.status).not.toBe(0);
      expect(result.stderr).toContain('DATABASE_MIGRATION_URL');
      expect(result.stdout + result.stderr).not.toContain('guard-secret');
    },
  );
  it('rejects absent owner for drift before touching a database', () => {
    const result = run(`${root}apps/api/prisma/drift.mjs`, {});
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('DATABASE_MIGRATION_URL');
  });
});

describe('real PostgreSQL 16 migration certification', () => {
  if (!owner) console.warn('SKIP PostgreSQL integration: DATABASE_MIGRATION_URL absent');
  it.skipIf(!owner)(
    'certifies deploy, SQL parity, runtime invariants, client and drift',
    async () => {
      const admin = new pg.Client({ connectionString: owner });
      const names = ['migration', 'reference'].map(
        (part) => `hb005_${part}_${randomUUID().replaceAll('-', '')}`,
      );
      const clients: pg.Client[] = [];
      await admin.connect();
      try {
        const version = Number(
          (await admin.query<{ server_version_num: string }>('SHOW server_version_num')).rows[0]
            ?.server_version_num,
        );
        expect(version).toBeGreaterThanOrEqual(160000);
        expect(version).toBeLessThan(170000);
        const urls: string[] = [];
        for (const name of names) {
          await admin.query(`CREATE DATABASE "${name}"`);
          const url = new URL(owner!);
          url.pathname = `/${name}`;
          urls.push(url.href);
          const client = new pg.Client({ connectionString: url.href });
          await client.connect();
          clients.push(client);
        }
        const deployed = clients[0]!;
        const reference = clients[1]!;
        const url = urls[0]!;
        const first = migrate(url);
        expect(first.status, first.stderr).toBe(0);
        await reference.query(frozenDDL);
        expect(
          (
            await deployed.query(
              "SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename <> '_prisma_migrations'",
            )
          ).rows,
        ).toHaveLength(42);
        expect(await snapshot(deployed)).toEqual(await snapshot(reference));
        const before = await snapshot(deployed);
        const history = (
          await deployed.query<{ migration_name: string }>(
            'SELECT * FROM _prisma_migrations ORDER BY id',
          )
        ).rows;
        expect(history).toHaveLength(1);
        expect(history[0]!.migration_name).toBe('0001_baseline');
        expect(
          (
            await deployed.query(
              "SELECT has_table_privilege('app_rw','public._prisma_migrations','SELECT') s, has_table_privilege('app_rw','public._prisma_migrations','INSERT') i, has_table_privilege('app_rw','public._prisma_migrations','UPDATE') u, has_table_privilege('app_rw','public._prisma_migrations','DELETE') d",
            )
          ).rows,
        ).toEqual([{ s: false, i: false, u: false, d: false }]);
        const second = migrate(url);
        expect(second.status, second.stderr).toBe(0);
        expect(await snapshot(deployed)).toEqual(before);
        expect(
          (
            await deployed.query<{ migration_name: string }>(
              'SELECT * FROM _prisma_migrations ORDER BY id',
            )
          ).rows,
        ).toEqual(history);
        const currentDoc = await readFile(`${root}docs/04-thiet-ke/csdl.md`, 'utf8');
        const checks = docs.sqlBlocks(currentDoc, /^8\.3\./, 3);
        expect(checks).toHaveLength(1);
        const results = await deployed.query(checks[0]!.sql);
        expect(Array.isArray(results)).toBe(true);
        const queryResults = z
          .array(
            z.object({
              rows: z.array(z.record(z.string(), z.unknown())),
            }),
          )
          .parse(results);
        expect(queryResults[0]!.rows).toEqual([]);
        expect(queryResults[1]!.rows).toHaveLength(2);
        expect(queryResults[1]!.rows.map((row) => row.conname).sort()).toEqual([
          'excl_booking_room_one_assignment',
          'excl_room_assignments_no_double_booking',
        ]);
        expect(
          queryResults[1]!.rows.every((row) =>
            z.string().parse(row.pg_get_constraintdef).includes('EXCLUDE USING gist'),
          ),
        ).toBe(true);
        expect(queryResults[2]!.rows).toEqual([{ can_update: false }]);
        const runtimeUrl = new URL(url);
        runtimeUrl.username = 'app_rw';
        runtimeUrl.password = randomUUID();
        const roles = run(`${root}apps/api/prisma/dev-roles.mjs`, {
          DATABASE_MIGRATION_URL: url,
          DATABASE_URL: runtimeUrl.href,
          NODE_ENV: 'development',
        });
        expect(roles.status, roles.stderr).toBe(0);
        const runtime = new pg.Client({ connectionString: runtimeUrl.href });
        await runtime.connect();
        clients.push(runtime);
        expect((await runtime.query('SELECT current_user')).rows).toEqual([
          { current_user: 'app_rw' },
        ]);
        expect(
          (
            await runtime.query(
              "SELECT has_table_privilege('app_rw','audit_logs','SELECT') s, has_table_privilege('app_rw','audit_logs','INSERT') i",
            )
          ).rows,
        ).toEqual([{ s: true, i: true }]);
        await runtime.query('SELECT * FROM audit_logs');
        await runtime.query(
          "INSERT INTO audit_logs(actor_role,action,entity_type) VALUES ('MANAGER','TEST','test')",
        );
        await expect(runtime.query("UPDATE audit_logs SET action='bad'")).rejects.toMatchObject({
          code: '42501',
        });
        await expect(runtime.query('DELETE FROM audit_logs')).rejects.toMatchObject({
          code: '42501',
        });
        const fixturePath = `${root}tests/helpers/database.mjs`;
        const fixtures: unknown = await import(fixturePath);
        if (!isFixtures(fixtures)) throw new Error('Fixture export missing');
        const data = await fixtures.fixture({ query: deployed.query.bind(deployed) });
        const booking = await data.booking();
        const roomA = await data.bookingRoom(booking);
        const roomB = await data.bookingRoom(booking);
        expect(
          (await deployed.query('SELECT id FROM rooms WHERE id=$1', [data.room.id])).rows,
        ).toHaveLength(1);
        expect(
          (
            await deployed.query(
              'SELECT id FROM booking_rooms WHERE id=ANY($1::uuid[]) AND booking_id=$2',
              [[roomA.id, roomB.id], booking.id],
            )
          ).rows,
        ).toHaveLength(2);
        const sql =
          "INSERT INTO room_assignments(booking_room_id,room_id,bed_no,start_date,end_date) VALUES($1,$2,0,'2030-01-01','2030-01-03')";
        await runtime.query(sql, [roomA.id, data.room.id]);
        await expect(runtime.query(sql, [roomB.id, data.room.id])).rejects.toMatchObject({
          code: '23P01',
        });
        const prisma = require.resolve('prisma/build/index.js');
        const originalSchema = await readFile(schema, 'utf8');
        const directory = await mkdtemp(join(tmpdir(), 'hb005-introspection-'));
        const pulledSchema = join(directory, 'schema.prisma');
        try {
          await writeFile(pulledSchema, originalSchema);
          const pull = run(prisma, { DATABASE_URL: url }, ['db', 'pull', '--schema', pulledSchema]);
          expect(pull.status, pull.stderr).toBe(0);
          expect(pull.stdout).toContain('Introspected 42 models');
          expect(await readFile(pulledSchema, 'utf8')).toBe(originalSchema);
          expect(await readFile(schema, 'utf8')).toBe(originalSchema);
        } finally {
          await rm(directory, { recursive: true, force: true });
        }
        const generate = run(prisma, { DATABASE_URL: url }, ['generate', '--schema', schema]);
        expect(generate.status, generate.stderr).toBe(0);
        const clientModule: {
          PrismaClient: new (options: { datasources: { db: { url: string } } }) => {
            users: { count: () => Promise<number> };
            $disconnect: () => Promise<void>;
          };
        } = await import('@prisma/client');
        const client = new clientModule.PrismaClient({
          datasources: { db: { url: runtimeUrl.href } },
        });
        try {
          expect(await client.users.count()).toBe(2);
        } finally {
          await client.$disconnect();
        }
        const drift = run(`${root}apps/api/prisma/drift.mjs`, { DATABASE_MIGRATION_URL: url });
        expect(drift.status, drift.stderr).toBe(0);
        expect(drift.stdout).toContain('No drift');
      } finally {
        for (const client of clients) await client.end();
        for (const name of names)
          await admin.query(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
        await admin.end();
      }
    },
    180000,
  );
});
