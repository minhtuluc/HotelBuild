/**
 * HB-097 — cổng chặn biên: hạn mức hoàn (BR-CANCEL-17), bất khả kháng (BR-CANCEL-13), kênh OTA
 * (BR-CHAN-04), phí xử lý hoàn (BR-CANCEL-05,11), phạm vi cơ sở và ánh xạ mã lỗi api.md §3.3.
 */
import { randomUUID } from 'node:crypto';
import { describe, expect, test } from 'vitest';
import { cancelPreviewSchema, cancelResponseSchema, userRoleSchema } from '@pinehill/contracts';
import { cancelPermissionRules } from '../../src/modules/book/cancel/permissions.js';
import {
  anchoredCancel,
  auditCount,
  booking,
  bookingRow,
  cancel,
  errorCode,
  guestCancel,
  heldAmount,
  login,
  pay,
  preview,
  refundRequests,
  rows,
  setFee,
  userId,
} from './fixture.js';

const fmBody = { reason: 'FORCE_MAJEURE', isForceMajeure: true };
const fmNote = 'Bão lớn tại khu vực, khách không thể tới';
const otaBody = { reason: 'OTA_CANCELLATION', isForceMajeure: false };

describe('HB-097 cổng chặn huỷ', () => {
  test('BR-CANCEL-17: hạn mức hoàn đang giữ của sự kiện khác ⇒ 422 và rollback toàn bộ', async () => {
    const token = await login('FRONT_DESK');
    const held = await booking({ price: 300_000 });
    const payment = await pay(held.id, 300_000n);
    const request = String(
      (
        await rows(
          `INSERT INTO refund_requests(booking_id,event_key,policy_id,hours_before_check_in,refund_percent,
              requested_amount,refund_fee,reason,requester_type,requester_id)
           SELECT $1,'late-payment',cancellation_policy_id,100,100,300000,0,'PAYMENT_TIMEOUT','SYSTEM','scheduler'
             FROM rate_plans WHERE code='FLEX7' RETURNING id`,
          [held.id],
        )
      )[0]!.id,
    );
    // Tiền phòng đã được dành cho khoản hoàn riêng (thu muộn) ⇒ nguồn thu không còn khả dụng,
    // nhưng sổ vẫn nhất quán: `refunded + reserved ≤ paid` nên xem trước đọc được.
    await rows(
      `UPDATE payment_allocations SET released_amount = amount, release_reason = 'late payment refund'
        WHERE payment_id = $1::uuid`,
      [payment],
    );
    await rows(
      'INSERT INTO refund_allocations(refund_request_id,original_payment_id,amount) VALUES($1::uuid,$2::uuid,300000)',
      [request, payment],
    );
    const before = await bookingRow(held.id);
    const blocked = await anchoredCancel(token, held.id, guestCancel);
    expect(blocked.status).toBe(422);
    expect(errorCode(blocked.body)).toBe('E_PAY_REFUND_EXCEEDS_PAID');
    expect(await bookingRow(held.id)).toEqual(before);
    expect(await refundRequests(held.id)).toHaveLength(1);
    expect(await auditCount(held.id, 'BOOKING_CANCELLED')).toBe(0);
    expect(await rows('SELECT released_at FROM room_assignments')).toEqual([]);
  });

  test('BR-CANCEL-13: xem trước bất khả kháng chạy được cho mọi vai trò; lệnh huỷ mới chặn quyền và lý do ngắn', async () => {
    const front = await login('FRONT_DESK');
    const forced = await booking({ nights: 3, price: 100_000 });
    await pay(forced.id, 5_001n);

    const frontPreview = await preview(front, forced.id, fmBody);
    expect(frontPreview.status).toBe(200);
    expect(cancelPreviewSchema.parse(frontPreview.body)).toMatchObject({
      warnings: ['FORCE_MAJEURE_REQUIRES_MANAGER'],
    });
    // 403 thắng neo: kiểm quyền bất khả kháng chạy trước khi kiểm neo.
    const denied = await cancel(
      front,
      forced.id,
      { ...fmBody, note: fmNote },
      { tag: frontPreview.headers.etag! },
    );
    expect(denied.status).toBe(403);
    expect(errorCode(denied.body)).toBe('E_PAY_REFUND_FORCE_MAJEURE_FORBIDDEN');

    const manager = await login('MANAGER');
    // Fix 5: MANAGER/OWNER **xem trước được** yêu cầu bất khả kháng (không cần `note`).
    const managerPreview = await preview(manager, forced.id, fmBody);
    expect(managerPreview.status).toBe(200);
    expect(cancelPreviewSchema.parse(managerPreview.body)).toMatchObject({
      warnings: [],
      cancellation: { refundPercent: 100, requestedAmount: 5_001, penaltyAmount: 0, refundFee: 0 },
    });
    const short = await cancel(manager, forced.id, { ...fmBody, note: 'Bão' });
    expect(short.status).toBe(400);
    expect(errorCode(short.body)).toBe('E_PAY_REASON_TOO_SHORT');
    const noAnchor = await cancel(manager, forced.id, { ...fmBody, note: fmNote });
    expect(noAnchor.status).toBe(428);

    await setFee(1_000);
    const accepted = await cancel(
      manager,
      forced.id,
      { ...fmBody, note: fmNote, evidenceRefs: ['ev-1'] },
      {
        tag: managerPreview.headers.etag!,
      },
    );
    expect(accepted.status).toBe(200);
    expect(cancelResponseSchema.parse(accepted.body).cancellation).toMatchObject({
      requestedAmount: 5_001,
      penaltyAmount: 0,
      refundFee: 0,
    });
    expect(await refundRequests(forced.id)).toEqual([
      expect.objectContaining({
        is_force_majeure: true,
        refund_fee: '0',
        requested_amount: '5001',
        evidence_refs: ['ev-1'],
        reason: 'FORCE_MAJEURE',
      }),
    ]);
  });

  test('BR-CHAN-04: lý do OTA chỉ bỏ hoàn nội bộ khi booking đến từ kênh OTA đã xác minh', async () => {
    const token = await login('FRONT_DESK');
    const web = await booking({ price: 300_000 });
    await pay(web.id, 300_000n);
    const webPreview = await preview(token, web.id, otaBody);
    expect(webPreview.status).toBe(200);
    expect(cancelPreviewSchema.parse(webPreview.body).warnings).toEqual([
      'OTA_REASON_REQUIRES_OTA_CHANNEL',
    ]);
    const rejected = await cancel(token, web.id, otaBody, { tag: webPreview.headers.etag! });
    expect(rejected.status).toBe(409);
    expect(errorCode(rejected.body)).toBe('E_CANCEL_NOT_ALLOWED');
    // Không im lặng bỏ khoản hoàn: booking giữ nguyên, không có yêu cầu hoàn nào được tạo.
    expect(await bookingRow(web.id)).toMatchObject({ status: 'CONFIRMED', paid_amount: '300000' });
    expect(await refundRequests(web.id)).toEqual([]);

    const ota = await booking({
      price: 300_000,
      channel: 'OTA_AGODA',
      channelPolicyCode: 'AGD-2026-POL',
    });
    await pay(ota.id, 300_000n);
    const otaPreview = await preview(token, ota.id, otaBody);
    expect(otaPreview.status).toBe(200);
    expect(cancelPreviewSchema.parse(otaPreview.body).warnings).toEqual([]);
    const cancelled = await cancel(token, ota.id, otaBody, { tag: otaPreview.headers.etag! });
    expect(cancelled.status).toBe(200);
    const result = cancelResponseSchema.parse(cancelled.body);
    expect(result).toMatchObject({ status: 'CANCELLED', cancelReason: 'OTA_CANCELLATION' });
    expect(result.refundRequest).toBeNull();
    expect(await refundRequests(ota.id)).toEqual([]);
    expect(await bookingRow(ota.id)).toMatchObject({
      status: 'CANCELLED',
      cancel_reason: 'OTA_CANCELLATION',
    });
    expect(await auditCount(ota.id, 'LEDGER_REFUND_RESERVED')).toBe(0);
  });

  test('phí hoàn trừ vào hạn mức giữ; OWNER không cần hàng scope; trạng thái/thân lệnh/phạm vi đúng mã', async () => {
    const token = await login('FRONT_DESK');
    await setFee(1_000);
    const fee = await booking({ price: 500_000 });
    await pay(fee.id, 500_000n);
    const feePreview = await preview(token, fee.id);
    expect(cancelPreviewSchema.parse(feePreview.body).cancellation).toMatchObject({
      requestedAmount: 500_000,
      refundFee: 1_000,
    });
    const withFee = await cancel(token, fee.id, guestCancel, { tag: feePreview.headers.etag! });
    expect(withFee.status).toBe(200);
    expect(await refundRequests(fee.id)).toEqual([
      expect.objectContaining({
        requested_amount: '500000',
        refund_fee: '1000',
        net_refund: '499000',
      }),
    ]);
    expect(await heldAmount(fee.id)).toBe('499000');

    // Trạng thái kiểm trước neo: thiếu `If-Match` vẫn nhận 409 (không phải 428).
    const checkedIn = await booking({ status: 'CHECKED_IN' });
    const invalidState = await cancel(token, checkedIn.id, guestCancel);
    expect(invalidState.status).toBe(409);
    expect(errorCode(invalidState.body)).toBe('E_CANCEL_NOT_ALLOWED');

    const wrongBody = await cancel(token, checkedIn.id, { reason: 'GUEST_REQUEST' });
    expect(wrongBody.status).toBe(400);
    expect(errorCode(wrongBody.body)).toBe('E_GEN_VALIDATION_FAILED');
    expect((await preview(token, checkedIn.id, { reason: 'GUEST_REQUEST' })).status).toBe(400);

    const anchor = `"1.${'0'.repeat(16)}"`;
    const unknown = await cancel(token, randomUUID(), guestCancel, { tag: anchor });
    expect(unknown.status).toBe(404);
    expect(errorCode(unknown.body)).toBe('E_GEN_NOT_FOUND');

    // Vai trò nghiệp vụ không có hàng scope của cơ sở ⇒ 403 (BR-RBAC-02).
    const outside = await booking();
    await rows('DELETE FROM user_property_scopes WHERE user_id=$1::uuid', [userId]);
    const scoped = await cancel(token, outside.id, guestCancel, { tag: anchor });
    expect(scoped.status).toBe(403);
    expect(errorCode(scoped.body)).toBe('E_AUTH_OUT_OF_SCOPE');

    // Fix 6: OWNER có phạm vi toàn chuỗi — không cần hàng `user_property_scopes`.
    const owner = await booking();
    await pay(owner.id, 500_000n);
    const ownerToken = await login('OWNER');
    expect((await anchoredCancel(ownerToken, owner.id, guestCancel)).status).toBe(200);
  });

  test('fix 1: map quyền của module chỉ khai vai trò người dùng hợp lệ; GUEST chờ phiên khách (HB-017)', () => {
    const declared = Object.values(cancelPermissionRules).flat();
    expect(declared.length).toBeGreaterThan(0);
    for (const role of declared) expect(userRoleSchema.safeParse(role).success).toBe(true);
    // `PermissionRegistry.onModuleInit` từ chối mọi vai trò ngoài `userRoleSchema` ngay khi khởi động,
    // nên khai `GUEST` ở đây sẽ làm sập ứng dụng; đường khách tự huỷ phải mở ở HB-017 (phiên khách).
    expect(userRoleSchema.safeParse('GUEST').success).toBe(false);
    expect(declared).not.toContain('GUEST');
    expect([...new Set(declared)].sort()).toEqual([
      'FRONT_DESK',
      'MANAGER',
      'OWNER',
      'RESERVATION_AGENT',
    ]);
  });
});
