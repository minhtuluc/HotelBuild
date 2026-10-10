import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { fileURLToPath } from 'node:url';
import { rm } from 'node:fs/promises';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { baselineFixture, expectMigrationHistory } from './baseline-fixture.js';

const root = fileURLToPath(new URL('../../../../', import.meta.url));
const owner = process.env.DATABASE_MIGRATION_URL;
const tables = ['channel_mappings', 'overbooking_cases'] as const;
const helpers: unknown = await import(`${root}tests/helpers/database.mjs`);
function isFixture(value: unknown): value is {
  fixture: (client: { query: pg.Client['query'] }) => Promise<{
    property: { id: string };
    type: { id: string };
    web: { id: string };
  }>;
} {
  return (
    typeof value === 'object' &&
    value !== null &&
    'fixture' in value &&
    typeof value.fixture === 'function'
  );
}
if (!isFixture(helpers)) throw new Error('Database fixture unavailable');

describe('HB121 AC6/7 schema versions (not endpoint or complete F6 acceptance)', () => {
  const name = `hb121_versions_${randomUUID().replaceAll('-', '')}`;
  let admin: pg.Client | undefined;
  let db: pg.Client | undefined;
  let url = '';
  let directory: string | undefined;
  const original: Record<string, Record<string, unknown>> = {};
  const ids: Record<string, string> = {};
  const migrate = (script: string) =>
    spawnSync(process.execPath, [script], {
      cwd: root,
      encoding: 'utf8',
      timeout: 60000,
      env: { ...process.env, DATABASE_URL: '', DATABASE_MIGRATION_URL: url },
    });
  const client = () => {
    if (!db) throw new Error('Database not connected');
    return db;
  };
  beforeAll(async () => {
    if (!owner) throw new Error('HB121 requires real PostgreSQL16 owner URL; no fallback');
    admin = new pg.Client({ connectionString: owner });
    await admin.connect();
    const version = Number(
      (await admin.query<{ server_version_num: string }>('SHOW server_version_num')).rows[0]
        ?.server_version_num,
    );
    expect(version).toBeGreaterThanOrEqual(160000);
    expect(version).toBeLessThan(170000);
    await admin.query(`CREATE DATABASE "${name}"`);
    const parsed = new URL(owner);
    parsed.pathname = `/${name}`;
    url = parsed.href;
    db = new pg.Client({ connectionString: url });
    await db.connect();
    await db.query("SET statement_timeout='10s'");
    const frozen = await baselineFixture(root);
    directory = frozen.directory;
    const baseline = migrate(frozen.migrate);
    expect(baseline.status, baseline.stderr).toBe(0);
    const f = await helpers.fixture({ query: db.query.bind(db) });
    for (const [table, values] of [
      [
        'channel_mappings',
        { channel_id: f.web.id, room_type_id: f.type.id, external_room_code: 'PRESERVED' },
      ],
      [
        'overbooking_cases',
        {
          property_id: f.property.id,
          room_type_id: f.type.id,
          date: '2030-01-01',
          shortage_count: 2,
        },
      ],
    ] as const) {
      const keys = Object.keys(values);
      const row = (
        await db.query<Record<string, unknown>>(
          `INSERT INTO ${table} (${keys.join(',')}) VALUES (${keys.map((_, i) => `$${i + 1}`).join(',')}) RETURNING *`,
          Object.values(values),
        )
      ).rows[0]!;
      original[table] = row;
      ids[table] = String(row.id);
    }
    const upgrade = migrate(`${root}scripts/migrate.mjs`);
    expect(upgrade.status, upgrade.stderr).toBe(0);
  }, 90000);
  afterAll(async () => {
    await db?.end();
    try {
      if (admin) await admin.query(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
    } finally {
      await admin?.end();
      if (directory) await rm(directory, { recursive: true, force: true });
    }
  });

  it.each(tables)(
    'upgrades %s without losing data and enforces positive stored version',
    async (table) => {
      const row = (
        await client().query<Record<string, unknown>>(`SELECT * FROM ${table} WHERE id=$1`, [
          ids[table],
        ])
      ).rows[0]!;
      expect(row).toEqual({ ...original[table], version: '1' });
      const column = (
        await client().query(
          "SELECT data_type,is_nullable,column_default FROM information_schema.columns WHERE table_schema='public' AND table_name=$1 AND column_name='version'",
          [table],
        )
      ).rows;
      expect(column).toEqual([{ data_type: 'bigint', is_nullable: 'NO', column_default: '1' }]);
      // INSERT exercises CHECK/NOT NULL directly; UPDATE intentionally overwrites client-supplied versions.
      const values = { ...original[table] };
      delete values.id;
      if (table === 'channel_mappings') values.external_room_code = 'OTHER';
      else values.date = '2030-01-02';
      for (const invalid of [0, -1, null]) {
        const input = { ...values, version: invalid };
        const keys = Object.keys(input);
        await expect(
          client().query(
            `INSERT INTO ${table} (${keys.join(',')}) VALUES (${keys.map((_, i) => `$${i + 1}`).join(',')})`,
            Object.values(input),
          ),
        ).rejects.toMatchObject({ code: invalid === null ? '23502' : '23514' });
      }
      const input = { ...values };
      const keys = Object.keys(input);
      if (table === 'channel_mappings')
        input.room_type_id = (
          await client().query<{ id: string }>('SELECT id FROM room_types WHERE id<>$1 LIMIT 1', [
            values.room_type_id,
          ])
        ).rows[0]!.id;
      const created = await client().query<{ id: string }>(
        `INSERT INTO ${table} (${keys.join(',')}) VALUES (${keys.map((_, i) => `$${i + 1}`).join(',')}) RETURNING version`,
        Object.values(input),
      );
      expect(created.rows).toEqual([{ version: '1' }]);
    },
  );

  it.each(tables)(
    '%s increments atomically, ignores forged versions and rolls back',
    async (table) => {
      await client().query('BEGIN');
      try {
        expect(
          (
            await client().query(
              `UPDATE ${table} SET updated_at=updated_at,version=999 WHERE id=$1 RETURNING version`,
              [ids[table]],
            )
          ).rows,
        ).toEqual([{ version: '2' }]);
      } finally {
        await client().query('ROLLBACK');
      }
      expect(
        (await client().query(`SELECT version FROM ${table} WHERE id=$1`, [ids[table]])).rows,
      ).toEqual([{ version: '1' }]);
    },
  );

  it.each(tables)(
    '%s rejects a stale competing compare-and-set without losing the winner',
    async (table) => {
      const values = { ...original[table] };
      delete values.id;
      if (table === 'channel_mappings')
        values.channel_id = (
          await client().query<{ id: string }>(
            "INSERT INTO channels(code,name,multiplier) VALUES('PHONE','Version fixture',1) RETURNING id",
          )
        ).rows[0]!.id;
      else values.date = '2030-01-03';
      const keys = Object.keys(values);
      const candidate = (
        await client().query<{ id: string }>(
          `INSERT INTO ${table} (${keys.join(',')}) VALUES (${keys.map((_, i) => `$${i + 1}`).join(',')}) RETURNING id`,
          Object.values(values),
        )
      ).rows[0]!.id;
      const competitors = [
        new pg.Client({ connectionString: url }),
        new pg.Client({ connectionString: url }),
      ];
      try {
        for (const connection of competitors) {
          await connection.connect();
          await connection.query("SET statement_timeout='10s'");
        }
        const results = await Promise.all(
          competitors.map((connection, i) =>
            connection.query<{ status: string; version: string }>(
              `UPDATE ${table} SET status=$1 WHERE id=$2 AND version=1 RETURNING status,version`,
              [
                i
                  ? table === 'channel_mappings'
                    ? 'INACTIVE'
                    : 'PROPOSED'
                  : table === 'channel_mappings'
                    ? 'ACTIVE'
                    : 'OPEN',
                candidate,
              ],
            ),
          ),
        );
        expect(results.map((result) => result.rowCount).sort()).toEqual([0, 1]);
        const winner = results.find((result) => result.rowCount === 1)!.rows;
        expect(winner[0]?.version).toBe('2');
        expect(
          (await client().query(`SELECT status,version FROM ${table} WHERE id=$1`, [candidate]))
            .rows,
        ).toEqual(winner);
      } finally {
        for (const connection of competitors) await connection.end();
      }
    },
  );

  it('deploys twice without replaying the migration or changing rows; generated Prisma client reads versions', async () => {
    const before = await Promise.all(
      tables.map(
        async (table) =>
          (await client().query<Record<string, unknown>>(`SELECT * FROM ${table} ORDER BY id`))
            .rows,
      ),
    );
    const replay = migrate(`${root}scripts/migrate.mjs`);
    expect(replay.status, replay.stderr).toBe(0);
    await expectMigrationHistory(client(), root);
    const after = await Promise.all(
      tables.map(
        async (table) =>
          (await client().query<Record<string, unknown>>(`SELECT * FROM ${table} ORDER BY id`))
            .rows,
      ),
    );
    expect(after).toEqual(before);
    const prisma = new PrismaClient({ datasources: { db: { url } } });
    try {
      expect(
        (await prisma.channel_mappings.findUniqueOrThrow({ where: { id: ids.channel_mappings! } }))
          .version,
      ).toBe(1n);
      expect(
        (
          await prisma.overbooking_cases.findUniqueOrThrow({
            where: { id: ids.overbooking_cases! },
          })
        ).version,
      ).toBe(1n);
    } finally {
      await prisma.$disconnect();
    }
  }, 60000);
});
