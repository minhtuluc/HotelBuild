import { describe, expect, test } from 'vitest';
import { randomUUID } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  errorBodySchema,
  operationRefSchema,
  operationStatusViewSchema,
} from '@pinehill/contracts';
import {
  downloadArtifact,
  exportDir,
  exportJobs,
  http,
  login,
  operationStatus,
  requestExport,
  rows,
  userId,
} from './http-fixture.js';
import { propertyId, stay } from '../reports/seed.js';

/**
 * Dựng bộ lọc **trong lúc chạy test**: `propertyId` là biến `let` của seed, chỉ có giá trị sau `beforeAll`
 * của file seed (đọc ở thời điểm nạp module sẽ ra chuỗi rỗng ⇒ 400).
 */
function filters(): Record<string, string> {
  return { from: stay.from, to: stay.to, propertyId };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

async function requestOwn(): Promise<{ token: string; operationId: string }> {
  const token = await login('ACCOUNTANT');
  const response = await requestExport(token, {
    report: 'occupancy',
    format: 'CSV',
    params: filters(),
  });
  expect(response.status).toBe(202);
  const ref = operationRefSchema.parse(response.body);
  // api.md §6.4: lệnh 202 phải kèm `Location` trỏ tới chính tài nguyên theo dõi.
  expect(response.headers.location).toBe(ref.statusUrl);
  return { token, operationId: ref.operationId };
}

/** Giả lập phần worker: ghi tệp + đóng dấu SUCCEEDED để kiểm tuyến trạng thái/tải. */
async function completeOperation(operationId: string, content: string): Promise<void> {
  const path = join(exportDir, `report-${operationId}.csv`);
  await writeFile(path, content, 'utf8');
  await rows(
    `UPDATE operations SET status='SUCCEEDED', result_ref=$2, result_path=$3,
            result_expires_at=now() + interval '15 minutes', result_json=NULL, finished_at=now()
      WHERE id=$1::uuid`,
    [operationId, `/api/v1/operations/${operationId}/download`, path],
  );
}

describe('HB-163 · POST /reports/export', () => {
  test('ACCOUNTANT nhận 202 kèm operationId, bản ghi thao tác có ảnh chụp và audit', async () => {
    const { operationId } = await requestOwn();
    const ref = operationRefSchema.parse({
      operationId,
      status: 'PENDING',
      statusUrl: `/api/v1/operations/${operationId}`,
    });
    expect(ref.statusUrl).toBe(`/api/v1/operations/${operationId}`);
    const stored = await rows(
      `SELECT kind, status, requested_by, payload_json, result_json, property_scope
         FROM operations WHERE id=$1::uuid`,
      [operationId],
    );
    expect(stored).toHaveLength(1);
    expect(stored[0]?.['kind']).toBe('REPORT_EXPORT');
    expect(stored[0]?.['status']).toBe('PENDING');
    expect(String(stored[0]?.['requested_by'])).toMatch(/^[0-9a-f-]{36}$/);
    // pg trả `jsonb` thành object đã parse; kiểm bằng narrowing thay vì ép kiểu.
    const operation = stored[0];
    expect(operation).toBeDefined();
    expect(operation?.['payload_json']).toEqual({
      report: 'occupancy',
      format: 'CSV',
      params: filters(),
    });
    const snapshot = operation?.['result_json'];
    expect(isRecord(snapshot)).toBe(true);
    // Cùng tham số với báo cáo trên màn hình ⇒ cùng số (AC3): 3 ngày của kỳ ở đã seed.
    expect(isRecord(snapshot) ? snapshot['rows'] : []).toHaveLength(3);
    const audit = await rows(
      "SELECT action FROM audit_logs WHERE action='REPORT_EXPORT_REQUESTED' AND entity_id=$1::uuid",
      [operationId],
    );
    expect(audit).toHaveLength(1);
  });

  test('chỉ ACCOUNTANT/OWNER được yêu cầu xuất; vai trò khác và khách ẩn danh bị từ chối', async () => {
    for (const role of ['MANAGER', 'FRONT_DESK', 'HOUSEKEEPING', 'RESERVATION_AGENT']) {
      const token = await login(role);
      const response = await requestExport(token, {
        report: 'occupancy',
        format: 'CSV',
        params: filters(),
      });
      expect(response.status, role).toBe(403);
      expect(errorBodySchema.parse(response.body).code).toBe('E_RBAC_FORBIDDEN');
    }
    const anonymous = await http().post('/api/v1/reports/export').send({
      report: 'occupancy',
      format: 'CSV',
      params: filters(),
    });
    expect(anonymous.status).toBe(401);
    const owner = await login('OWNER');
    expect(
      (await requestExport(owner, { report: 'cancellations', format: 'XLSX', params: filters() }))
        .status,
    ).toBe(202);
  });

  test('tham số sai bị chặn theo báo cáo được chọn', async () => {
    const token = await login('ACCOUNTANT');
    const cases: readonly Record<string, unknown>[] = [
      { report: 'unknown', format: 'CSV', params: filters() },
      { report: 'occupancy', format: 'PDF', params: filters() },
      { report: 'occupancy', format: 'CSV', params: { from: stay.from } },
      { report: 'occupancy', format: 'CSV', params: { from: '2020-01-01', to: '2021-06-01' } },
      { report: 'occupancy', format: 'CSV', params: { from: stay.from, to: stay.to, extra: '1' } },
    ];
    for (const body of cases) {
      const response = await requestExport(token, body);
      expect(response.status, JSON.stringify(body)).toBe(400);
      expect(errorBodySchema.parse(response.body).code).toBe('E_GEN_VALIDATION_FAILED');
    }
  });
});

describe('HB-163 · GET /operations/{operationId}', () => {
  test('chỉ người yêu cầu hoặc OWNER xem được trạng thái', async () => {
    const { operationId } = await requestOwn();
    const owner = await login('OWNER');
    const ownerView = operationStatusViewSchema.parse(
      (await operationStatus(owner, operationId)).body,
    );
    expect(ownerView).toMatchObject({ operationId, status: 'PENDING' });
    const manager = await login('MANAGER');
    const denied = await operationStatus(manager, operationId);
    expect(denied.status).toBe(403);
    expect(errorBodySchema.parse(denied.body).code).toBe('E_RBAC_FORBIDDEN');
    // Đăng nhập lại OWNER: `login` của fixture đổi vai trò người dùng dùng chung nên token cũ đã thành MANAGER.
    const ownerAgain = await login('OWNER');
    const missing = await operationStatus(ownerAgain, '11111111-1111-4111-8111-111111111111');
    expect(missing.status).toBe(404);
    expect(errorBodySchema.parse(missing.body).code).toBe('E_GEN_NOT_FOUND');
  });

  test('thao tác xong trả resultRef đã ký và tải được tệp; chữ ký sai hoặc hết hạn bị chặn', async () => {
    const { token, operationId } = await requestOwn();
    const csv = '\uFEFFNhóm,Ngày\r\n2026-11-01,2026-11-01\r\n';
    await completeOperation(operationId, csv);
    const view = operationStatusViewSchema.parse((await operationStatus(token, operationId)).body);
    expect(view.status).toBe('SUCCEEDED');
    const resultRef = view.resultRef;
    expect(resultRef).toBeDefined();
    const url = String(resultRef);
    expect(url).toContain(`/api/v1/operations/${operationId}/download?expires=`);
    expect(url).toContain('signature=');
    const download = await downloadArtifact(token, url);
    expect(download.status).toBe(200);
    expect(download.headers['content-type']).toContain('text/csv');
    expect(download.headers['content-disposition']).toContain(`report-${operationId}.csv`);
    expect(download.text).toBe(csv);
    // Ký tự cuối đổi sang giá trị hex **khác** giá trị đang có: ghi cứng '0' thì 1/16 chữ ký vốn kết
    // thúc bằng '0' sẽ cho URL y hệt và ca test đỏ ngẫu nhiên.
    const lastChar = url.slice(-1);
    const tampered = await downloadArtifact(
      token,
      `${url.slice(0, -1)}${lastChar === '0' ? '1' : '0'}`,
    );
    expect(tampered.status).toBe(403);
    await rows(
      "UPDATE operations SET result_expires_at = now() - interval '1 minute' WHERE id=$1::uuid",
      [operationId],
    );
    const expiredView = operationStatusViewSchema.parse(
      (await operationStatus(token, operationId)).body,
    );
    expect(expiredView.status).toBe('SUCCEEDED');
    expect(expiredView.resultRef).toBeUndefined();
    expect((await downloadArtifact(token, url)).status).toBe(404);
  });

  test('thiếu chữ ký hoặc tham số hạn sai trả 400', async () => {
    const { token, operationId } = await requestOwn();
    await completeOperation(operationId, 'a,b\r\n');
    const noSignature = await downloadArtifact(
      token,
      `/api/v1/operations/${operationId}/download?expires=99999999999`,
    );
    expect(noSignature.status).toBe(400);
    const badExpires = await downloadArtifact(
      token,
      `/api/v1/operations/${operationId}/download?expires=abc&signature=${'0'.repeat(64)}`,
    );
    expect(badExpires.status).toBe(400);
  });
});

describe('HB-163 · POST /reports/export chống trùng (BR-GEN-08)', () => {
  test('cùng khoá + cùng thân lệnh ⇒ cùng operationId, một hàng operations, một job, phát lại kèm Location', async () => {
    const token = await login('ACCOUNTANT');
    const payload = { report: 'occupancy', format: 'CSV', params: filters() };
    const key = randomUUID();
    const first = await requestExport(token, payload, key);
    expect(first.status).toBe(202);
    const ref = operationRefSchema.parse(first.body);
    expect(first.headers.location).toBe(ref.statusUrl);
    const second = await requestExport(token, payload, key);
    expect(second.status).toBe(202);
    expect(second.headers['idempotency-replayed']).toBe('true');
    expect(second.headers.location).toBe(ref.statusUrl);
    expect(operationRefSchema.parse(second.body)).toEqual(ref);
    expect(
      await rows('SELECT id FROM operations WHERE id=$1::uuid', [ref.operationId]),
    ).toHaveLength(1);
    expect(await rows('SELECT id FROM operations')).toHaveLength(1);
    expect(
      await rows(
        "SELECT id FROM audit_logs WHERE action='REPORT_EXPORT_REQUESTED' AND entity_id=$1::uuid",
        [ref.operationId],
      ),
    ).toHaveLength(1);
    const jobs = await exportJobs();
    expect(jobs).toHaveLength(1);
    expect(jobs[0]?.id).toBe(ref.operationId);
  });

  test('cùng khoá nhưng thân lệnh khác ⇒ 409 E_SYS_IDEMPOTENCY_KEY_REUSED, không tạo thao tác thứ hai', async () => {
    const token = await login('ACCOUNTANT');
    const key = randomUUID();
    expect(
      (await requestExport(token, { report: 'occupancy', format: 'CSV', params: filters() }, key))
        .status,
    ).toBe(202);
    const conflict = await requestExport(
      token,
      { report: 'occupancy', format: 'XLSX', params: filters() },
      key,
    );
    expect(conflict.status).toBe(409);
    expect(errorBodySchema.parse(conflict.body).code).toBe('E_SYS_IDEMPOTENCY_KEY_REUSED');
    expect(await rows('SELECT id FROM operations')).toHaveLength(1);
    expect(await exportJobs()).toHaveLength(1);
  });

  test('thiếu Idempotency-Key ⇒ 400 E_GEN_VALIDATION_FAILED, không ghi hàng nào', async () => {
    const token = await login('ACCOUNTANT');
    const response = await http()
      .post('/api/v1/reports/export')
      .set('Authorization', `Bearer ${token}`)
      .send({ report: 'occupancy', format: 'CSV', params: filters() });
    expect(response.status).toBe(400);
    expect(errorBodySchema.parse(response.body).code).toBe('E_GEN_VALIDATION_FAILED');
    expect(await rows('SELECT id FROM operations')).toHaveLength(0);
    expect(await exportJobs()).toHaveLength(0);
  });
});

describe('HB-163 · quyền hiện tại khi đọc thao tác cũ (api.md §6.4)', () => {
  test('thu hẹp phạm vi cơ sở sau khi yêu cầu ⇒ 403 cả trạng thái lẫn tải tệp; OWNER vẫn xem được', async () => {
    const { token, operationId } = await requestOwn();
    await completeOperation(operationId, 'Nhóm,Ngày\r\n2026-11-01,2026-11-01\r\n');
    const view = operationStatusViewSchema.parse((await operationStatus(token, operationId)).body);
    const url = String(view.resultRef);
    expect((await downloadArtifact(token, url)).status).toBe(200);
    // Thu hẹp quyền của chính người tạo: hàng `operations` vẫn còn nhưng ảnh chụp `property_scope` lúc
    // yêu cầu không còn nằm trong phạm vi hiện tại.
    await rows('DELETE FROM user_property_scopes WHERE user_id=$1::uuid', [userId]);
    try {
      const denied = await operationStatus(token, operationId);
      expect(denied.status).toBe(403);
      expect(errorBodySchema.parse(denied.body).code).toBe('E_RBAC_FORBIDDEN');
      expect(denied.body).not.toHaveProperty('resultRef');
      // Cùng URL đã ký và cùng người tạo, chỉ khác phạm vi ⇒ 403 ngay trước bước kiểm chữ ký.
      expect((await downloadArtifact(token, url)).status).toBe(403);
      const owner = await login('OWNER');
      const ownerView = operationStatusViewSchema.parse(
        (await operationStatus(owner, operationId)).body,
      );
      expect(ownerView).toMatchObject({ operationId, status: 'SUCCEEDED' });
      expect(ownerView.resultRef).toBeDefined();
    } finally {
      await rows(
        'INSERT INTO user_property_scopes(user_id,property_id) VALUES($1::uuid,$2::uuid)',
        [userId, propertyId],
      );
    }
  });
});
