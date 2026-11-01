/**
 * HB-126 — test khoá **đường đọc ca quá tải** (giai đoạn A, đỏ có chủ đích).
 *
 * Ca được dựng **trực tiếp trong CSDL**: giai đoạn A không được phụ thuộc scanner để kiểm đường đọc,
 * nên hôm nay ba tuyến dưới đây chưa tồn tại và mỗi ca đỏ đúng vì `404` của tuyến (hoặc thiếu trường
 * `meta.scan`), không phải lỗi fixture/import:
 *   - GET /api/v1/overbooking-cases               (MANAGER/OWNER theo scope, api.md §3.9)
 *   - GET /api/v1/overbooking-cases/{caseId}      (`includeCandidates` đủ điểm/nhóm/khoá seq)
 *   - GET /api/v1/overbooking-alerts              (projection tối thiểu cho FRONT_DESK, HB-120 AC12)
 *
 * Bất biến đã pin (xem `detection-helpers/contract.ts`): `affectedBookingIds` = `shortageCount` ứng viên
 * đầu theo BR-OVER-11/12; thang bốn bậc có bậc 3 `feasible=false` kèm lý do; `meta.scan` phân biệt
 * `NEVER/RUNNING/FAILED/SUCCEEDED` nên rỗng thật khác "chưa biết".
 */
import { describe, expect, test } from 'vitest';
import { errorBodySchema } from '@pinehill/contracts';
import {
  ALERTS_ROUTE,
  CASES_ROUTE,
  FORBIDDEN_ALERT_KEYS,
  alertListSchema,
  D,
  TODAY,
  clock,
  cohortOf,
  day,
  dormTypeId,
  errorCode,
  expectLadder,
  expectRankOrder,
  holdLock,
  http,
  listAlerts,
  listCases,
  otherPropertyId,
  otherTypeId,
  propertyId,
  rawCases,
  readCase,
  releaseLock,
  runScan,
  seedCase,
  seedDemand,
  setScope,
  tokenFor,
  typeId,
  vn,
  waitUntil,
  withBlockedCaseInsert,
  withFailingCaseInsert,
} from './detection-helpers/index.js';

const PAST = '2026-11-30';

