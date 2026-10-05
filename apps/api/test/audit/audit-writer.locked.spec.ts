import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { PrismaClient, type Prisma } from '@prisma/client';
import type { Clock } from '@pinehill/domain';
import pg from 'pg';
import { afterAll, beforeAll, expect, test } from 'vitest';
import { AuditWriter, type AuditEntry } from '../../src/infrastructure/audit/audit-writer.js';

// HB-009-A: all fixtures/oracles live in the locked file; no mock of AuditWriter.
const root = fileURLToPath(new URL('../../../../', import.meta.url));
const owner = process.env.DATABASE_MIGRATION_URL;
const database = `hb009_${randomUUID().replaceAll('-', '')}`;
const actorId = randomUUID();
const instant = new Date('2030-01-02T03:04:05.678Z');
const clock: Clock = { now: () => new Date(instant) };
const writer = new AuditWriter(clock);
let admin: pg.Client | undefined;
let observer: pg.Client | undefined;
let prisma: PrismaClient | undefined;
let created = false;

function entry(entityId: string, overrides: Partial<AuditEntry> = {}): AuditEntry {
  return {
    actor: {
      id: actorId,
      role: 'MANAGER',
      ip: '192.0.2.9',
      correlationId: 'hb009-synthetic-request',
    },
    action: 'UPDATE',
    entityType: 'SystemSetting',
    entityId,
    beforeJson: { value: 'old' },
    afterJson: { value: 'new' },
    reason: 'synthetic fixture change',
    ...overrides,
  };
}
async function transaction<T>(work: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
  if (!prisma) throw new Error('Prisma fixture not initialized');
  return prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe('SET LOCAL ROLE app_rw');
    const identity = await tx.$queryRaw<{ current_user: string }[]>`SELECT current_user`;
    expect(identity).toEqual([{ current_user: 'app_rw' }]);
    return work(tx);
  });
}
async function logs(entityId: string) {
  if (!observer) throw new Error('Independent observer not initialized');
  return (
    await observer.query<Record<string, unknown>>(
      'SELECT * FROM audit_logs WHERE entity_id=$1 ORDER BY chain_seq',
      [entityId],
    )
  ).rows;
}
async function settings(key: string) {
  if (!observer) throw new Error('Independent observer not initialized');
  return (
    await observer.query<{ value: string }>('SELECT value FROM system_settings WHERE key=$1', [key])
  ).rows;
}

beforeAll(async () => {
  if (!owner) throw new Error('HB-009 requires DATABASE_MIGRATION_URL and real PostgreSQL16');
  admin = new pg.Client({ connectionString: owner, connectionTimeoutMillis: 5000 });
  await admin.connect();
  expect(
    (await admin.query<{ server_version_num: string }>('SHOW server_version_num')).rows[0]
      ?.server_version_num,
  ).toMatch(/^16/);
  await admin.query(`CREATE DATABASE "${database}"`);
  created = true;
  const url = new URL(owner);
  url.pathname = `/${database}`;
  const migrated = spawnSync(process.execPath, [`${root}scripts/migrate.mjs`], {
    cwd: root,
    env: { ...process.env, DATABASE_MIGRATION_URL: url.href, DATABASE_URL: '' },
    encoding: 'utf8',
    timeout: 60000,
  });
  expect(migrated.status, 'Published migrations must succeed before behavioral assertions').toBe(0);
  observer = new pg.Client({ connectionString: url.href });
  await observer.connect();
  await observer.query("SET TIME ZONE 'UTC'; SET statement_timeout='10s'");
  await observer.query(
    'INSERT INTO users(id,username,password_hash,full_name,role) VALUES($1,$2,$3,$4,$5)',
    [actorId, 'hb009-fixture', 'synthetic-only-hash', 'Fixture', 'MANAGER'],
  );
  // Real database failure, not a mocked tx/writer. Isolated temporary DB only.
  await observer.query(`
    CREATE FUNCTION hb009_reject_audit() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN
      IF NEW.action = 'HB009_FORCE_FAILURE' THEN
        RAISE EXCEPTION 'HB009 database audit failure' USING ERRCODE='23514';
      END IF;
      RETURN NEW;
    END $$;
    CREATE TRIGGER hb009_reject_audit BEFORE INSERT ON audit_logs
      FOR EACH ROW EXECUTE FUNCTION hb009_reject_audit();
  `);
  prisma = new PrismaClient({ datasourceUrl: url.href });
  await prisma.$connect();
}, 90000);

afterAll(async () => {
  try {
    await prisma?.$disconnect();
    await observer?.end();
    if (created && admin) await admin.query(`DROP DATABASE "${database}" WITH (FORCE)`);
  } finally {
    await admin?.end();
  }
});

