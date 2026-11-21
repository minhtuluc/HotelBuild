/**
 * HB-246 (phần API của HB-179) — `GET/POST /system/backups`, `POST /system/backups/{backupId}/restore`.
 * API chỉ ghi yêu cầu; vai sidecar (giành việc + chốt kết quả) được mô phỏng bằng SQL như sidecar thật chạy.
 */
import { randomUUID } from 'node:crypto';
import { beforeEach, expect, test } from 'vitest';
import {
  backupStatusSchema,
  errorBodySchema,
  operationRefSchema,
  operationStatusViewSchema,
} from '@pinehill/contracts';
import { http, login, rows, write } from '../prop/fixture.js';

const FULL = '20261001-190002F';
const INCR = '20261001-190002F_20261005-020001I';
// Đồng hồ của fixture: 2026-10-09T00:00:00Z.
const info = [
  {
    name: 'pinehill',
    status: { code: 0, message: 'ok' },
    archive: [{ min: '000000010000000000000001', max: '000000010000000000000009' }],
    backup: [
      {
        label: FULL,
        type: 'full',
        timestamp: { start: 1790881202, stop: 1790881262 },
        info: { size: 52_428_800, repository: { size: 9_437_184 } },
      },
      {
        label: INCR,
        type: 'incr',
        timestamp: { start: 1791165601, stop: 1791165611 },
        info: { size: 52_428_800, repository: { size: 65_536 } },
      },
      { label: 'rác', type: 'full' },
    ],
  },
];

const status = (token: string) =>
  http().get('/api/v1/system/backups').set('Authorization', `Bearer ${token}`);
const operation = (token: string, id: string) =>
  http().get(`/api/v1/operations/${id}`).set('Authorization', `Bearer ${token}`);
const code = (body: unknown) => errorBodySchema.parse(body).code;

beforeEach(async () => {
  await rows("DELETE FROM operations WHERE kind IN ('BACKUP','RESTORE_DRILL')");
  await rows('DELETE FROM backup_catalog');
});

test('HB246_status_reads_catalog_archiver_and_operations', async () => {
  const admin = await login('SYSADMIN');
  const empty = backupStatusSchema.parse((await status(admin)).body);
  expect(empty).toMatchObject({ catalogRefreshedAt: null, backups: [], operations: [] });
  expect(empty.archive.failedCount).toBeGreaterThanOrEqual(0);

  await rows('INSERT INTO backup_catalog(info_json) VALUES($1::jsonb)', [JSON.stringify(info)]);
  const filled = backupStatusSchema.parse((await status(admin)).body);
  // Mới nhất trước; phần tử hỏng ("rác") bị bỏ qua thay vì làm hỏng màn hình.
  expect(filled.backups).toEqual([
    {
      backupId: INCR,
      type: 'INCR',
      startedAt: '2026-10-05T02:00:01.000Z',
      finishedAt: '2026-10-05T02:00:11.000Z',
      databaseSizeBytes: 52_428_800,
      repositorySizeBytes: 65_536,
    },
    {
      backupId: FULL,
      type: 'FULL',
      startedAt: '2026-10-01T19:00:02.000Z',
      finishedAt: '2026-10-01T19:01:02.000Z',
      databaseSizeBytes: 52_428_800,
      repositorySizeBytes: 9_437_184,
    },
  ]);
  expect(filled.catalogRefreshedAt).not.toBeNull();
});