describe('HB-126 · đường đọc ca quá tải', () => {
  test('HB126_query_role_scope_and_no_leak', async () => {
    const cohort = await cohortOf(D);
    const caseA = await seedCase({
      propertyId,
      date: D,
      roomTypeId: typeId,
      shortageCount: 1,
      detectedAt: new Date(clock.value),
    });
    await seedDemand({
      property: otherPropertyId,
      roomType: otherTypeId,
      start: D,
      end: day(D, 1),
    });
    await seedDemand({
      property: otherPropertyId,
      roomType: otherTypeId,
      start: D,
      end: day(D, 1),
    });
    const caseB = await seedCase({
      propertyId: otherPropertyId,
      date: D,
      roomTypeId: otherTypeId,
      shortageCount: 1,
      status: 'ESCALATED',
      escalatedAt: new Date(clock.value),
    });

    const manager = await tokenFor('MANAGER');
    const page = await listCases(manager, { propertyId });
    expect(page.data.map((item) => item.id)).toEqual([caseA]);
    expect(page.meta.overdueCount).toBe(0);

    // Filter cross-property không được mở quyền đọc ngoài scope.
    const outOfScope = await rawCases(manager, { propertyId: otherPropertyId });
    expect(outOfScope.status).toBe(403);
    expect(errorCode(outOfScope)).toBe('E_AUTH_OUT_OF_SCOPE');
    const foreign = await http()
      .get(`${CASES_ROUTE}/${caseB}`)
      .set('Authorization', `Bearer ${manager}`);
    expect(foreign.status).toBe(403);
    expect(errorCode(foreign)).toBe('E_AUTH_OUT_OF_SCOPE');

    const detail = await readCase(manager, caseA, { includeCandidates: 'true' });
    expect(detail.candidates?.map((candidate) => candidate.bookingId).sort()).toEqual(
      Object.values(cohort).sort(),
    );

    const owner = await tokenFor('OWNER');
    const all = await listCases(owner);
    expect(all.data.map((item) => item.propertyId).sort()).toEqual(
      [propertyId, otherPropertyId].sort(),
    );
    // `overdueCount` cũng theo scope: ca 11-30 của cơ sở B quá hạn, ca 12-10 của A thì chưa.
    expect(all.meta.overdueCount).toBe(1);

    // Lễ tân không đọc case quản lý bằng bất kỳ tuyến nào.
    const front = await tokenFor('FRONT_DESK');
    const denied = await rawCases(front);
    expect(denied.status).toBe(403);
    expect(errorCode(denied)).toBe('E_RBAC_FORBIDDEN');
    const deniedDetail = await http()
      .get(`${CASES_ROUTE}/${caseA}`)
      .set('Authorization', `Bearer ${front}`);
    expect(deniedDetail.status).toBe(403);
    expect(errorCode(deniedDetail)).toBe('E_RBAC_FORBIDDEN');
  });

  test('HB126_contract_filters_preview_and_candidates', async () => {
    const cohort = await cohortOf(D);
    const open = await seedCase({
      propertyId,
      date: D,
      roomTypeId: typeId,
      shortageCount: 1,
      detectedAt: new Date(clock.value),
    });
    const past = await seedCase({
      propertyId,
      date: PAST,
      roomTypeId: typeId,
      shortageCount: 1,
      status: 'ESCALATED',
      escalatedAt: new Date(clock.value),
    });
    const manager = await tokenFor('MANAGER');

    const byStatus = await listCases(manager, { propertyId, status: 'OPEN' });
    expect(byStatus.data.map((item) => item.id)).toEqual([open]);
    const byDate = await listCases(manager, { propertyId, dateFrom: D, dateTo: D });
    expect(byDate.data.map((item) => item.id)).toEqual([open]);
    const byType = await listCases(manager, { propertyId, roomTypeId: dormTypeId });
    expect(byType.data).toEqual([]);
    const overdue = await listCases(manager, { propertyId, overdueOnly: 'true' });
    expect(overdue.data.map((item) => item.id)).toEqual([past]);
    expect(overdue.data[0]?.overdue).toBe(true);

    const first = await listCases(manager, { propertyId, limit: 1 });
    expect(first.data.map((item) => item.id)).toEqual([past]);
    expect(first.meta).toMatchObject({ limit: 1, hasMore: true });
    expect(first.meta.nextCursor).toEqual(expect.any(String));
    const second = await listCases(manager, {
      propertyId,
      limit: 1,
      cursor: first.meta.nextCursor ?? '',
    });
    expect(second.data.map((item) => item.id)).toEqual([open]);
    expect(second.meta.hasMore).toBe(false);

    const tooLarge = await rawCases(manager, { propertyId, limit: 101 });
    expect(tooLarge.status).toBe(400);
    expect(errorBodySchema.parse(tooLarge.body).code).toBe('E_GEN_VALIDATION_FAILED');

    const detail = await readCase(manager, open, { includeCandidates: 'true' });
    expectLadder('detail', detail.ladderPreview);
    expect(detail.ladderPreview[0]).toMatchObject({ feasible: false, candidateCount: 0 });
    expect(detail.ladderPreview[1]?.feasible).toBe(true);
    expect(detail.ladderPreview[1]?.candidateCount ?? 0).toBeGreaterThanOrEqual(1);
    expect(detail.candidates).toHaveLength(3);
    expectRankOrder(detail.candidates ?? []);
    expect(detail.candidates?.[0]).toMatchObject({ bookingId: cohort.weak, priorityGroup: 'WEAK' });
    expect(detail.affectedBookingIds).toEqual([cohort.weak]);

    const plain = await readCase(manager, open);
    expect(plain.candidates ?? []).toEqual([]);
    expectLadder('preview', plain.ladderPreview);
  });

  test('HB126_staff_alert_projection_without_case_privilege', async () => {
    const cohort = await cohortOf(PAST);
    const caseA = await seedCase({
      propertyId,
      date: PAST,
      roomTypeId: typeId,
      shortageCount: 1,
      status: 'ESCALATED',
      escalatedAt: new Date(clock.value),
    });
    await seedDemand({
      property: otherPropertyId,
      roomType: otherTypeId,
      start: PAST,
      end: day(PAST, 1),
    });
    await seedDemand({
      property: otherPropertyId,
      roomType: otherTypeId,
      start: PAST,
      end: day(PAST, 1),
    });
    await seedCase({
      propertyId: otherPropertyId,
      date: PAST,
      roomTypeId: otherTypeId,
      shortageCount: 1,
      status: 'ESCALATED',
      escalatedAt: new Date(clock.value),
    });

    const front = await tokenFor('FRONT_DESK');
    const response = await http()
      .get(ALERTS_ROUTE)
      .query({ propertyId })
      .set('Authorization', `Bearer ${front}`);
    expect(response.status, JSON.stringify(response.body)).toBe(200);
    const body = alertListSchema.parse(response.body);
    // Sự cố ngày đã qua chưa giải quyết vẫn hiện trên bảng cảnh báo của lễ tân.
    expect(body.data.length).toBeGreaterThanOrEqual(1);
    for (const item of body.data) {
      expect(item).toMatchObject({ caseId: caseA, propertyId, date: PAST, status: 'ESCALATED' });
      expect(item.bookingId).toBe(cohort.weak);
      expect(item.deepLink).toContain(item.bookingId);
      expect(item.deepLink).not.toContain('overbooking-cases');
    }
    const raw = JSON.stringify(response.body);
    for (const key of FORBIDDEN_ALERT_KEYS) expect(raw).not.toContain(`"${key}"`);

    // Đổi route không mở quyền case quản lý.
    expect((await rawCases(front, { propertyId })).status).toBe(403);

    await setScope('h029-first', [otherPropertyId]);
    const foreign = await tokenFor('FRONT_DESK');
    const denied = await http()
      .get(ALERTS_ROUTE)
      .query({ propertyId })
      .set('Authorization', `Bearer ${foreign}`);
    expect(denied.status).toBe(403);
    expect(errorCode(denied)).toBe('E_AUTH_OUT_OF_SCOPE');
    const ownScope = await listAlerts(foreign);
    expect(ownScope.data.every((item) => item.propertyId === otherPropertyId)).toBe(true);
  });

  test('HB126_scan_freshness_and_unknown_empty', async () => {
    const manager = await tokenFor('MANAGER');
    const fresh = await listCases(manager, { propertyId });
    expect(fresh.data).toEqual([]);
    // Rỗng khi **chưa quét** phải khác rỗng thật: chưa có mốc thành công nào.
    expect(fresh.meta.scan).toEqual({ status: 'NEVER', lastSuccessAt: null, dataAsOf: null });
    expect(fresh.meta.overdueCount).toBe(0);

    await seedDemand({ start: D, end: day(D, 1) });
    await seedDemand({ start: D, end: day(D, 1) });
    await seedDemand({ start: D, end: day(D, 1) });
    clock.value = vn(TODAY, '09:00:00');
    await runScan([propertyId]);
    const scannedAt = new Date(clock.value).toISOString();
    const succeeded = await listCases(manager, { propertyId });
    expect(succeeded.data).toHaveLength(1);
    expect(succeeded.meta.scan).toEqual({
      status: 'SUCCEEDED',
      lastSuccessAt: scannedAt,
      dataAsOf: scannedAt,
    });

    // Lượt đang chạy: có ca được ghi dở nên `GET` phải thấy RUNNING, không phải SUCCEEDED cũ.
    const runningNight = day(D, 3);
    await seedDemand({ start: runningNight, end: day(runningNight, 1) });
    await seedDemand({ start: runningNight, end: day(runningNight, 1) });
    await seedDemand({ start: runningNight, end: day(runningNight, 1) });
    await holdLock(126001);
    await withBlockedCaseInsert(126001, async () => {
      const inflight = runScan([propertyId]);
      await waitUntil(
        async () => (await listCases(manager, { propertyId })).meta.scan.status === 'RUNNING',
      );
      await releaseLock(126001);
      await inflight;
    });
    expect((await listCases(manager, { propertyId })).meta.scan.status).toBe('SUCCEEDED');

    // Lượt lỗi: mốc thành công cũ và dữ liệu phải nguyên vẹn, không biến thành "0 ca".
    const failedNight = day(D, 4);
    await seedDemand({ start: failedNight, end: day(failedNight, 1) });
    await seedDemand({ start: failedNight, end: day(failedNight, 1) });
    await seedDemand({ start: failedNight, end: day(failedNight, 1) });
    await withFailingCaseInsert(async () => {
      await expect(runScan([propertyId])).rejects.toThrow();
    });
    const afterFailure = await listCases(manager, { propertyId });
    expect(afterFailure.meta.scan).toMatchObject({ status: 'FAILED', lastSuccessAt: scannedAt });
    expect(afterFailure.data.length).toBeGreaterThanOrEqual(1);
  });
});
