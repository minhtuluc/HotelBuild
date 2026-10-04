import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { afterAll, afterEach, beforeAll, beforeEach, expect, test } from 'vitest';

const root = fileURLToPath(new URL('../../../../', import.meta.url));
const owner = process.env.DATABASE_MIGRATION_URL;
const tables = [
  'auth_sessions',
  'guest_credentials',
  'guest_password_resets',
  'pin_grants',
  'user_pins',
];
let admin: pg.Client;
let db: pg.Client;
let reference: pg.Client;
const names: string[] = [];
const clients: pg.Client[] = [];
let url: string;
let user: string;
let guest: string;
let before: Record<string, unknown>;
let firstCatalog: Record<string, unknown>;
let secondCatalog: Record<string, unknown>;
let firstHistory: Record<string, unknown>[];
let secondHistory: Record<string, unknown>[];
const run = (script: string, args: string[] = []) =>
  spawnSync(process.execPath, [script, ...args], {
    cwd: root,
    env: {
      ...process.env,
      DATABASE_MIGRATION_URL: url,
      DATABASE_URL: script.endsWith('migrate.mjs') ? '' : url,
    },
    encoding: 'utf8',
    timeout: 60000,
  });
const rows = async (sql: string, params: unknown[] = []) =>
  (await db.query<Record<string, unknown>>(sql, params)).rows;
async function insert(table: string, values: Record<string, unknown>) {
  const keys = Object.keys(values);
  return (
    await rows(
      `INSERT INTO ${table} (${keys.join(',')}) VALUES (${keys.map((_, i) => `$${i + 1}`).join(',')}) RETURNING *`,
      Object.values(values),
    )
  )[0]!;
}
async function rejects(sql: string, params: unknown[], code = '23514') {
  await db.query('SAVEPOINT rejected');
  try {
    await expect(db.query(sql, params)).rejects.toMatchObject({ code });
  } finally {
    await db.query('ROLLBACK TO SAVEPOINT rejected; RELEASE SAVEPOINT rejected');
  }
}
async function catalog(client: pg.Client) {
  const result: Record<string, unknown> = {};
  for (const [key, sql] of Object.entries({
    columns:
      "SELECT table_name,column_name,ordinal_position,data_type,is_nullable,column_default FROM information_schema.columns WHERE table_schema='public' ORDER BY table_name,ordinal_position",
    constraints:
      "SELECT c.relname,k.conname,k.contype,pg_get_constraintdef(k.oid) definition FROM pg_constraint k JOIN pg_class c ON c.oid=k.conrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relname NOT LIKE '_prisma_migrations%' ORDER BY c.relname,k.conname",
    indexes:
      "SELECT tablename,indexname,indexdef FROM pg_indexes WHERE schemaname='public' AND tablename NOT LIKE '_prisma_migrations%' ORDER BY tablename,indexname",
    triggers:
      "SELECT c.relname,t.tgname,pg_get_triggerdef(t.oid) definition FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND NOT t.tgisinternal ORDER BY c.relname,t.tgname",
  }))
    result[key] = (await client.query(sql)).rows.filter(
      (row: { table_name?: string }) => row.table_name !== '_prisma_migrations',
    );
  return result;
}
beforeAll(async () => {
  if (!owner) throw new Error('HB-010 requires real PostgreSQL16 and DATABASE_MIGRATION_URL');
  admin = new pg.Client({ connectionString: owner });
  await admin.connect();
  expect(
    (await admin.query<{ server_version_num: string }>('SHOW server_version_num')).rows[0]
      ?.server_version_num,
  ).toMatch(/^16/);
  for (const part of ['upgrade', 'reference']) {
    const name = `hb010_${part}_${randomUUID().replaceAll('-', '')}`;
    await admin.query(`CREATE DATABASE "${name}"`);
    names.push(name);
    const connection = new URL(owner);
    connection.pathname = `/${name}`;
    if (part === 'upgrade') url = connection.href;
    const client = new pg.Client({ connectionString: connection.href });
    clients.push(client);
    await client.connect();
    await client.query("SET TIME ZONE 'UTC'; SET statement_timeout='10s'");
  }
  [db, reference] = [clients[0]!, clients[1]!];
  await db.query(
    await readFile(`${root}apps/api/prisma/migrations/0001_baseline/migration.sql`, 'utf8'),
  );
  const prisma = createRequire(import.meta.url).resolve('prisma/build/index.js');
  expect(
    run(prisma, [
      'migrate',
      'resolve',
      '--applied',
      '0001_baseline',
      '--schema',
      `${root}apps/api/prisma/schema.prisma`,
    ]).status,
  ).toBe(0);
  user = String(
    (
      await insert('users', {
        username: 'legacy-auth-user',
        password_hash: 'synthetic-hash',
        full_name: 'Fixture',
        role: 'MANAGER',
      })
    ).id,
  );
  guest = String(
    (await insert('guests', { full_name: 'Fixture guest', phone: '+84900000009' })).id,
  );
  before = (
    await rows('SELECT id,password_hash,created_at,updated_at FROM users WHERE id=$1', [user])
  )[0]!;
  const migrated = run(`${root}scripts/migrate.mjs`);
  expect(migrated.status, migrated.stderr).toBe(0);
  firstCatalog = await catalog(db);
  firstHistory = await rows('SELECT * FROM _prisma_migrations ORDER BY migration_name');
  const repeated = run(`${root}scripts/migrate.mjs`);
  expect(repeated.status, repeated.stderr).toBe(0);
  secondCatalog = await catalog(db);
  secondHistory = await rows('SELECT * FROM _prisma_migrations ORDER BY migration_name');
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
  if (db) await db.query('ROLLBACK');
});

