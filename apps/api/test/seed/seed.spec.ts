/**
 * HB-018 — seed tham chiếu + tài khoản dev + `owner:bootstrap` trên PostgreSQL 16 thật.
 * Số lượng đối chiếu: 3 cơ sở · 15 loại phòng (5 loại × 3 cơ sở) · 55 phòng · 75 đơn vị bán ·
 * 7 kênh · 4 gói giá · 4 chính sách + 11 bậc · tham số hệ thống · 7 tài khoản dev (BR-PROP-03/04).
 */
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DEV_ACCOUNTS, resolveDevPassword } from '../../prisma/seed/dev-accounts.js';
import {
  main as seedMain,
  seedConnectionString,
  type SeedSummary,
} from '../../prisma/seed/index.js';
import {
  bootstrapCredentials,
  bootstrapOwner,
  main as bootstrapMain,
} from '../../src/cli/bootstrap-owner.js';

const root = fileURLToPath(new URL('../../../../', import.meta.url));
const ownerUrl = process.env.DATABASE_MIGRATION_URL;

let admin: pg.Client;
let db: pg.Client;
let databaseUrl = '';
let databaseName = '';
const counts = {
  properties: 3,
  roomTypes: 15,
  rooms: 55,
  sellingUnits: 75,
  channels: 7,
  ratePlans: 4,
  policies: 4,
  tiers: 11,
  users: 7,
};

const rows = async <T extends pg.QueryResultRow>(sql: string, params: unknown[] = []) =>
  (await db.query<T>(sql, params)).rows;

async function tableCount(table: string): Promise<number> {
  const result = await rows<{ count: string }>(`SELECT count(*)::text AS count FROM ${table}`);
  return Number(result[0]?.count ?? '-1');
}

beforeAll(async () => {
  if (ownerUrl === undefined || ownerUrl.trim() === '') {
    throw new Error('HB-018 cần DATABASE_MIGRATION_URL và PostgreSQL 16 thật');
  }
  admin = new pg.Client({ connectionString: ownerUrl });
  await admin.connect();
  databaseName = `hb018_${randomUUID().replaceAll('-', '')}`;
  await admin.query(`CREATE DATABASE "${databaseName}"`);
  const url = new URL(ownerUrl);
  url.pathname = `/${databaseName}`;
  databaseUrl = url.href;
  const migrated = spawnSync(process.execPath, [`${root}scripts/migrate.mjs`], {
    cwd: root,
    encoding: 'utf8',
    timeout: 60000,
    env: { ...process.env, DATABASE_URL: '', DATABASE_MIGRATION_URL: databaseUrl },
  });
  expect(migrated.status, migrated.stderr).toBe(0);
  db = new pg.Client({ connectionString: databaseUrl });
  await db.connect();
}, 120000);

afterAll(async () => {
  await db?.end();
  if (admin !== undefined) {
    try {
      await admin.query(`DROP DATABASE IF EXISTS "${databaseName}" WITH (FORCE)`);
    } finally {
      await admin.end();
    }
  }
});

describe('seed dữ liệu tham chiếu', () => {
  it('nạp đúng số lượng và đơn vị bán theo BR-PROP-03/04', async () => {
    const summary: SeedSummary = await seedMain({ DATABASE_URL: databaseUrl, NODE_ENV: 'test' });
    expect(summary).toMatchObject(counts);
    expect(await tableCount('properties')).toBe(counts.properties);
    expect(await tableCount('room_types')).toBe(counts.roomTypes);
    expect(await tableCount('rooms')).toBe(counts.rooms);
    expect(await tableCount('channels')).toBe(counts.channels);
    expect(await tableCount('rate_plans')).toBe(counts.ratePlans);
    expect(await tableCount('cancellation_policies')).toBe(counts.policies);
    expect(await tableCount('cancellation_tiers')).toBe(counts.tiers);
  });

  it('đơn vị bán = số phòng, riêng DOR tính theo giường (75 toàn chuỗi)', async () => {
    const result = await rows<{ code: string; units: string }>(
      `SELECT p.code, sum(CASE WHEN rt.code = 'DOR' THEN r.bed_count ELSE 1 END)::text AS units
         FROM rooms r
         JOIN properties p ON p.id = r.property_id
         JOIN room_types rt ON rt.id = r.room_type_id
        GROUP BY p.code ORDER BY p.code`,
    );
    expect(result.map((row) => [row.code, Number(row.units)])).toEqual([
      ['CS-01', 34],
      ['CS-02', 23],
      ['CS-03', 18],
    ]);
  });

  it('DOR có bed_count 6 và loại khác bằng sức chứa người lớn', async () => {
    const result = await rows<{ code: string; bed_count: number; capacity_adults: number }>(
      `SELECT rt.code, min(r.bed_count)::int AS bed_count, rt.capacity_adults
         FROM rooms r JOIN room_types rt ON rt.id = r.room_type_id
        GROUP BY rt.code, rt.capacity_adults ORDER BY rt.code`,
    );
    expect(result.map((row) => [row.code, row.bed_count, row.capacity_adults])).toEqual([
      ['DLX', 3, 3],
      ['DOR', 6, 6],
      ['FAM', 4, 4],
      ['STD', 2, 2],
      ['SUP', 2, 2],
    ]);
  });

  it('chạy lần hai không tạo bản ghi trùng và không đổi số lượng', async () => {
    const before = {
      properties: await tableCount('properties'),
      rooms: await tableCount('rooms'),
      tiers: await tableCount('cancellation_tiers'),
      scopes: await tableCount('user_property_scopes'),
    };
    const summary = await seedMain({ DATABASE_URL: databaseUrl, NODE_ENV: 'test' });
    expect(summary).toMatchObject(counts);
    expect({
      properties: await tableCount('properties'),
      rooms: await tableCount('rooms'),
      tiers: await tableCount('cancellation_tiers'),
      scopes: await tableCount('user_property_scopes'),
    }).toEqual(before);
  });

  it('giữ nguyên giá trị tham số đang vận hành khi chạy lại', async () => {
    await db.query(`UPDATE system_settings SET value = '45' WHERE key = 'pricing.maxDiscountPct'`);
    await seedMain({ DATABASE_URL: databaseUrl, NODE_ENV: 'test' });
    const result = await rows<{ value: string }>(
      `SELECT value FROM system_settings WHERE key = 'pricing.maxDiscountPct'`,
    );
    expect(result[0]?.value).toBe('45');
  });

  it('NODE_ENV=production bỏ qua phần tài khoản dev', async () => {
    const summary = await seedMain({ DATABASE_URL: databaseUrl, NODE_ENV: 'production' });
    expect(summary.users).toBe(0);
    expect(await tableCount('users')).toBe(counts.users);
  });

  it('7 tài khoản dev đúng vai trò và phạm vi cơ sở', async () => {
    const result = await rows<{ username: string; role: string; scope_count: string }>(
      `SELECT u.username, u.role, count(s.*)::text AS scope_count
         FROM users u LEFT JOIN user_property_scopes s ON s.user_id = u.id
        GROUP BY u.username, u.role ORDER BY u.username`,
    );
    expect(result.map((row) => [row.username, row.role, Number(row.scope_count)])).toEqual(
      [...DEV_ACCOUNTS]
        .map((account) => [account.username, account.role, account.propertyCodes.length])
        .sort((a, b) => String(a[0]).localeCompare(String(b[0]))),
    );
  });

  it('từ chối seed khi thiếu URL kết nối', () => {
    expect(() => seedConnectionString({})).toThrow(/DATABASE_URL/);
  });
});

