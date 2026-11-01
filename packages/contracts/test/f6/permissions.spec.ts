/** HB-120 AC9/AC12/AC13: permission fail-closed, projection che PII và chi bồi thường chỉ ACCOUNTANT. */
import { describe, expect, it } from 'vitest';
import {
  bookingRelocationOptionsSchema,
  compensationPaymentCreateRequestSchema,
  compensationPaymentSchema,
  compensationPaymentsViewSchema,
  overbookingAlertSchema,
  relocationOptionSchema,
  writeIntentQuerySchema,
} from '../../src/overbooking.js';
import {
  F6_SERVICE_PRINCIPAL,
  f6RoutePermissions,
  permissionsFor,
} from '../../src/openapi/paths/f6.js';
import {
  asObject,
  COMPENSATION,
  documentJson,
  IDEMPOTENCY_UUID,
  MOVE_VIEW,
  operationOf,
  parameterNames,
  permissionEntry,
  permissionsOf,
  WRITE_INTENT,
} from './fixtures.js';

const METHODS = ['get', 'post', 'put', 'patch', 'delete'] as const;
const F6_PREFIXES = [
  '/api/v1/channels/',
  '/api/v1/overbooking-',
  '/api/v1/room-moves',
  '/api/v1/room-merges',
  '/api/v1/integrations/ota/',
  '/api/v1/bookings/{bookingId}/relocation-options',
];