test('HB010 forward deploy adds five auth tables and preserves legacy records', async () => {
  expect(
    (
      await rows(
        "SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename=ANY($1::text[]) ORDER BY tablename",
        [tables],
      )
    ).map((row) => row.tablename),
  ).toEqual(tables);
  expect(
    (await rows('SELECT id,password_hash,created_at,updated_at FROM users WHERE id=$1', [user]))[0],
  ).toEqual(before);
  expect(
    await rows('SELECT must_change_password,password_changed_at FROM users WHERE id=$1', [user]),
  ).toEqual([{ must_change_password: false, password_changed_at: null }]);
  expect(await rows('SELECT phone FROM guests WHERE id=$1', [guest])).toEqual([
    { phone: '+84900000009' },
  ]);
  expect(
    await rows('SELECT migration_name FROM _prisma_migrations ORDER BY migration_name'),
  ).toEqual([{ migration_name: '0001_baseline' }, { migration_name: '0002_auth_sessions' }]);
});

test('HB010 actual migration catalog equals independent current csdl§3 and redeploy is idempotent', async () => {
  const module: unknown = await import(`${root}scripts/lib/docs.mjs`);
  function isDocs(value: unknown): value is { sqlBlocks: (source: string) => { sql: string }[] } {
    return (
      typeof value === 'object' &&
      value !== null &&
      'sqlBlocks' in value &&
      typeof value.sqlBlocks === 'function'
    );
  }
  if (!isDocs(module)) throw new Error('SQL parser unavailable');
  const blocks = module.sqlBlocks(await readFile(`${root}docs/04-thiet-ke/csdl.md`, 'utf8'));
  for (const block of blocks) await reference.query(block.sql);
  const snapshot = await catalog(db);
  expect(snapshot).toEqual(await catalog(reference));
  expect(secondCatalog).toEqual(firstCatalog);
  expect(secondHistory).toEqual(firstHistory);
  expect(await catalog(db)).toEqual(snapshot);
});