test('BR-GEN-07: business and audit are invisible to another connection until one commit', async () => {
  const key = 'hb009.atomic';
  const id = await transaction(async (tx) => {
    const setting = await tx.system_settings.create({ data: { key, value: 'new' } });
    await writer.record(tx, entry(setting.id));
    expect(await tx.audit_logs.count({ where: { entity_id: setting.id } })).toBe(1);
    expect(await settings(key)).toEqual([]);
    expect(await logs(setting.id)).toEqual([]);
    return setting.id;
  });
  expect(await settings(key)).toEqual([{ value: 'new' }]);
  expect(await logs(id)).toHaveLength(1);
});

test('TC-SYS-02: database audit failure rejects and removes the new business row', async () => {
  const id = randomUUID();
  const key = 'hb009.failure.insert';
  await expect(
    transaction(async (tx) => {
      await tx.system_settings.create({ data: { id, key, value: 'new' } });
      await writer.record(tx, entry(id, { action: 'HB009_FORCE_FAILURE' }));
    }),
  ).rejects.toThrow(/HB009 database audit failure/);
  expect(await settings(key)).toEqual([]);
  expect(await logs(id)).toEqual([]);
});

test('TC-SYS-02: database audit failure restores a previously committed business value', async () => {
  const key = 'hb009.failure.update';
  const id = await transaction(
    async (tx) => (await tx.system_settings.create({ data: { key, value: 'old' } })).id,
  );
  await expect(
    transaction(async (tx) => {
      await tx.system_settings.update({ where: { id }, data: { value: 'new' } });
      await writer.record(tx, entry(id, { action: 'HB009_FORCE_FAILURE' }));
    }),
  ).rejects.toThrow(/HB009 database audit failure/);
  expect(await settings(key)).toEqual([{ value: 'old' }]);
  expect(await logs(id)).toEqual([]);
});

test('caller rollback removes audit too: AuditWriter cannot commit its own transaction', async () => {
  const id = randomUUID();
  const key = 'hb009.caller.rollback';
  await expect(
    transaction(async (tx) => {
      await tx.system_settings.create({ data: { id, key, value: 'new' } });
      await writer.record(tx, entry(id));
      expect(await tx.audit_logs.count({ where: { entity_id: id } })).toBe(1);
      throw new Error('HB009 caller failure');
    }),
  ).rejects.toThrow('HB009 caller failure');
  expect(await settings(key)).toEqual([]);
  expect(await logs(id)).toEqual([]);
});

test('BR-SYS-05: stores actor, role, action, entity, before/after, reason, IP and injected Clock', async () => {
  const id = randomUUID();
  const input = entry(id);
  await transaction((tx) => writer.record(tx, input));
  const rows = await logs(id);
  expect(rows).toHaveLength(1);
  expect(rows[0]).toMatchObject({
    actor_id: actorId,
    actor_role: 'MANAGER',
    action: 'UPDATE',
    entity_type: 'SystemSetting',
    entity_id: id,
    before_json: input.beforeJson,
    after_json: input.afterJson,
    reason: input.reason,
    ip_address: '192.0.2.9',
    at: instant,
  });
});

test('nullable actor/entity/payload fields support a system event and use the next injected time', async () => {
  const next = new Date('2031-02-03T04:05:06.789Z');
  const systemWriter = new AuditWriter({ now: () => new Date(next) });
  const action = 'HB009_SYSTEM_EVENT';
  await transaction((tx) =>
    systemWriter.record(tx, {
      actor: { id: null, role: 'SYSTEM', ip: null, correlationId: 'hb009-system' },
      action,
      entityType: 'SystemSetting',
      entityId: null,
      beforeJson: null,
      afterJson: null,
      reason: null,
    }),
  );
  const rows = (
    await observer!.query<Record<string, unknown>>('SELECT * FROM audit_logs WHERE action=$1', [
      action,
    ])
  ).rows;
  expect(rows).toHaveLength(1);
  expect(rows[0]).toMatchObject({
    actor_id: null,
    actor_role: 'SYSTEM',
    entity_id: null,
    ip_address: null,
    before_json: null,
    after_json: null,
    reason: null,
    at: next,
  });
});

