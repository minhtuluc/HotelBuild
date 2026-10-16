import { randomBytes, randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PrismaClient } from '@prisma/client';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { loadWorkerConfig } from '../src/config/env.js';
import { QUEUE_NAMES } from '../src/queues.js';
import { reportExportJob } from '../src/export/report-export.job.js';
import type { JobContext } from '../src/jobs/types.js';

/**
 * HB-163 — job sinh tệp xuất chạy trên PostgreSQL16 thật: đọc `operations`, ghi tệp CSV/XLSX, đóng dấu
 * `SUCCEEDED`; chạy lại không sinh tệp lần hai; payload hỏng ⇒ `FAILED` kèm mã lỗi.
 *
 * Vòng đời chịu retry/crash: hàng `RUNNING` còn sót được giành lại; lỗi ở lượt giữa để hàng thử lại;
 * chỉ lượt cuối mới `FAILED` + audit.
 */
const root = fileURLToPath(new URL('../../..', import.meta.url));
const dbName = `hb163_worker_${randomUUID().replaceAll('-', '')}`;
let owner: pg.Client,
  db: PrismaClient,
  exportDir = '',
  operationId = '',
  userId = '';

async function rows(sql: string, values: unknown[] = []): Promise<Record<string, unknown>[]> {
  return (await owner.query<Record<string, unknown>>(sql, values)).rows;
}

function context(): JobContext {
  return {
    db,
    config: loadWorkerConfig({
      DATABASE_URL: ownerUrl,
      REDIS_URL: 'redis://127.0.0.1:6379',
      EXPORT_DIR: exportDir,
      LOG_LEVEL: 'silent',
    }),
    clock: { now: () => new Date('2026-11-05T00:00:00Z') },
    log: () => undefined,
  };
}

let ownerUrl = '';

async function insertOperation(payload: unknown, snapshot: unknown): Promise<string> {
  const id = randomUUID();
  await rows(
    `INSERT INTO operations(id, kind, status, requested_by, property_scope, payload_json, result_json)
     VALUES($1::uuid,'REPORT_EXPORT','PENDING',$2::uuid,'{}',$3::jsonb,$4::jsonb)`,
    [id, userId, JSON.stringify(payload), JSON.stringify(snapshot)],
  );
  return id;
}

const OCCUPANCY = {
  groupBy: 'DAY',
  from: '2026-11-01',
  to: '2026-11-04',
  rows: [
    {
      key: '2026-11-01',
      businessDate: '2026-11-01',
      soldUnits: 2,
      availableUnits: 8,
      occupancyPct: 25,
    },
  ],
};