describe('owner:bootstrap', () => {
  it('tạo OWNER đầu tiên kèm audit SYSTEM và bắt đổi mật khẩu', async () => {
    await db.query('DELETE FROM users');
    const userId = await bootstrapMain({
      DATABASE_URL: databaseUrl,
      BOOTSTRAP_OWNER_USERNAME: 'bootstrap.owner',
      BOOTSTRAP_OWNER_PASSWORD: 'MatKhauThat@2026',
    });
    const created = await rows<{
      role: string;
      must_change_password: boolean;
      password_hash: string;
    }>('SELECT role, must_change_password, password_hash FROM users WHERE id = $1', [userId]);
    expect(created[0]?.role).toBe('OWNER');
    expect(created[0]?.must_change_password).toBe(true);
    // Argon2id (QĐ-03 T1), không lưu mật khẩu thô.
    expect(created[0]?.password_hash.startsWith('$argon2id$')).toBe(true);
    const audit = await rows<{
      actor_role: string;
      action: string;
      chain_seq: string;
      row_hash: string;
    }>(
      `SELECT actor_role, action, chain_seq::text AS chain_seq, row_hash FROM audit_logs WHERE entity_id = $1`,
      [userId],
    );
    expect(audit[0]?.actor_role).toBe('SYSTEM');
    expect(audit[0]?.action).toBe('UserBootstrap');
    expect(Number(audit[0]?.chain_seq)).toBeGreaterThan(0);
    expect(audit[0]?.row_hash).not.toBe('');
  });

  it('từ chối chạy lần hai khi đã có OWNER hoạt động', async () => {
    await expect(
      bootstrapOwner({
        connectionString: databaseUrl,
        username: 'bootstrap.owner.2',
        password: 'MatKhauThat@2026',
      }),
    ).rejects.toThrow(/OWNER/);
    const result = await rows<{ count: string }>(
      `SELECT count(*)::text AS count FROM users WHERE role = 'OWNER'`,
    );
    expect(Number(result[0]?.count)).toBe(1);
  });

  it('thiếu cấu hình thì từ chối rõ ràng', () => {
    expect(() => bootstrapCredentials({})).toThrow(/BOOTSTRAP_OWNER_USERNAME/);
    expect(() => bootstrapCredentials({ BOOTSTRAP_OWNER_USERNAME: 'x' })).toThrow(
      /BOOTSTRAP_OWNER_PASSWORD/,
    );
    expect(() =>
      bootstrapCredentials({ BOOTSTRAP_OWNER_USERNAME: 'x', BOOTSTRAP_OWNER_PASSWORD: 'ngan' }),
    ).toThrow(/8 ký tự/);
  });

  it('mật khẩu dev bắt buộc khi production, có mặc định ngoài production', () => {
    expect(resolveDevPassword({ NODE_ENV: 'test' })).toBe('PineHill@Dev2026');
    expect(resolveDevPassword({ NODE_ENV: 'production', SEED_DEV_PASSWORD: 'That@2026' })).toBe(
      'That@2026',
    );
    expect(() => resolveDevPassword({ NODE_ENV: 'production' })).toThrow(/SEED_DEV_PASSWORD/);
  });
});
