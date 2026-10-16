import { randomBytes, randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PrismaClient } from '@prisma/client';
import pg from 'pg';
import { afterAll, beforeAll, expect, test } from 'vitest';
import { loadWorkerConfig } from '../src/config/env.js';
import { exportCleanupJob } from '../src/export/cleanup.job.js';
import { isRepeatableQueue, QUEUE_NAMES } from '../src/queues.js';
import type { JobContext } from '../src/jobs/types.js';

/**
 * HB-163 AC2 — dọn tệp xuất hết hạn trên PostgreSQL16 thật + đĩa thật: chỉ tệp quá hạn bị xoá, hàng
 * `operations` giữ nguyên; đường dẫn ngoài `EXPORT_DIR` bị bỏ qua mà không làm chết lượt dọn.
 */
const root = fileURLToPath(new URL('../../..', import.meta.url));
const dbName = `hb163_cleanup_${randomUUID().replaceAll('-', '')}`;
let owner: pg.Client,
  db: PrismaClient,
  ownerUrl = '',
  userId = '',
  exportDir = '',
  logs: string[] = [];

async function rows(sql: string, values: unknown[] = []): Promise<Record<string, unknown>[]> {
  return (await owner.query<Record<string, unknown>>(sql, values)).rows;
}

function context(): JobContext {
  logs = [];
  return {
    db,
    config: loadWorkerConfig({
      DATABASE_URL: ownerUrl,
      REDIS_URL: 'redis://127.0.0.1:6379',
      EXPORT_DIR: exportDir,
      LOG_LEVEL: 'silent',
    }),
    clock: { now: () => new Date('2026-11-05T00:00:00Z') },
    log: ({ queue, msg }) => logs.push(`${queue}:${msg}`),
  };
}

/** Hàng `SUCCEEDED` trỏ tới `path` — đúng ràng buộc `ck_operations_succeeded`. */
async function insertSucceededAt(id: string, path: string, expiresAt: string): Promise<void> {
  await rows(
    `INSERT INTO operations(id, kind, status, requested_by, property_scope, payload_json,
                            result_ref, result_path, result_expires_at, finished_at)
     VALUES($1::uuid,'REPORT_EXPORT','SUCCEEDED',$2::uuid,'{}','{}'::jsonb,$3,$4,$5,now())`,
    [id, userId, `/api/v1/operations/${id}/download`, path, expiresAt],
  );
}

/** Tạo tệp thật trong `dir` + hàng `SUCCEEDED` trỏ tới nó. */
async function insertSucceeded(
  dir: string,
  expiresAt: string,
): Promise<{ id: string; path: string }> {
  const id = randomUUID();
  const path = join(dir, `report-${id}.csv`);
  await writeFile(path, 'nội dung giả', 'utf8');
  await insertSucceededAt(id, path, expiresAt);
  return { id, path };
}

beforeAll(async () => {
  const migrationUrl = process.env.DATABASE_MIGRATION_URL;
  if (!migrationUrl) throw new Error('HB-163 requires PostgreSQL16; no skip fallback');
  const admin = new pg.Client({ connectionString: migrationUrl });
  await admin.connect();
  await admin.query(`CREATE DATABASE "${dbName}"`);
  const target = new URL(migrationUrl);
  target.pathname = `/${dbName}`;
  ownerUrl = target.href;
  const migration = spawnSync(process.execPath, [`${root}scripts/migrate.mjs`], {
    cwd: root,
    env: { ...process.env, DATABASE_MIGRATION_URL: ownerUrl, DATABASE_URL: '' },
    encoding: 'utf8',
  });
  expect(migration.status).toBe(0);
  owner = new pg.Client({ connectionString: ownerUrl });
  await owner.connect();
  db = new PrismaClient({ datasourceUrl: ownerUrl });
  exportDir = await mkdtemp(join(tmpdir(), 'hb163-cleanup-'));
  userId = String(
    (
      await rows(
        "INSERT INTO users(username,password_hash,full_name,role) VALUES($1,$2,'Synthetic','ACCOUNTANT') RETURNING id",
        [
          `hb163-cleanup-${randomBytes(4).toString('hex')}`,
          '$argon2id$v=19$m=19456,t=2,p=1$c2FsdA$hash',
        ],
      )
    )[0]!.id,
  );
}, 120000);