beforeAll(async () => {
  const migrationUrl = process.env.DATABASE_MIGRATION_URL;
  if (!migrationUrl) throw new Error('HB-163 requires PostgreSQL16; no skip fallback');
  const admin = new pg.Client({ connectionString: migrationUrl });
  await admin.connect();
  await admin.query(`CREATE DATABASE "${dbName}"`);
  ownerUrl = new URL(migrationUrl).href;
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
  exportDir = await mkdtemp(join(tmpdir(), 'hb163-worker-'));
  userId = String(
    (
      await rows(
        "INSERT INTO users(username,password_hash,full_name,role) VALUES($1,$2,'Synthetic','ACCOUNTANT') RETURNING id",
        [`hb163-${randomBytes(4).toString('hex')}`, '$argon2id$v=19$m=19456,t=2,p=1$c2FsdA$hash'],
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

test('hàng đợi xuất báo cáo có trong danh sách worker đăng ký (khớp tên API đẩy job)', () => {
  // API đẩy vào `q.report-export`; nếu tên lệch, job sẽ nằm im trong Redis mà không ai xử lý.
  expect(QUEUE_NAMES).toContain('q.report-export');
});

describe('HB-163 · reportExportJob', () => {
  test('sinh tệp CSV, đóng dấu SUCCEEDED và xoá ảnh chụp kết quả', async () => {
    operationId = await insertOperation(
      { report: 'occupancy', format: 'CSV', params: { from: '2026-11-01', to: '2026-11-04' } },
      OCCUPANCY,
    );
    await reportExportJob({ operationId }, context());
    const stored = await rows(
      'SELECT status, result_path, result_ref, result_expires_at, result_json, finished_at FROM operations WHERE id=$1::uuid',
      [operationId],
    );
    expect(stored[0]).toMatchObject({
      status: 'SUCCEEDED',
      result_ref: `/api/v1/operations/${operationId}/download`,
      result_json: null,
    });
    const path = String(stored[0]!.result_path);
    expect(path.startsWith(exportDir)).toBe(true);
    expect(stored[0]!.result_expires_at).toBeInstanceOf(Date);
    expect(stored[0]!.finished_at).toBeInstanceOf(Date);
    const csv = await readFile(path, 'utf8');
    expect(csv.startsWith('\uFEFF')).toBe(true);
    expect(csv).toContain('Nhóm,Ngày');
    expect(csv).toContain('2026-11-01,2026-11-01,,,2,8,25');
  });

  test('chạy lại trên thao tác đã xong là no-op (không sinh tệp lần hai)', async () => {
    const before = await rows('SELECT result_path, finished_at FROM operations WHERE id=$1::uuid', [
      operationId,
    ]);
    await reportExportJob({ operationId }, context());
    const after = await rows('SELECT result_path, finished_at FROM operations WHERE id=$1::uuid', [
      operationId,
    ]);
    expect(after[0]).toEqual(before[0]);
  });

  test('định dạng XLSX sinh tệp ZIP hợp lệ chứa đúng dữ liệu', async () => {
    const id = await insertOperation(
      { report: 'occupancy', format: 'XLSX', params: { from: '2026-11-01', to: '2026-11-04' } },
      OCCUPANCY,
    );
    await reportExportJob({ operationId: id }, context());
    const stored = await rows('SELECT status, result_path FROM operations WHERE id=$1::uuid', [id]);
    expect(stored[0]!.status).toBe('SUCCEEDED');
    const path = String(stored[0]!.result_path);
    const bytes = await readFile(path);
    expect(bytes.subarray(0, 2).toString('latin1')).toBe('PK');
    expect(bytes.includes(Buffer.from('xl/worksheets/sheet1.xml', 'utf8'))).toBe(true);
  });

  test('payload hỏng ⇒ FAILED kèm mã lỗi, không tạo tệp', async () => {
    const id = await insertOperation({ report: 'occupancy' }, OCCUPANCY);
    await expect(reportExportJob({ operationId: id }, context())).rejects.toThrow(
      'EXPORT_STORED_PAYLOAD_INVALID',
    );
    const stored = await rows(
      'SELECT status, error_code, result_path, finished_at FROM operations WHERE id=$1::uuid',
      [id],
    );
    expect(stored[0]).toMatchObject({
      status: 'FAILED',
      error_code: 'E_GEN_SERVICE_UNAVAILABLE',
      result_path: null,
    });
    expect(stored[0]!.finished_at).toBeInstanceOf(Date);
    expect(existsSync(join(exportDir, `report-${id}.csv`))).toBe(false);
  });

  test('payload job sai kiểu bị từ chối trước khi chạm CSDL', async () => {
    await expect(reportExportJob({ operationId: 'not-a-uuid' }, context())).rejects.toThrow(
      'EXPORT_PAYLOAD_INVALID',
    );
  });

  test('hàng RUNNING còn sót từ lượt chết giữa đường vẫn được giành lại và chạy tới SUCCEEDED', async () => {
    const id = await insertOperation(
      { report: 'occupancy', format: 'CSV', params: { from: '2026-11-01', to: '2026-11-04' } },
      OCCUPANCY,
    );
    await rows("UPDATE operations SET status='RUNNING', started_at=now() WHERE id=$1::uuid", [id]);
    await reportExportJob({ operationId: id }, context(), { attempt: 2, attempts: 3 });
    const stored = await rows('SELECT status, result_path FROM operations WHERE id=$1::uuid', [id]);
    expect(stored[0]!.status).toBe('SUCCEEDED');
    expect(existsSync(String(stored[0]!.result_path))).toBe(true);
  });

  test('lỗi ở lượt giữa để hàng ở RUNNING cho lượt sau (chưa FAILED, chưa ghi audit)', async () => {
    const id = await insertOperation({ report: 'occupancy' }, OCCUPANCY);
    await expect(
      reportExportJob({ operationId: id }, context(), { attempt: 1, attempts: 3 }),
    ).rejects.toThrow('EXPORT_STORED_PAYLOAD_INVALID');
    const afterFirst = await rows(
      'SELECT status, error_code, error_message, finished_at FROM operations WHERE id=$1::uuid',
      [id],
    );
    expect(afterFirst[0]).toMatchObject({
      status: 'RUNNING',
      error_code: null,
      error_message: null,
      finished_at: null,
    });
    const audits = await rows(
      "SELECT count(*)::int AS n FROM audit_logs WHERE entity_id=$1::uuid AND action='REPORT_EXPORT_FAILED'",
      [id],
    );
    expect(audits[0]!.n).toBe(0);
    // Lượt sau chạy tiếp trên chính hàng đó (ảnh chụp đã sửa) ⇒ thao tác không bị kẹt.
    await rows('UPDATE operations SET payload_json=$2::jsonb WHERE id=$1::uuid', [
      id,
      JSON.stringify({
        report: 'occupancy',
        format: 'CSV',
        params: { from: '2026-11-01', to: '2026-11-04' },
      }),
    ]);
    await reportExportJob({ operationId: id }, context(), { attempt: 2, attempts: 3 });
    const retried = await rows('SELECT status, result_path FROM operations WHERE id=$1::uuid', [
      id,
    ]);
    expect(retried[0]!.status).toBe('SUCCEEDED');
    expect(existsSync(String(retried[0]!.result_path))).toBe(true);
  });

  test('lỗi ở lượt cuối ⇒ FAILED kèm mã lỗi đã che và đúng một bản ghi kiểm toán', async () => {
    const id = await insertOperation({ report: 'occupancy' }, OCCUPANCY);
    await expect(
      reportExportJob({ operationId: id }, context(), { attempt: 3, attempts: 3 }),
    ).rejects.toThrow('EXPORT_STORED_PAYLOAD_INVALID');
    const stored = await rows(
      'SELECT status, error_code, error_message, result_path, finished_at FROM operations WHERE id=$1::uuid',
      [id],
    );
    expect(stored[0]).toMatchObject({
      status: 'FAILED',
      error_code: 'E_GEN_SERVICE_UNAVAILABLE',
      error_message: 'Không sinh được tệp báo cáo.',
      result_path: null,
    });
    expect(stored[0]!.finished_at).toBeInstanceOf(Date);
    const audits = await rows(
      "SELECT actor_id, actor_role, entity_type, after_json FROM audit_logs WHERE entity_id=$1::uuid AND action='REPORT_EXPORT_FAILED'",
      [id],
    );
    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({
      actor_id: null,
      actor_role: 'SYSTEM',
      entity_type: 'Operation',
    });
    expect(audits[0]!.after_json).toMatchObject({
      status: 'FAILED',
      errorCode: 'E_GEN_SERVICE_UNAVAILABLE',
      attempt: 3,
      attempts: 3,
    });
    // Thao tác đã FAILED ⇒ lượt phát lại không chạm gì thêm (nhật ký kiểm toán không nhân đôi).
    await reportExportJob({ operationId: id }, context(), { attempt: 3, attempts: 3 });
    const after = await rows(
      "SELECT count(*)::int AS n FROM audit_logs WHERE entity_id=$1::uuid AND action='REPORT_EXPORT_FAILED'",
      [id],
    );
    expect(after[0]!.n).toBe(1);
  });
});
