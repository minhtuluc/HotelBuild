/** HB-120 AC2/AC5/AC6/AC14: hợp đồng OVER — tuyến, thang 4 bậc, ghép phòng và metadata quét. */
import { describe, expect, it } from 'vitest';
import {
  bookingRelocationOptionsSchema,
  keepScoreBreakdownSchema,
  overbookingAlertSchema,
  overbookingAlertsViewSchema,
  overbookingCaseDetailSchema,
  overbookingCaseListSchema,
  overbookingCaseSummarySchema,
  relocationCandidateSchema,
  relocationLadderSchema,
  relocationPlanSchema,
  roomMergeRequestSchema,
  roomMergeSchema,
  roomMoveCreateRequestSchema,
  roomMoveSchema,
  walkOutEvidenceSchema,
} from '../../src/overbooking.js';
import {
  asObject,
  CANDIDATE,
  CASE_SUMMARY,
  documentJson,
  LADDER,
  MERGE_CONNECTING,
  MERGE_SHARE,
  MOVE,
  operationOf,
  PLAN,
  CASE_CANDIDATE,
  SCAN,
  WALK_OUT,
} from './fixtures.js';

describe('F6 OVER', () => {
  it('over-routes-and-proposal-state', () => {
    const doc = documentJson();
    const routes = [
      ['get', '/api/v1/overbooking-cases'],
      ['get', '/api/v1/overbooking-cases/{caseId}'],
      ['post', '/api/v1/overbooking-cases/{caseId}/relocation-plan'],
      ['post', '/api/v1/overbooking-cases/{caseId}/resolve'],
      ['post', '/api/v1/room-moves'],
      ['post', '/api/v1/room-moves/{roomMoveId}/approve'],
      ['post', '/api/v1/room-moves/{roomMoveId}/execute'],
      ['post', '/api/v1/room-merges'],
      ['post', '/api/v1/room-merges/{roomMergeId}/consent'],
      ['post', '/api/v1/room-merges/{roomMergeId}/approve'],
      ['post', '/api/v1/room-merges/{roomMergeId}/execute'],
    ] as const;
    for (const [method, path] of routes) {
      expect(operationOf(doc, path, method), `${method} ${path}`).toBeDefined();
    }
    // Tạo phương án trả PROPOSED và KHÔNG mô tả là đã gán phòng.
    const plan = relocationPlanSchema.parse(PLAN);
    expect(plan.status).toBe('PROPOSED');
    expect(plan.assignmentsChanged).toBe(false);
    expect(relocationPlanSchema.safeParse({ ...PLAN, status: 'APPROVED' }).success).toBe(false);
    expect(relocationPlanSchema.safeParse({ ...PLAN, assignmentsChanged: true }).success).toBe(
      false,
    );
    const summary = String(
      operationOf(doc, '/api/v1/overbooking-cases/{caseId}/relocation-plan', 'post')?.summary,
    );
    expect(summary).toContain('PROPOSED');
    expect(summary).toContain('chưa gán phòng');
  });

  it('complete-ladder-and-rank-breakdown', () => {
    expect(relocationLadderSchema.parse(LADDER)).toHaveLength(4);
    // Bậc 3 hiện không khả dụng kèm lý do 160–300 km.
    const third = LADDER[2];
    expect(third?.feasible).toBe(false);
    expect(third?.note).toContain('160–300 km');
    expect(
      relocationLadderSchema.safeParse([LADDER[1], LADDER[0], LADDER[2], LADDER[3]]).success,
    ).toBe(false);
    const withoutNote = LADDER.map((step) =>
      step.step === 3 ? { ...step, note: undefined } : step,
    );
    expect(relocationLadderSchema.safeParse(withoutNote).success).toBe(false);

    const candidate = relocationCandidateSchema.parse(CANDIDATE);
    expect(candidate.keepScore.total).toBe(
      candidate.keepScore.loyaltyTier +
        candidate.keepScore.payment +
        candidate.keepScore.nights +
        candidate.keepScore.returningGuest +
        candidate.keepScore.arrived,
    );
    expect(candidate.priorityGroup).toBe('STRONG');
    // `Booking.seq` là bigint → chuỗi thập phân; số sẽ mất chính xác.
    expect(relocationCandidateSchema.safeParse({ ...CANDIDATE, bookingSeq: 1042 }).success).toBe(
      false,
    );
    expect(keepScoreBreakdownSchema.safeParse({ ...CANDIDATE.keepScore, total: 99 }).success).toBe(
      false,
    );
    expect(
      relocationCandidateSchema.safeParse({ ...CANDIDATE, priorityGroup: 'NEUTRAL' }).success,
    ).toBe(false);
  });

  it('move-merge-walkout-and-immutable-price', () => {
    expect(roomMoveSchema.parse(MOVE).priceLocked).toBe(true);
    expect(roomMoveSchema.safeParse({ ...MOVE, priceLocked: false }).success).toBe(false);
    // Không có endpoint sửa price snapshot.
    const doc = documentJson();
    const pathMap = asObject(doc.paths) ?? {};
    const paths = Object.keys(pathMap);
    expect(paths.some((path) => /price/i.test(path))).toBe(false);
    const overPaths = paths.filter(
      (path) => path.startsWith('/api/v1/room-moves') || path.startsWith('/api/v1/room-merges'),
    );
    expect(overPaths.length).toBeGreaterThan(0);
    for (const path of overPaths) {
      for (const method of Object.keys(asObject(pathMap[path]) ?? {})) {
        expect(['get', 'post']).toContain(method);
      }
    }

    expect(roomMergeSchema.parse(MERGE_SHARE).discountAmount).toBe(290_800);
    expect(roomMergeSchema.parse(MERGE_CONNECTING).secondaryBookingId).toBeNull();
    // D01: CONNECTING một booking, hai phòng; body không nhận `secondaryBookingId`/consent.
    const connectingBody = {
      moveType: 'MERGE_CONNECTING',
      bookingId: 'b1',
      roomIdA: 'r1',
      roomIdB: 'r2',
    };
    expect(roomMergeRequestSchema.parse(connectingBody)).toEqual(connectingBody);
    expect(
      roomMergeRequestSchema.safeParse({ ...connectingBody, secondaryBookingId: 'b2' }).success,
    ).toBe(false);
    expect(
      roomMergeRequestSchema.safeParse({ ...connectingBody, consentPrimary: true }).success,
    ).toBe(false);
    expect(roomMergeRequestSchema.safeParse({ ...connectingBody, roomIdB: 'r1' }).success).toBe(
      false,
    );
    expect(
      roomMergeRequestSchema.safeParse({
        moveType: 'MERGE_SHARE',
        primaryBookingId: 'b1',
        secondaryBookingId: 'b1',
        roomId: 'r9',
      }).success,
    ).toBe(false);

    // Walk-out phải có chứng từ/chữ ký và tham chiếu hồ sơ F5 khi đã thực thi.
    expect(walkOutEvidenceSchema.parse(WALK_OUT).refundRequestId).toBe('rr1');
    const executed = {
      ...MOVE,
      moveType: 'WALK_OUT',
      toRoomId: null,
      status: 'EXECUTED',
      walkOut: WALK_OUT,
    };
    expect(roomMoveSchema.parse(executed).walkOut?.walkOutDocNo).toBe('WO-2026-0001');
    expect(roomMoveSchema.safeParse({ ...executed, walkOut: null }).success).toBe(false);
    expect(
      roomMoveCreateRequestSchema.safeParse({ ...MOVE, moveType: 'MERGE_SHARE' }).success,
    ).toBe(false);
  });

  it('scan_freshness_metadata', () => {
    const list = overbookingCaseListSchema.parse({
      data: [CASE_SUMMARY],
      meta: { limit: 20, nextCursor: null, hasMore: false, overdueCount: 1, scan: SCAN },
    });
    expect(list.meta.scan.status).toBe('SUCCEEDED');
    expect(list.meta.scan.lastSuccessAt).toBe('2026-12-01T01:00:00Z');
    // Rỗng thật vs chưa từng quét: `NEVER` + null phải parse được và khác `SUCCEEDED`.
    const never = overbookingCaseListSchema.parse({
      data: [],
      meta: {
        limit: 20,
        nextCursor: null,
        hasMore: false,
        overdueCount: 0,
        scan: { status: 'NEVER', lastSuccessAt: null, dataAsOf: null },
      },
    });
    expect(never.data).toHaveLength(0);
    expect(never.meta.scan.status).not.toBe(list.meta.scan.status);
    // Hình dạng cũ (HB-120 bản đầu) không còn được nhận: server trả `status/lastSuccessAt/dataAsOf`.
    expect(
      overbookingCaseListSchema.safeParse({
        data: [],
        meta: {
          limit: 20,
          nextCursor: null,
          hasMore: false,
          overdueCount: 0,
          scan: {
            scanStatus: 'OK',
            lastSuccessfulScanAt: null,
            nextScanAt: null,
            scannedThrough: null,
          },
        },
      }).success,
    ).toBe(false);
    expect(
      overbookingCaseListSchema.safeParse({
        data: [],
        meta: { limit: 20, nextCursor: null, hasMore: false, overdueCount: 0 },
      }).success,
    ).toBe(false);

    const detail = overbookingCaseDetailSchema.parse({
      ...CASE_SUMMARY,
      candidates: [CASE_CANDIDATE],
      history: [{ at: '2026-12-01T01:00:00Z', action: 'DETECTED', actorId: null, note: null }],
    });
    expect(detail.history).toHaveLength(1);
    expect(detail.candidates[0]?.keepScore).toBe(24);
    // Ứng viên dạng planner (`keepScore` là bảng phân rã) không phải dạng chi tiết ca.
    expect(
      overbookingCaseDetailSchema.safeParse({
        ...CASE_SUMMARY,
        candidates: [CANDIDATE],
        history: [],
      }).success,
    ).toBe(false);
    expect(overbookingCaseSummarySchema.parse(CASE_SUMMARY).shortageCount).toBe(2);

    const alert = overbookingAlertSchema.parse({
      caseId: 'c1',
      bookingId: 'b1',
      propertyId: 'p1',
      roomTypeId: 'rt1',
      date: '2026-12-25',
      status: 'OPEN',
      overdue: true,
      label: 'Thiếu 2 phòng ngày 2026-12-25',
      deepLink: '/bookings/b1?overbookingCaseId=c1',
    });
    // Projection lễ tân là strict (HB-126/HB-221): không nhận khoá thừa như rank/keepScore/tên khách.
    expect(overbookingAlertSchema.safeParse({ ...alert, keepScore: 1 }).success).toBe(false);
    expect(alert).not.toHaveProperty('keepScore');
    expect(
      overbookingAlertsViewSchema.parse({
        data: [alert],
        meta: { limit: 20, nextCursor: null, hasMore: false, scan: SCAN },
      }).meta.scan.status,
    ).toBe('SUCCEEDED');
    expect(
      bookingRelocationOptionsSchema.parse({
        bookingId: 'b1',
        overbookingCaseId: 'c1',
        date: '2026-12-25',
        options: [],
        generatedAt: '2026-12-01T02:00:00Z',
        writeIntent: null,
      }).bookingId,
    ).toBe('b1');
  });
});