describe('F6 permissions', () => {
  it('all-f6-routes-fail-closed', () => {
    const doc = documentJson();
    for (const entry of f6RoutePermissions) {
      const op = operationOf(doc, entry.path, entry.method);
      expect(op, `${entry.method} ${entry.path}`).toBeDefined();
      expect(permissionsOf(op)).toEqual([...entry.roles]);
    }
    // Mọi operation F6 đã công bố phải có tập permission không rỗng; thiếu là fail closed.
    const paths = asObject(doc.paths) ?? {};
    for (const [path, item] of Object.entries(paths)) {
      // `/api/v1/channels/{channelId}` (GET/PATCH) đã phát hành ở F3, không thuộc F6.
      if (path === '/api/v1/channels/{channelId}') continue;
      if (!F6_PREFIXES.some((prefix) => path.startsWith(prefix))) continue;
      for (const method of METHODS) {
        const op = asObject(asObject(item)?.[method]);
        if (op === undefined) continue;
        expect(permissionsOf(op).length, `${method} ${path}`).toBeGreaterThan(0);
        expect(permissionEntry(f6RoutePermissions, path, method)).toEqual(permissionsOf(op));
      }
    }
    // Tài khoản kỹ thuật không mặc nhiên xem nghiệp vụ; route simulator tách principal riêng.
    for (const entry of f6RoutePermissions) expect(entry.roles).not.toContain('SYSADMIN');
    expect(
      permissionEntry(f6RoutePermissions, '/api/v1/integrations/ota/{channel}/bookings', 'post'),
    ).toEqual([F6_SERVICE_PRINCIPAL]);
    expect(() => permissionsFor('get', '/api/v1/khong-ton-tai')).toThrow();
  });

  it('booking_projection_move_merge_read_and_scope', () => {
    const doc = documentJson();
    expect(permissionsOf(operationOf(doc, '/api/v1/room-moves/{roomMoveId}', 'get'))).toEqual([
      'FRONT_DESK',
      'MANAGER',
      'OWNER',
    ]);
    expect(permissionsOf(operationOf(doc, '/api/v1/room-merges/{roomMergeId}', 'get'))).toEqual([
      'FRONT_DESK',
      'MANAGER',
      'OWNER',
    ]);
    // Lễ tân chỉ đọc phương án/alerts của booking cần xử lý, không đọc case + bảng keepScore.
    expect(
      permissionsOf(operationOf(doc, '/api/v1/bookings/{bookingId}/relocation-options', 'get')),
    ).toEqual(['FRONT_DESK']);
    expect(permissionsOf(operationOf(doc, '/api/v1/overbooking-alerts', 'get'))).toEqual([
      'FRONT_DESK',
    ]);
    expect(permissionsOf(operationOf(doc, '/api/v1/overbooking-cases', 'get'))).not.toContain(
      'FRONT_DESK',
    );
    // Projection không có bảng xếp hạng/PII booking khác.
    const options = bookingRelocationOptionsSchema.parse({
      bookingId: 'b1',
      overbookingCaseId: 'c1',
      date: '2026-12-25',
      options: [],
      generatedAt: '2026-12-01T02:00:00Z',
      writeIntent: null,
      keepScore: 14,
    });
    expect(options).not.toHaveProperty('keepScore');
    expect(Object.keys(relocationOptionSchema.shape)).not.toContain('bookingId');
    expect(Object.keys(overbookingAlertSchema.shape)).not.toContain('keepScore');

    // Tra ý định ghi theo quyền hiện tại để không tạo key mới khi timeout chưa rõ kết quả.
    expect(writeIntentQuerySchema.parse({ idempotencyKey: IDEMPOTENCY_UUID }).idempotencyKey).toBe(
      IDEMPOTENCY_UUID,
    );
    expect(writeIntentQuerySchema.safeParse({ idempotencyKey: 'not-a-uuid' }).success).toBe(false);
    expect(parameterNames(operationOf(doc, '/api/v1/room-moves/{roomMoveId}', 'get'))).toContain(
      'idempotencyKey',
    );
    expect(parameterNames(operationOf(doc, '/api/v1/room-merges/{roomMergeId}', 'get'))).toContain(
      'idempotencyKey',
    );
    expect(MOVE_VIEW.writeIntent).toEqual(WRITE_INTENT);
  });

  it('compensation_accountant_only_and_approved_amount', () => {
    const doc = documentJson();
    const postPath = '/api/v1/room-moves/{roomMoveId}/compensation-payments';
    expect(permissionsOf(operationOf(doc, postPath, 'post'))).toEqual(['ACCOUNTANT']);
    expect(permissionsOf(operationOf(doc, postPath, 'get'))).toEqual([
      'ACCOUNTANT',
      'MANAGER',
      'OWNER',
    ]);
    // MANAGER/OWNER đọc chứng từ nhưng không được chi.
    expect(permissionsOf(operationOf(doc, postPath, 'get'))).not.toContain('FRONT_DESK');
    // Hợp đồng riêng: không dùng /refund-requests/{id}/pay cho COMPENSATION.
    expect(Object.keys(asObject(doc.paths) ?? {})).toContain(postPath);
    expect(Object.keys(asObject(doc.paths) ?? {})).not.toContain(
      '/api/v1/refund-requests/{refundRequestId}/compensation-payments',
    );
    // Request có Idempotency-Key/If-Match/PIN, không có `amount`.
    const post = operationOf(doc, postPath, 'post');
    expect(parameterNames(post)).toEqual(expect.arrayContaining(['Idempotency-Key', 'If-Match']));
    expect(Object.keys(compensationPaymentCreateRequestSchema.shape)).not.toContain('amount');
    expect(Object.keys(compensationPaymentCreateRequestSchema.shape)).toContain('pinToken');

    const pending = compensationPaymentSchema.parse(COMPENSATION);
    expect(pending.type).toBe('COMPENSATION');
    expect(pending.state).toBe('PENDING');
    expect(pending.operationId).toBe('op-comp-1');
    const succeeded = compensationPaymentSchema.parse({
      ...COMPENSATION,
      state: 'SUCCEEDED',
      paymentStatus: 'SUCCEEDED',
      paidAt: '2026-12-01T07:20:00Z',
    });
    expect(succeeded.state).not.toBe(pending.state);
    expect(compensationPaymentSchema.parse({ ...COMPENSATION, state: 'UNKNOWN' }).state).toBe(
      'UNKNOWN',
    );
    expect(
      compensationPaymentsViewSchema.parse({
        roomMoveId: 'm1',
        approvedAmount: 1_500_000,
        payments: [COMPENSATION],
      }).approvedAmount,
    ).toBe(1_500_000);
  });
});
