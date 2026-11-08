/**
 * HB-220 — đường đọc ca quá tải phải parse được bằng **chính hợp đồng công bố** (`@pinehill/contracts`)
 * mà BFF ops-web và Android dùng để decode. Lỗi QA HB-194 (QA-F6-07/08): server trả `meta.scan`,
 * `escalatedAt`/`version`, `history` và ứng viên chi tiết ca khác hợp đồng nên SCR-43 nhận 502 trên API
 * thật. Fixture/HTTP dùng lại của HB-126 (không sửa file khoá).
 */
import { describe, expect, test } from 'vitest';
import {
  overbookingAlertsViewSchema,
  overbookingCaseDetailSchema,
  overbookingCaseListSchema,
} from '@pinehill/contracts';
import {
  ALERTS_ROUTE,
  CASES_ROUTE,
  D,
  clock,
  cohortOf,
  http,
  propertyId,
  runScan,
  seedCase,
  tokenFor,
  typeId,
} from './detection-helpers/index.js';

const get = async (token: string, path: string, query: Record<string, string> = {}) => {
  const response = await http().get(path).query(query).set('authorization', `Bearer ${token}`);
  expect(response.status).toBe(200);
  const body: unknown = response.body;
  return body;
};

describe('HB-220 · hợp đồng đường đọc OVER', () => {
  test('list_and_scan_meta_parse_with_published_contract', async () => {
    await cohortOf(D);
    await seedCase({
      propertyId,
      date: D,
      roomTypeId: typeId,
      shortageCount: 1,
      detectedAt: new Date(clock.value),
    });
    const manager = await tokenFor('MANAGER');

    const never = overbookingCaseListSchema.parse(await get(manager, CASES_ROUTE, { propertyId }));
    expect(never.meta.scan).toEqual({ status: 'NEVER', lastSuccessAt: null, dataAsOf: null });
    expect(never.data[0]?.escalatedAt).toBeNull();
    expect(never.data[0]?.version).toBeGreaterThanOrEqual(1);

    await runScan([propertyId]);
    const scanned = overbookingCaseListSchema.parse(
      await get(manager, CASES_ROUTE, { propertyId }),
    );
    expect(scanned.meta.scan.status).toBe('SUCCEEDED');
    expect(scanned.meta.scan.lastSuccessAt).not.toBeNull();
  });

  test('detail_with_candidates_and_history_parse_with_published_contract', async () => {
    const cohort = await cohortOf(D);
    const escalatedAt = new Date(clock.value);
    const caseId = await seedCase({
      propertyId,
      date: D,
      roomTypeId: typeId,
      shortageCount: 1,
      status: 'ESCALATED',
      detectedAt: new Date(clock.value - 3_600_000),
      escalatedAt,
    });
    const manager = await tokenFor('MANAGER');

    const detail = overbookingCaseDetailSchema.parse(
      await get(manager, `${CASES_ROUTE}/${caseId}`, { includeCandidates: 'true' }),
    );
    expect(detail.history.map((event) => event.action)).toEqual(['DETECTED', 'ESCALATED']);
    expect(detail.history[1]?.at).toBe(escalatedAt.toISOString());
    expect(detail.escalatedAt).toBe(escalatedAt.toISOString());
    // Thứ tự và điểm giữ nguyên của bộ chọn HB-126; `rank` chỉ đánh số theo thứ tự đó.
    expect(detail.candidates.map((row) => row.rank)).toEqual(
      detail.candidates.map((_, i) => i + 1),
    );
    expect(detail.candidates[0]).toMatchObject({ bookingId: cohort.weak, priorityGroup: 'WEAK' });
    for (const row of detail.candidates) {
      const parts = row.keepScoreBreakdown;
      expect(row.keepScore).toBe(
        parts.loyalty + parts.payment + parts.nights + parts.repeat + parts.arrived,
      );
      expect(row.guestNameMasked).toMatch(/\*\*\*$/);
    }

    const plain = overbookingCaseDetailSchema.parse(await get(manager, `${CASES_ROUTE}/${caseId}`));
    expect(plain.candidates).toEqual([]);
    expect(plain.history).toHaveLength(2);
  });

  test('staff_alerts_parse_with_published_contract', async () => {
    const cohort = await cohortOf(D);
    const caseId = await seedCase({
      propertyId,
      date: D,
      roomTypeId: typeId,
      shortageCount: 1,
      detectedAt: new Date(clock.value),
    });
    const desk = await tokenFor('FRONT_DESK');
    // HB-221: projection lễ tân theo hợp đồng — một dòng mỗi booking cần xử lý, kèm độ tươi lượt quét.
    const before = overbookingAlertsViewSchema.parse(await get(desk, ALERTS_ROUTE, { propertyId }));
    // Fixture không xoá `overbooking_scan_runs` giữa các ca: trạng thái đầu phụ thuộc ca trước.
    expect(['NEVER', 'SUCCEEDED']).toContain(before.meta.scan.status);
    expect(before.data).toEqual([
      expect.objectContaining({ caseId, bookingId: cohort.weak, status: 'OPEN' }),
    ]);
    await runScan([propertyId]);
    const after = overbookingAlertsViewSchema.parse(await get(desk, ALERTS_ROUTE, { propertyId }));
    expect(after.meta.scan.status).toBe('SUCCEEDED');
    expect(after.meta.scan.lastSuccessAt).not.toBeNull();
  });
});
