/** HB-120 AC7: mã lỗi CHAN/OVER đúng HTTP §4.2 và ca quá hạn vẫn cho xử lý sự cố. */
import { describe, expect, it } from 'vitest';
import { errorCatalogue } from '../../src/errors.js';
import {
  overbookingResolveResponseSchema,
  overbookingCaseSummarySchema,
  relocationPlanSchema,
  roomMoveSchema,
} from '../../src/overbooking.js';
import { asObject, CASE_SUMMARY, documentJson, MOVE, operationOf, PLAN } from './fixtures.js';

describe('F6 errors', () => {
  it('error-status-and-late-resolution', () => {
    // Mã CHAN (api.md §4.2).
    expect(errorCatalogue.E_CHAN_SIGNATURE_INVALID.httpStatus).toBe(401);
    expect(errorCatalogue.E_CHAN_REPLAY_DETECTED.httpStatus).toBe(409);
    expect(errorCatalogue.E_CHAN_SYNC_FAILED.httpStatus).toBe(502);
    // Mã OVER.
    expect(errorCatalogue.E_OVER_NO_CONSENT.httpStatus).toBe(409);
    expect(errorCatalogue.E_OVER_MERGE_GENDER.httpStatus).toBe(409);
    expect(errorCatalogue.E_OVER_APPROVAL_REQUIRED.httpStatus).toBe(403);
    expect(errorCatalogue.E_OVER_NO_PLAN_AVAILABLE.httpStatus).toBe(409);
    expect(errorCatalogue.E_OVER_MOVE_NOT_ALLOWED.httpStatus).toBe(409);
    expect(errorCatalogue.E_OVER_CROSS_CITY_NO_CONSENT.httpStatus).toBe(409);
    expect(errorCatalogue.E_OVER_CASE_DEADLINE_PASSED.httpStatus).toBe(409);
    // Tồn/version/quyền/PIN dùng lại mã đã có, không tạo mã mới.
    expect(errorCatalogue.E_INV_ROOM_TAKEN.httpStatus).toBe(409);
    expect(errorCatalogue.E_GEN_VERSION_CONFLICT.httpStatus).toBe(412);
    expect(errorCatalogue.E_GEN_PRECONDITION_REQUIRED.httpStatus).toBe(428);
    expect(errorCatalogue.E_RBAC_FORBIDDEN.httpStatus).toBe(403);
    expect(errorCatalogue.E_AUTH_PIN_REQUIRED.httpStatus).toBe(401);

    // Quá hạn KHÔNG cấm luồng xử lý sự cố sau leo thang (BR-OVER-16).
    const escalated = overbookingCaseSummarySchema.parse({
      ...CASE_SUMMARY,
      status: 'ESCALATED',
      escalatedAt: '2026-12-24T07:00:00Z',
      overdue: true,
    });
    expect(escalated.overdue).toBe(true);
    const plan = relocationPlanSchema.parse({ ...PLAN, status: 'PROPOSED', overdue: true });
    expect(plan.overdue).toBe(true);
    const resolved = overbookingResolveResponseSchema.parse({
      caseId: 'c1',
      status: 'RESOLVED',
      resolutionSource: 'USER',
      resolvedBy: 'u1',
      resolvedAt: '2026-12-25T09:00:00Z',
      resolutionNote: 'Khách đã tới, điều chuyển tại chỗ theo bậc 2',
      auditLogId: 'a1',
    });
    expect(resolved.status).toBe('RESOLVED');
    // `resolvedBy` null chỉ khi SYSTEM; USER thiếu người xử lý bị từ chối.
    expect(
      overbookingResolveResponseSchema.safeParse({ ...resolved, resolvedBy: null }).success,
    ).toBe(false);
    expect(
      overbookingResolveResponseSchema.parse({
        ...resolved,
        resolutionSource: 'SYSTEM',
        resolvedBy: null,
      }).resolvedBy,
    ).toBeNull();

    const execute = operationOf(documentJson(), '/api/v1/room-moves/{roomMoveId}/execute', 'post');
    const codes = Object.keys(asObject(execute?.responses) ?? {});
    expect(codes).toEqual(expect.arrayContaining(['200', '403', '409', '412', '428']));
    // Execute không bị chặn bởi deadline: không khai E_OVER_CASE_DEADLINE_PASSED như lỗi bắt buộc.
    expect(JSON.stringify(execute)).not.toContain('E_OVER_CASE_DEADLINE_PASSED');
    expect(roomMoveSchema.parse({ ...MOVE, status: 'EXECUTED' }).status).toBe('EXECUTED');
  });
});
