import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { describe, expect, it } from 'vitest';

const script = fileURLToPath(new URL('../../prisma/dev-roles.mjs', import.meta.url));
const owner = 'postgresql://owner:owner-secret@127.0.0.1:32768/postgres';
const runtime = 'postgresql://app_rw:guard-secret@127.0.0.1:32768/postgres';
const run = (env: Record<string, string>) =>
  spawnSync(process.execPath, [script], {
    env: {
      ...process.env,
      NODE_ENV: 'development',
      DATABASE_MIGRATION_URL: owner,
      DATABASE_URL: runtime,
      ...env,
    },
    encoding: 'utf8',
    timeout: 10000,
  });

const helperPath = fileURLToPath(new URL('../../prisma/connections.mjs', import.meta.url));
function isMigrationHelpers(value: unknown): value is {
  requireMigrationUrl: (env: Record<string, string>) => string;
} {
  return (
    typeof value === 'object' &&
    value !== null &&
    'requireMigrationUrl' in value &&
    typeof value.requireMigrationUrl === 'function'
  );
}
const helpers: unknown = await import(helperPath);
if (!isMigrationHelpers(helpers)) throw new Error('Migration helper export missing');
const { requireMigrationUrl } = helpers;

describe('migration owner URL helper', () => {
  it.each([
    { DATABASE_MIGRATION_URL: runtime },
    {
      DATABASE_MIGRATION_URL: owner,
      DATABASE_URL: owner.replace('owner-secret', 'guard-secret'),
    },
  ])('independently rejects unsafe owner identity %j', (env) => {
    expect(() => requireMigrationUrl(env)).toThrow('DATABASE_MIGRATION_URL');
    expect(() => requireMigrationUrl(env)).not.toThrow(/owner-secret|guard-secret/);
  });

  it('accepts distinct owner and runtime identities', () => {
    expect(requireMigrationUrl({ DATABASE_MIGRATION_URL: owner, DATABASE_URL: runtime })).toBe(
      owner,
    );
  });
});

describe('development runtime role CLI', () => {
  it.each([
    [{ DATABASE_MIGRATION_URL: '' }, 'DATABASE_MIGRATION_URL'],
    [{ NODE_ENV: 'production' }, 'NODE_ENV'],
    [
      { DATABASE_MIGRATION_URL: 'postgresql://owner:owner-secret@remote.invalid/postgres' },
      'DATABASE_MIGRATION_URL',
    ],
    [{ DATABASE_URL: runtime.replace('app_rw', 'other') }, 'DATABASE_URL'],
    [{ DATABASE_URL: runtime.replace('/postgres', '/other') }, 'DATABASE_URL'],
    [{ DATABASE_URL: runtime.replace('guard-secret', '') }, 'DATABASE_URL'],
    [{ DATABASE_MIGRATION_URL: runtime }, 'DATABASE_MIGRATION_URL'],
    [{ DATABASE_MIGRATION_URL: 'malformed-owner-secret' }, 'DATABASE_MIGRATION_URL'],
    [{ DATABASE_URL: 'postgresql://app_rw:guard-secret@127.0.0.1:32768/' }, 'DATABASE_URL'],
    [{ DATABASE_URL: runtime.replace('32768', '32769') }, 'DATABASE_URL'],
    [{ DATABASE_URL: runtime + '?host=remote.invalid' }, 'DATABASE_URL'],
  ])('rejects unsafe configuration %j', (env, variable) => {
    const result = run(env);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain(variable);
    expect(result.stderr).not.toContain('guard-secret');
    expect(result.stderr).not.toContain('owner-secret');
  });

  const integrationUrl = process.env.DATABASE_MIGRATION_URL;
  it.skipIf(!integrationUrl)(
    'sets a quoted password and authenticates on PostgreSQL 16',
    async () => {
      const admin = new pg.Client({ connectionString: integrationUrl });
      const database = `hb005_roles_${randomUUID().replaceAll('-', '')}`;
      await admin.connect();
      try {
        expect(
          (await admin.query<{ server_version_num: string }>('SHOW server_version_num')).rows[0]
            ?.server_version_num,
        ).toMatch(/^16/);
        await admin.query(
          "DO $$ BEGIN IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'app_rw') THEN CREATE ROLE app_rw; END IF; END $$",
        );
        await admin.query(`CREATE DATABASE "${database}"`);
        const ownerUrl = new URL(integrationUrl!);
        ownerUrl.pathname = `/${database}`;
        const runtimeUrl = new URL(ownerUrl);
        runtimeUrl.username = 'app_rw';
        runtimeUrl.password = `quote'\\; -- ${randomUUID()}`;
        const result = run({
          DATABASE_MIGRATION_URL: ownerUrl.href,
          DATABASE_URL: runtimeUrl.href,
        });
        expect(result.status, result.stderr).toBe(0);
        const client = new pg.Client({ connectionString: runtimeUrl.href });
        try {
          await client.connect();
          expect(
            (await client.query<{ current_user: string }>('SELECT current_user')).rows[0]
              ?.current_user,
          ).toBe('app_rw');
        } finally {
          await client.end();
        }
      } finally {
        await admin.query(`DROP DATABASE IF EXISTS "${database}"`);
        await admin.end();
      }
    },
    20000,
  );
  if (!integrationUrl) console.warn('SKIP PostgreSQL integration: DATABASE_MIGRATION_URL absent');
});