afterAll(async () => {
  await db?.$disconnect();
  await owner?.end();
  if (exportDir !== '') await rm(exportDir, { recursive: true, force: true });
  const admin = new pg.Client({ connectionString: process.env.DATABASE_MIGRATION_URL });
  await admin.connect();
  await admin.query(`DROP DATABASE IF EXISTS "${dbName}" WITH(FORCE)`);
  await admin.end();
}, 60000);

test('hàng đợi dọn tệp xuất có trong danh sách worker đăng ký và chạy lặp theo nhịp', () => {
  expect(QUEUE_NAMES).toContain('q.export-cleanup');
  expect(isRepeatableQueue('q.export-cleanup')).toBe(true);
});

test('chỉ xoá tệp quá hạn; hàng vẫn SUCCEEDED giữ nguyên result_path và tệp còn hạn còn nguyên', async () => {
  const expired = await insertSucceeded(exportDir, '2026-11-04T23:00:00Z');
  const fresh = await insertSucceeded(exportDir, '2026-11-05T00:10:00Z');
  await exportCleanupJob({}, context());
  expect(existsSync(expired.path)).toBe(false);
  expect(existsSync(fresh.path)).toBe(true);
  const expiredRow = await rows('SELECT status, result_path FROM operations WHERE id=$1::uuid', [
    expired.id,
  ]);
  expect(expiredRow[0]).toMatchObject({ status: 'SUCCEEDED', result_path: expired.path });
  const freshRow = await rows('SELECT status, result_path FROM operations WHERE id=$1::uuid', [
    fresh.id,
  ]);
  expect(freshRow[0]).toMatchObject({ status: 'SUCCEEDED', result_path: fresh.path });
  expect(logs.join('\n')).toContain('xoá 1');
});

test('đường dẫn ngoài EXPORT_DIR bị bỏ qua, không xoá gì và không chặn việc dọn hàng khác', async () => {
  const outsideDir = await mkdtemp(join(tmpdir(), 'hb163-outside-'));
  // Hàng đường dẫn lạ hết hạn SỚM HƠN để chắc chắn nó được xử lý trước hàng hợp lệ còn lại.
  const outside = await insertSucceeded(outsideDir, '2026-11-04T22:00:00Z');
  const expired = await insertSucceeded(exportDir, '2026-11-04T23:00:00Z');
  try {
    await exportCleanupJob({}, context());
    expect(existsSync(outside.path)).toBe(true);
    expect(existsSync(expired.path)).toBe(false);
    const kept = await rows('SELECT status, result_path FROM operations WHERE id=$1::uuid', [
      outside.id,
    ]);
    expect(kept[0]).toMatchObject({ status: 'SUCCEEDED', result_path: outside.path });
    const logged = logs.join('\n');
    expect(logged).toContain('bỏ qua 1');
    // Không ghi đường dẫn lạ vào log (chỉ số đếm).
    expect(logged.includes(outside.path)).toBe(false);
  } finally {
    await rm(outsideDir, { recursive: true, force: true });
  }
});

test('tệp không xoá được (đường dẫn là thư mục) ⇒ bỏ qua an toàn, hàng vẫn nguyên và lượt dọn đi tiếp', async () => {
  const blockedId = randomUUID();
  const blockedPath = join(exportDir, `report-${blockedId}.csv`);
  await mkdir(blockedPath, { recursive: true });
  // Hàng "không xoá được" hết hạn SỚM HƠN để chắc chắn nó được xử lý trước hàng còn lại.
  await insertSucceededAt(blockedId, blockedPath, '2026-11-04T21:00:00Z');
  const expired = await insertSucceeded(exportDir, '2026-11-04T23:00:00Z');
  await exportCleanupJob({}, context());
  expect(existsSync(blockedPath)).toBe(true);
  expect(existsSync(expired.path)).toBe(false);
  expect(logs.join('\n')).toContain('lỗi 1');
  const kept = await rows('SELECT status, result_path FROM operations WHERE id=$1::uuid', [
    blockedId,
  ]);
  expect(kept[0]).toMatchObject({ status: 'SUCCEEDED', result_path: blockedPath });
});