test('HB246_backup_request_202_one_active_at_a_time_and_sidecar_result_visible', async () => {
  const admin = await login('SYSADMIN');
  const key = randomUUID();
  const accepted = await write('post', 'system/backups', admin, { mode: 'FULL' }, null, key);
  expect(accepted.status, JSON.stringify(accepted.body)).toBe(202);
  const ref = operationRefSchema.parse(accepted.body);
  expect(accepted.headers.location).toBe(`/api/v1/operations/${ref.operationId}`);
  // Gửi lại cùng khoá ⇒ phát lại đúng kết quả, không phải 409.
  const replay = await write('post', 'system/backups', admin, { mode: 'FULL' }, null, key);
  expect(operationRefSchema.parse(replay.body).operationId).toBe(ref.operationId);
  const second = await write('post', 'system/backups', admin, { mode: 'PITR' });
  expect(second.status).toBe(409);
  expect(code(second.body)).toBe('E_SYS_REQUEST_IN_PROGRESS');
  expect(
    await rows(
      "SELECT action, after_json FROM audit_logs WHERE entity_id=$1::uuid AND action='BACKUP_REQUESTED'",
      [ref.operationId],
    ),
  ).toEqual([{ action: 'BACKUP_REQUESTED', after_json: { mode: 'FULL' } }]);

  // Sidecar: giành việc rồi chốt. Thiếu `result_json` thì CSDL chặn trạng thái SUCCEEDED.
  await rows(
    "UPDATE operations SET status='RUNNING', started_at=now() WHERE id=$1::uuid AND status='PENDING'",
    [ref.operationId],
  );
  await expect(
    rows("UPDATE operations SET status='SUCCEEDED', finished_at=now() WHERE id=$1::uuid", [
      ref.operationId,
    ]),
  ).rejects.toThrow(/ck_operations_succeeded/);
  await rows(
    `UPDATE operations SET status='SUCCEEDED', finished_at=now(),
            result_json=jsonb_build_object('backupId', $2::text) WHERE id=$1::uuid`,
    [ref.operationId, FULL],
  );
  const polled = operationStatusViewSchema.parse((await operation(admin, ref.operationId)).body);
  expect(polled.status).toBe('SUCCEEDED');
  const listed = backupStatusSchema.parse((await status(admin)).body).operations;
  expect(listed).toMatchObject([
    {
      operationId: ref.operationId,
      kind: 'BACKUP',
      status: 'SUCCEEDED',
      request: { mode: 'FULL' },
      result: { backupId: FULL },
      errorCode: null,
    },
  ]);
  // Xong rồi ⇒ được yêu cầu tiếp.
  expect((await write('post', 'system/backups', admin, { mode: 'PITR' })).status).toBe(202);
});

test('HB246_restore_drill_validates_backup_and_target_then_queues', async () => {
  await rows('INSERT INTO backup_catalog(info_json) VALUES($1::jsonb)', [JSON.stringify(info)]);
  const admin = await login('SYSADMIN');
  const body = { targetTimestamp: '2026-10-06T00:00:00Z', reason: 'Diễn tập học kỳ' };
  const restore = (id: string, payload: object = body) =>
    write('post', `system/backups/${id}/restore`, admin, payload);

  expect((await restore('20261002-190002F')).status).toBe(404);
  expect((await restore('khong-phai-nhan')).status).toBe(400);
  // Trước khi bản INCR xong (02:00:11Z ngày 05/10) và ở tương lai (đồng hồ 09/10) đều bị chặn.
  expect((await restore(INCR, { ...body, targetTimestamp: '2026-10-05T02:00:00Z' })).status).toBe(
    400,
  );
  expect((await restore(INCR, { ...body, targetTimestamp: '2026-10-10T00:00:00Z' })).status).toBe(
    400,
  );
  // Không nhận đường dẫn/URL CSDL từ client (§2.14): trường lạ ⇒ 400.
  expect((await restore(FULL, { ...body, databaseUrl: 'postgres://x' })).status).toBe(400);

  const accepted = await restore(FULL);
  expect(accepted.status, JSON.stringify(accepted.body)).toBe(202);
  const ref = operationRefSchema.parse(accepted.body);
  expect(
    await rows('SELECT kind, status, payload_json FROM operations WHERE id=$1::uuid', [
      ref.operationId,
    ]),
  ).toEqual([
    {
      kind: 'RESTORE_DRILL',
      status: 'PENDING',
      payload_json: { backupId: FULL, targetTimestamp: '2026-10-06T00:00:00Z' },
    },
  ]);
  expect(
    await rows(
      "SELECT reason FROM audit_logs WHERE entity_id=$1::uuid AND action='RESTORE_DRILL_REQUESTED'",
      [ref.operationId],
    ),
  ).toEqual([{ reason: 'Diễn tập học kỳ' }]);
  // Sao lưu và diễn tập không chạy chồng lên nhau.
  expect((await write('post', 'system/backups', admin, { mode: 'FULL' })).status).toBe(409);
});

test('HB246_only_sysadmin_and_app_role_cannot_write_catalog', async () => {
  for (const role of ['OWNER', 'MANAGER', 'FRONT_DESK']) {
    const token = await login(role);
    expect((await status(token)).status).toBe(403);
    expect((await write('post', 'system/backups', token, { mode: 'FULL' })).status).toBe(403);
  }
  expect(
    await rows(
      `SELECT has_table_privilege('app_rw','backup_catalog','SELECT') AS s,
              has_table_privilege('app_rw','backup_catalog','INSERT') AS i,
              has_table_privilege('app_rw','backup_catalog','UPDATE') AS u`,
    ),
  ).toEqual([{ s: true, i: false, u: false }]);
});
