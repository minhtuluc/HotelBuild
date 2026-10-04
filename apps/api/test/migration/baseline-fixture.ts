import { spawnSync } from 'node:child_process';
import { cp, mkdir, mkdtemp, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type pg from 'pg';
import { expect } from 'vitest';

export async function expectMigrationHistory(client: pg.Client, root: string) {
  const expected = (
    await readdir(join(root, 'apps/api/prisma/migrations'), { withFileTypes: true })
  )
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort()
    .map((migration_name) => ({ migration_name }));
  expect(
    (await client.query('SELECT migration_name FROM _prisma_migrations ORDER BY migration_name'))
      .rows,
  ).toEqual(expected);
}

/** Exercise current CLI bytes against only the frozen baseline, without touching the full client. */
export async function baselineFixture(root: string) {
  const directory = await mkdtemp(join(tmpdir(), 'hb005-frozen-cli-'));
  try {
    const prisma = join(directory, 'apps/api/prisma');
    await mkdir(join(prisma, 'migrations/0001_baseline'), { recursive: true });
    await mkdir(join(directory, 'scripts'));
    await writeFile(join(directory, 'package.json'), '{"type":"module"}');
    await symlink(join(root, 'node_modules'), join(directory, 'node_modules'));
    for (const file of [
      'apps/api/package.json',
      'scripts/migrate.mjs',
      'apps/api/prisma/cli.mjs',
      'apps/api/prisma/connections.mjs',
      'apps/api/prisma/drift.mjs',
      'apps/api/prisma/migrations/migration_lock.toml',
      'apps/api/prisma/migrations/0001_baseline/migration.sql',
    ]) {
      await cp(join(root, file), join(directory, file));
    }
    const frozen = spawnSync(
      'git',
      ['show', '403cfc7e782c598dd31644df75132f28d672a30a:apps/api/prisma/schema.prisma'],
      { cwd: root, encoding: 'utf8' },
    );
    if (frozen.status !== 0) throw new Error('Frozen baseline Prisma schema unavailable');
    const schema = join(prisma, 'schema.prisma');
    await writeFile(
      schema,
      frozen.stdout.replace(
        'provider = "prisma-client-js"',
        'provider = "prisma-client-js"\n  output   = "./baseline-client"',
      ),
    );
    return {
      directory,
      schema,
      migrate: join(directory, 'scripts/migrate.mjs'),
      drift: join(prisma, 'drift.mjs'),
      client: join(prisma, 'baseline-client/index.js'),
    };
  } catch (error) {
    await rm(directory, { recursive: true, force: true });
    throw error;
  }
}
