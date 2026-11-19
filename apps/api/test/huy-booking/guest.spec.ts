/**
 * HB-256 — khách tự xem trước và huỷ booking của mình (api.md §2.5 vai trò tối thiểu `GUEST`, UC-BOOK-08).
 * Trước đây hai tuyến chỉ nhận phiên nhân viên nên app khách (web, Android) luôn nhận `403 E_RBAC_FORBIDDEN`.
 */
import { describe, expect, test } from 'vitest';
import { cancelPreviewSchema, cancelResponseSchema } from '@pinehill/contracts';
import {
  anchoredCancel,
  booking,
  bookingGuest,
  bookingRow,
  cancel,
  errorCode,
  guestCancel,
  guestToken,
  heldAmount,
  http,
  login,
  otherGuest,
  pay,
  preview,
  refundRequests,
  rows,
} from './fixture.js';

describe('HB-256: khách tự huỷ', () => {
  test('chủ booking xem trước rồi huỷ: yêu cầu hoàn đứng tên khách, audit vai trò GUEST', async () => {
    const target = await booking();
    await pay(target.id, 500_000n);
    const token = await guestToken(await bookingGuest(target.id));

    const previewed = await preview(token, target.id);
    expect(previewed.status, JSON.stringify(previewed.body)).toBe(200);
    expect(cancelPreviewSchema.parse(previewed.body).cancellation.requestedAmount).toBeGreaterThan(
      0,
    );

    const cancelled = await anchoredCancel(token, target.id, guestCancel);
    expect(cancelled.status, JSON.stringify(cancelled.body)).toBe(200);
    expect(cancelResponseSchema.parse(cancelled.body).status).toBe('CANCELLED');
    expect((await bookingRow(target.id)).status).toBe('CANCELLED');

    const [request] = await refundRequests(target.id);
    expect(request).toMatchObject({
      requester_type: 'GUEST',
      requester_id: await bookingGuest(target.id),
      requested_by: null,
      status: 'PENDING',
    });
    expect(BigInt(String(await heldAmount(target.id)))).toBeGreaterThan(0n);
    expect(
      await rows(
        "SELECT actor_id,actor_role FROM audit_logs WHERE entity_id=$1 AND action='BOOKING_CANCELLED'",
        [target.id],
      ),
    ).toEqual([{ actor_id: null, actor_role: 'GUEST' }]);
  });

  test('khách khác bị che 404; không bearer 401; nhân viên vẫn huỷ được như trước', async () => {
    const target = await booking();
    await pay(target.id, 500_000n);
    const stranger = await guestToken(await otherGuest());
    const hidden = await preview(stranger, target.id);
    expect(hidden.status).toBe(404);
    expect(errorCode(hidden.body)).toBe('E_GEN_NOT_FOUND');
    expect((await cancel(stranger, target.id, guestCancel, { tag: 'W/"x"' })).status).toBe(404);
    expect(
      (await http().post(`/api/v1/bookings/${target.id}/cancel-preview`).send(guestCancel)).status,
    ).toBe(401);
    expect((await bookingRow(target.id)).status).toBe('CONFIRMED');

    const staff = await login('FRONT_DESK');
    expect((await anchoredCancel(staff, target.id, guestCancel)).status).toBe(200);
  });

  test('khách không tự tạo huỷ bất khả kháng (BR-CANCEL-13): xem trước có cảnh báo, lệnh huỷ 403', async () => {
    const target = await booking();
    await pay(target.id, 500_000n);
    const token = await guestToken(await bookingGuest(target.id));
    const force = { reason: 'FORCE_MAJEURE', isForceMajeure: true };
    const previewed = await preview(token, target.id, force);
    expect(previewed.status).toBe(200);
    expect(cancelPreviewSchema.parse(previewed.body).warnings).toContain(
      'FORCE_MAJEURE_REQUIRES_MANAGER',
    );
    const refused = await cancel(
      token,
      target.id,
      { ...force, note: 'Bão lớn, sân bay đóng cửa toàn bộ chuyến bay' },
      { tag: previewed.headers.etag! },
    );
    expect(refused.status).toBe(403);
    expect((await bookingRow(target.id)).status).toBe('CONFIRMED');
  });

  test('khách huỷ trong bậc phạt: ghi công nợ PENALTY, không tạo phiếu thu tiền mặt đứng tên ai', async () => {
    const soon = await booking({ checkIn: '2026-10-09', nights: 1, price: 1_000_000 });
    await pay(soon.id, 200_000n);
    const token = await guestToken(await bookingGuest(soon.id));
    const cancelled = await anchoredCancel(token, soon.id, guestCancel);
    expect(cancelled.status, JSON.stringify(cancelled.body)).toBe(200);
    expect(await bookingRow(soon.id)).toMatchObject({
      status: 'CANCELLED',
      penalty_amount: '800000',
      balance_due: '800000',
    });
    expect(
      await rows("SELECT kind,amount FROM booking_charges WHERE booking_id=$1 AND kind='PENALTY'", [
        soon.id,
      ]),
    ).toEqual([{ kind: 'PENALTY', amount: '800000' }]);
    // Phiếu `CASH` PENDING bắt buộc có nhân viên lập (`ck_payments_cash_shift`); quầy thu sau theo nghĩa vụ.
    expect(
      await rows("SELECT 1 FROM payments WHERE booking_id=$1 AND type='PENALTY'", [soon.id]),
    ).toEqual([]);
  });
});

describe('HB-256: tuyến @Public vẫn giữ mọi chặn của AuthGuard cho nhân viên', () => {
  test('nhân viên đang buộc đổi mật khẩu tạm không xem trước/huỷ được (E_AUTH_PASSWORD_CHANGE_REQUIRED)', async () => {
    const target = await booking();
    await pay(target.id, 500_000n);
    const staff = await login('FRONT_DESK');
    await rows("UPDATE users SET must_change_password=true WHERE username='h029-first'");
    try {
      const blocked = await preview(staff, target.id);
      expect(blocked.status).toBe(403);
      expect(errorCode(blocked.body)).toBe('E_AUTH_PASSWORD_CHANGE_REQUIRED');
      expect((await cancel(staff, target.id, guestCancel, { tag: 'W/"x"' })).status).toBe(403);
      expect((await bookingRow(target.id)).status).toBe('CONFIRMED');
    } finally {
      await rows("UPDATE users SET must_change_password=false WHERE username='h029-first'");
    }
  });
});
