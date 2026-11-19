/**
 * HB-258 — khách tự đổi ngày booking của mình (api.md §2.5 vai trò tối thiểu `GUEST`, UC-BOOK-06).
 * Trước đây tuyến chỉ nhận phiên nhân viên nên app khách nhận `403 E_RBAC_FORBIDDEN`.
 */
import { describe, expect, test } from 'vitest';
import { bookingSummarySchema } from '@pinehill/contracts';
import {
  auditOf,
  createBooking,
  deleteRequest,
  errorCode,
  guestTokenOf,
  issueQuote,
  login,
  rescheduleRequest,
  rows,
  shifted,
  versionOf,
} from './fixture.js';

describe('HB-258: khách tự đổi ngày', () => {
  test('chủ booking đổi ngày bằng báo giá của chính mình; audit vai trò GUEST', async () => {
    const { booking } = await createBooking({}, { token: await login() });
    const guest = await guestTokenOf(booking.id);
    const quote = await issueQuote(shifted, guest);
    const moved = await rescheduleRequest(
      guest,
      booking.id,
      { ...shifted, quoteId: quote.quoteId },
      { tag: `"${await versionOf(guest, booking.id)}"` },
    );
    expect(moved.status, JSON.stringify(moved.body)).toBe(200);
    expect(bookingSummarySchema.parse(moved.body)).toMatchObject({
      checkIn: shifted.checkIn,
      checkOut: shifted.checkOut,
      rescheduleCount: 1,
    });
    const audit = (await auditOf(booking.id)).filter((row) => row.action === 'BOOKING_RESCHEDULED');
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({ actor_id: null, actor_role: 'GUEST' });
  });

  test('khách khác bị che 404; khách không xoá cứng được (tuyến nhân viên)', async () => {
    const { booking } = await createBooking({}, { token: await login() });
    const { booking: other } = await createBooking({}, { token: await login() });
    const stranger = await guestTokenOf(other.id);
    const hidden = await rescheduleRequest(stranger, booking.id, shifted, { tag: '"1"' });
    expect(hidden.status).toBe(404);
    expect(errorCode(hidden.body)).toBe('E_GEN_NOT_FOUND');
    const owner = await guestTokenOf(booking.id);
    expect((await deleteRequest(owner, booking.id, { reason: 'Khách thử xoá' })).status).toBe(403);
    expect(
      await rows('SELECT reschedule_count FROM bookings WHERE id=$1::uuid', [booking.id]),
    ).toEqual([{ reschedule_count: 0 }]);
  });

  test('nhân viên đang buộc đổi mật khẩu bị chặn như AuthGuard', async () => {
    const { booking } = await createBooking({}, { token: await login() });
    const staff = await login();
    await rows("UPDATE users SET must_change_password=true WHERE username='h029-first'");
    try {
      const blocked = await rescheduleRequest(staff, booking.id, shifted, { tag: '"1"' });
      expect(blocked.status).toBe(403);
      expect(errorCode(blocked.body)).toBe('E_AUTH_PASSWORD_CHANGE_REQUIRED');
    } finally {
      await rows("UPDATE users SET must_change_password=false WHERE username='h029-first'");
    }
  });
});