const session = (overrides: Record<string, unknown> = {}) => ({
  principal_type: 'USER',
  user_id: user,
  surface: 'OPS_WEB',
  family_id: randomUUID(),
  token_hash: randomUUID(),
  created_at: '2030-01-01T00:00:00Z',
  expires_at: '2030-01-08T00:00:00Z',
  ...overrides,
});
test('HB010 sessions reject wrong principal/surface/key/lifetime and duplicate token; valid surfaces coexist', async () => {
  const active = await insert('auth_sessions', session({ token_hash: 'fixture-session-token' }));
  for (const values of [
    { principal_type: 'BAD' },
    { user_id: null },
    { guest_id: guest },
    { surface: 'BAD' },
    { surface: 'GUEST_WEB' },
    { principal_type: 'GUEST', guest_id: guest },
    { expires_at: '2030-01-01T00:00:00Z' },
    { expires_at: '2029-12-31T23:59:59Z' },
  ]) {
    const input = session(values);
    const keys = Object.keys(input);
    await rejects(
      `INSERT INTO auth_sessions (${keys.join(',')}) VALUES (${keys.map((_, i) => `$${i + 1}`).join(',')})`,
      Object.values(input),
    );
  }
  for (const surface of ['OPS_ANDROID', 'GUEST_WEB', 'GUEST_ANDROID'])
    await insert(
      'auth_sessions',
      session(
        surface.startsWith('GUEST')
          ? { principal_type: 'GUEST', user_id: null, guest_id: guest, surface }
          : { surface },
      ),
    );
  await rejects(
    'UPDATE auth_sessions SET token_hash=$1 WHERE id<>$2',
    [active.token_hash, active.id],
    '23505',
  );
  await rejects(
    'UPDATE auth_sessions SET user_id=$1 WHERE id=$2',
    [randomUUID(), active.id],
    '23503',
  );
  expect(
    (await rows("SELECT indexdef FROM pg_indexes WHERE tablename='auth_sessions'")).filter(
      (row) =>
        String(row.indexdef).includes('revoked_at IS NULL') &&
        String(row.indexdef).includes('rotated_at IS NULL'),
    ),
  ).toHaveLength(2);
  expect(
    (await rows("SELECT indexdef FROM pg_indexes WHERE tablename='auth_sessions'")).some((row) =>
      String(row.indexdef).includes('(family_id)'),
    ),
  ).toBe(true);
});

test('HB010 credentials/PIN counters are nonnegative, PK/FK enforced, updated_at touched and deletes cascade', async () => {
  await insert('guest_credentials', {
    guest_id: guest,
    password_hash: 'synthetic-password-hash',
    updated_at: '2000-01-01',
  });
  await insert('user_pins', { user_id: user, pin_hash: 'synthetic-pin-hash' });
  expect(
    await rows('SELECT failed_login_count FROM guest_credentials WHERE guest_id=$1', [guest]),
  ).toEqual([{ failed_login_count: 0 }]);
  expect(await rows('SELECT failed_count FROM user_pins WHERE user_id=$1', [user])).toEqual([
    { failed_count: 0 },
  ]);
  await rejects('UPDATE guest_credentials SET failed_login_count=-1 WHERE guest_id=$1', [guest]);
  await rejects('UPDATE user_pins SET failed_count=-1 WHERE user_id=$1', [user]);
  await rejects('UPDATE user_pins SET user_id=$1 WHERE user_id=$2', [randomUUID(), user], '23503');
  await rejects(
    'INSERT INTO guest_credentials(guest_id,password_hash) VALUES($1,$2)',
    [guest, 'duplicate-hash'],
    '23505',
  );
  await db.query('UPDATE guest_credentials SET failed_login_count=1 WHERE guest_id=$1', [guest]);
  expect(
    await rows(
      "SELECT updated_at > '2000-01-01'::timestamptz changed FROM guest_credentials WHERE guest_id=$1",
      [guest],
    ),
  ).toEqual([{ changed: true }]);
  await db.query('DELETE FROM guests WHERE id=$1', [guest]);
  await db.query('DELETE FROM users WHERE id=$1', [user]);
  expect(await rows('SELECT * FROM guest_credentials')).toEqual([]);
  expect(await rows('SELECT * FROM user_pins')).toEqual([]);
});

