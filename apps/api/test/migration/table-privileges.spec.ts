/**
 * HB-238 (TD-12) — khoá quyền thực của role runtime `app_rw` trên **mọi** bảng sau khi migrate.
 *
 * Baseline cấp `SELECT, INSERT, UPDATE, DELETE` mặc định cho bảng tạo về sau và yêu cầu "mọi migration PHẢI
 * chạy lại khối REVOKE" — yêu cầu bằng lời nên 0002…0010 đều quên. Test này biến yêu cầu thành cổng: bảng
 * mới (hoặc quyền đổi) mà chưa cập nhật bảng kỳ vọng dưới đây ⇒ đỏ, buộc người thêm bảng quyết quyền.
 */
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { afterAll, beforeAll, expect, it } from 'vitest';

const root = fileURLToPath(new URL('../../../../', import.meta.url));
const owner = process.env.DATABASE_MIGRATION_URL;

/** Chỉ ghi thêm: sổ kiểm toán, ảnh giá, chứng từ duyệt hoàn, lượt đồng bộ, lịch sử trạng thái. */
const APPEND_ONLY = [
  'audit_logs',
  'booking_status_history',
  'channel_sync_attempts',
  'price_snapshots',
  'refund_approvals',
  'refund_payout_simulator_transfers',
];
/** Sửa được (đổi trạng thái/upsert) nhưng không xoá: tiền, hồ sơ hoàn, vết vận hành. */
const NO_DELETE = [
  'channel_cancel_tombstones',
  'channel_sales_closures',
  'operations',
  'overbooking_scan_runs',
  'payments',
  'refund_allocations',
  'refund_payout_operations',
  'refund_requests',
];

const name = `hb238_privileges_${randomUUID().replaceAll('-', '')}`;
let admin: pg.Client;
let db: pg.Client;

beforeAll(async () => {
  if (!owner) throw new Error('HB-238 cần PostgreSQL 16 thật (DATABASE_MIGRATION_URL)');
  admin = new pg.Client({ connectionString: owner });
  await admin.connect();
  await admin.query(`CREATE DATABASE "${name}"`);
  const url = new URL(owner);
  url.pathname = `/${name}`;
  const migrate = spawnSync(process.execPath, [`${root}scripts/migrate.mjs`], {
    cwd: root,
    encoding: 'utf8',
    timeout: 60000,
    env: { ...process.env, DATABASE_URL: '', DATABASE_MIGRATION_URL: url.href },
  });
  expect(migrate.status, migrate.stderr).toBe(0);
  db = new pg.Client({ connectionString: url.href });
  await db.connect();
}, 90000);

afterAll(async () => {
  await db?.end();
  try {
    await admin?.query(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
  } finally {
    await admin?.end();
  }
});

it('HB238_app_rw_privileges_match_explicit_decision_for_every_table', async () => {
  const { rows } = await db.query<{ table: string; u: boolean; d: boolean; t: boolean }>(
    `SELECT c.relname AS table,
            has_table_privilege('app_rw', c.oid, 'UPDATE') AS u,
            has_table_privilege('app_rw', c.oid, 'DELETE') AS d,
            has_table_privilege('app_rw', c.oid, 'TRUNCATE') AS t
       FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p') AND c.relname <> '_prisma_migrations'
      ORDER BY c.relname`,
  );
  const actual = Object.fromEntries(
    rows.map((row) => [
      row.table,
      row.u ? (row.d ? 'FULL' : 'NO_DELETE') : row.d ? 'ODD' : 'APPEND_ONLY',
    ]),
  );
  const expected = Object.fromEntries(
    rows.map((row) => [
      row.table,
      APPEND_ONLY.includes(row.table)
        ? 'APPEND_ONLY'
        : NO_DELETE.includes(row.table)
          ? 'NO_DELETE'
          : 'FULL',
    ]),
  );
  // Bảng mới rơi vào FULL theo quyền mặc định: nếu nó là sổ/tiền, thêm vào APPEND_ONLY/NO_DELETE + REVOKE.
  expect(actual).toEqual(expected);
  expect(rows.filter((row) => row.t).map((row) => row.table)).toEqual([]);
  // Mọi tên trong danh sách kỳ vọng phải là bảng có thật (danh sách không mục đi).
  const tables = new Set(rows.map((row) => row.table));
  expect([...APPEND_ONLY, ...NO_DELETE].filter((table) => !tables.has(table))).toEqual([]);
});