test('NFR-SEC-03: masks both snapshots, nested objects/arrays, without mutating input', async () => {
  const id = randomUUID();
  const beforeJson = {
    value: 'old',
    password_hash: 'synthetic-before-secret',
    phone: '+84912345678',
    guests: [{ phone: '0901234567', email: 'synthetic@example.invalid', idNumber: '123456789012' }],
    nested: {
      passwordHash: 'synthetic-nested-secret',
      phone: '0912345678',
      id_number: '987654321012',
    },
    metadata: null,
  };
  const afterJson = {
    ...beforeJson,
    value: 'new',
    password_hash: 'synthetic-after-secret',
    phone: '0923456789',
  };
  const input = entry(id, { beforeJson, afterJson });
  const original = structuredClone(input);
  await transaction((tx) => writer.record(tx, input));
  const rows = await logs(id);
  expect(rows).toHaveLength(1);
  for (const [field, value, phone] of [
    ['before_json', 'old', '****5678'],
    ['after_json', 'new', '****6789'],
  ] as const) {
    const snapshot = rows[0]![field];
    expect(snapshot).toMatchObject({
      value,
      phone,
      metadata: null,
      guests: [{ phone: '****4567', email: '****alid', idNumber: '****9012' }],
      nested: { phone: '****5678', id_number: '****1012' },
    });
    const serialized = JSON.stringify(snapshot);
    for (const raw of [
      'synthetic-before-secret',
      'synthetic-after-secret',
      'synthetic-nested-secret',
      '+84912345678',
      '0901234567',
      '0912345678',
      '0923456789',
      'synthetic@example.invalid',
      '123456789012',
      '987654321012',
    ])
      expect(serialized).not.toContain(raw);
  }
  expect(input).toEqual(original);
});

test('NFR-SEC-04: three append records link to the committed predecessor with valid independent digests', async () => {
  const id = randomUUID();
  const predecessor =
    (
      await observer!.query<{ row_hash: string }>(
        'SELECT row_hash FROM audit_logs ORDER BY chain_seq DESC LIMIT 1',
      )
    ).rows[0]?.row_hash ?? null;
  await transaction(async (tx) => {
    for (const action of ['HB009_CHAIN_1', 'HB009_CHAIN_2', 'HB009_CHAIN_3'])
      await writer.record(tx, entry(id, { action }));
  });
  // Published canonical digest, recomputed without calling fn_audit_digest/writer internals.
  const rows = (
    await observer!.query<{
      action: string;
      prev_hash: string | null;
      row_hash: string;
      expected_hash: string;
      chain_seq: string;
    }>(
      `
    SELECT a.*, encode(digest(jsonb_build_array(coalesce(a.prev_hash,'GENESIS'),
      to_jsonb(a)-'row_hash'-'prev_hash'-'at'-'created_at'-'updated_at',
      extract(epoch FROM a.at),extract(epoch FROM a.created_at))::text,'sha256'),'hex') expected_hash
    FROM audit_logs a WHERE entity_id=$1 ORDER BY chain_seq`,
      [id],
    )
  ).rows;
  expect(rows).toHaveLength(3);
  expect(rows.map((row) => row.action)).toEqual([
    'HB009_CHAIN_1',
    'HB009_CHAIN_2',
    'HB009_CHAIN_3',
  ]);
  let previous = predecessor;
  let sequence = 0n;
  for (const row of rows) {
    expect(row.prev_hash).toBe(previous);
    expect(row.row_hash).toMatch(/^[a-f0-9]{64}$/);
    expect(row.row_hash).toBe(row.expected_hash);
    expect(BigInt(row.chain_seq)).toBeGreaterThan(sequence);
    previous = row.row_hash;
    sequence = BigInt(row.chain_seq);
  }
});

test('TC-SYS-01 control: app_rw may append/select, has no UPDATE/DELETE privileges', async () => {
  const id = randomUUID();
  await transaction(async (tx) => {
    await tx.audit_logs.create({
      data: {
        actor_id: actorId,
        actor_role: 'MANAGER',
        action: 'HB009_PRIVILEGE_CONTROL',
        entity_type: 'SystemSetting',
        entity_id: id,
        chain_seq: 0n,
        row_hash: 'trigger-overwrites',
      },
    });
    expect(await tx.audit_logs.count({ where: { entity_id: id } })).toBe(1);
    const permissions = await tx.$queryRaw<
      { insert: boolean; select: boolean; update: boolean; delete: boolean }[]
    >`
      SELECT has_table_privilege(current_user,'audit_logs','INSERT') "insert",
        has_table_privilege(current_user,'audit_logs','SELECT') "select",
        has_table_privilege(current_user,'audit_logs','UPDATE') "update",
        has_table_privilege(current_user,'audit_logs','DELETE') "delete"`;
    expect(permissions).toEqual([{ insert: true, select: true, update: false, delete: false }]);
  });
  for (const statement of [
    'UPDATE audit_logs SET action=$1 WHERE entity_id=$2::uuid',
    'DELETE FROM audit_logs WHERE action=$1 AND entity_id=$2::uuid',
  ])
    await expect(
      transaction(async (tx) => {
        await tx.$executeRawUnsafe(statement, 'HB009_PRIVILEGE_CONTROL', id);
      }),
    ).rejects.toMatchObject({ code: 'P2010', meta: { code: '42501' } });
  expect(await logs(id)).toHaveLength(1);
});