test('HB010 one-time PIN/reset hashes unique; lifetime positive and bounded at5/30min; PIN bound to session user', async () => {
  const active = await insert('auth_sessions', session());
  const grant = await insert('pin_grants', {
    user_id: user,
    session_id: active.id,
    purpose: 'PAYMENT',
    token_hash: 'pin-fixture',
    created_at: '2030-01-01',
    expires_at: '2030-01-01T00:05:00Z',
  });
  const reset = await insert('guest_password_resets', {
    guest_id: guest,
    token_hash: 'reset-fixture',
    created_at: '2030-01-01',
    expires_at: '2030-01-01T00:30:00Z',
  });
  for (const [table, entry, limit] of [
    ['pin_grants', grant, '00:05:00.001'],
    ['guest_password_resets', reset, '00:30:00.001'],
  ] as const) {
    for (const expiry of ['2030-01-01', '2029-12-31', `2030-01-01T${limit}Z`])
      await rejects(`UPDATE ${table} SET expires_at=$1 WHERE id=$2`, [expiry, entry.id]);
    await db.query(`UPDATE ${table} SET consumed_at='2030-01-01T00:01:00Z' WHERE id=$1`, [
      entry.id,
    ]);
  }
  await rejects(
    'INSERT INTO pin_grants(user_id,session_id,purpose,token_hash,created_at,expires_at) SELECT user_id,session_id,purpose,token_hash,created_at,expires_at FROM pin_grants',
    [],
    '23505',
  );
  await rejects(
    'INSERT INTO guest_password_resets(guest_id,token_hash,created_at,expires_at) SELECT guest_id,token_hash,created_at,expires_at FROM guest_password_resets',
    [],
    '23505',
  );
  const other = String(
    (
      await insert('users', {
        username: 'other',
        password_hash: 'synthetic',
        full_name: 'Other',
        role: 'MANAGER',
      })
    ).id,
  );
  await rejects('UPDATE pin_grants SET user_id=$1 WHERE id=$2', [other, grant.id], '23503');
  await rejects(
    'UPDATE pin_grants SET booking_id=$1 WHERE id=$2',
    [randomUUID(), grant.id],
    '23503',
  );
  await db.query('DELETE FROM auth_sessions WHERE id=$1', [active.id]);
  expect(await rows('SELECT * FROM pin_grants')).toEqual([]);
  await db.query('DELETE FROM guests WHERE id=$1', [guest]);
  expect(await rows('SELECT * FROM guest_password_resets')).toEqual([]);
});

test('HB010 runtime auth-table CRUD uses default privileges; roles cannot write migration history', async () => {
  for (const table of tables) {
    for (const privilege of ['SELECT', 'INSERT', 'UPDATE', 'DELETE'])
      expect(
        await rows("SELECT has_table_privilege('app_rw',$1,$2) allowed", [table, privilege]),
      ).toEqual([{ allowed: true }]);
    expect(await rows("SELECT has_table_privilege('app_ro',$1,'SELECT') allowed", [table])).toEqual(
      [{ allowed: true }],
    );
    for (const privilege of ['INSERT', 'UPDATE', 'DELETE'])
      expect(
        await rows("SELECT has_table_privilege('app_ro',$1,$2) allowed", [table, privilege]),
      ).toEqual([{ allowed: false }]);
  }
  for (const role of ['app_rw', 'app_ro', 'analytics_ro'])
    expect(
      await rows(
        "SELECT has_table_privilege($1,'public._prisma_migrations','INSERT,UPDATE,DELETE') allowed",
        [role],
      ),
    ).toEqual([{ allowed: false }]);
  await db.query('SET LOCAL ROLE app_rw');
  await insert('guest_credentials', { guest_id: guest, password_hash: 'runtime-fixture-hash' });
  await insert('user_pins', { user_id: user, pin_hash: 'runtime-fixture-hash' });
  const active = await insert('auth_sessions', session());
  await insert('pin_grants', {
    user_id: user,
    session_id: active.id,
    purpose: 'PAYMENT',
    token_hash: 'runtime-pin-hash',
    created_at: '2030-01-01',
    expires_at: '2030-01-01T00:05:00Z',
  });
  await insert('guest_password_resets', {
    guest_id: guest,
    token_hash: 'runtime-reset-hash',
    created_at: '2030-01-01',
    expires_at: '2030-01-01T00:30:00Z',
  });
  for (const table of tables) {
    expect(await rows(`UPDATE ${table} SET updated_at=updated_at RETURNING true changed`)).toEqual([
      { changed: true },
    ]);
    expect(await rows(`SELECT count(*)::text count FROM ${table}`)).toEqual([{ count: '1' }]);
  }
  for (const table of [
    'pin_grants',
    'auth_sessions',
    'guest_credentials',
    'user_pins',
    'guest_password_resets',
  ])
    expect(await rows(`DELETE FROM ${table} RETURNING true removed`)).toEqual([{ removed: true }]);
});
