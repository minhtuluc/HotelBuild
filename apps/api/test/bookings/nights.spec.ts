/**
 * HB-266 — `GET /bookings/{bookingId}/nights`: bảng giá từng đêm đã chốt của booking (SCR-80,
 * BR-RATE-16). Snapshot đã có từ HB-077 nhưng không có tuyến đọc, nên app khách ghi "chờ ticket hợp đồng".
 * Chỉ trả số khách cần xem — không lộ hoa hồng kênh hay hệ số định giá nội bộ.
 */
import { expect, test } from 'vitest';
import { bookingPriceSnapshotSchema } from '@pinehill/contracts';
import { createBooking, http, guestToken, otherGuestToken, staffToken } from './fixture.js';

const snapshot = (bookingId: string, token: string) =>
  http().get(`/api/v1/bookings/${bookingId}/nights`).set('Authorization', `Bearer ${token}`);

test('chủ booking đọc giá từng đêm và tổng khớp booking; không có trường nội bộ', async () => {
  const { booking } = await createBooking();
  const response = await snapshot(booking.id, guestToken);
  expect(response.status, JSON.stringify(response.body)).toBe(200);
  expect(response.headers['cache-control']).toBe('no-store');
  const view = bookingPriceSnapshotSchema.parse(response.body);
  expect(view.bookingId).toBe(booking.id);
  expect(view.nights).toHaveLength(booking.nights);
  expect(view.nights.reduce((sum, night) => sum + night.amount, 0)).toBe(view.totals.grossAmount);
  expect(view.totals.grossAmount).toBe(booking.totalAmount);
  const raw = JSON.stringify(response.body);
  for (const internal of ['commission', 'Multiplier', 'channelSettingId', 'quoteFingerprint'])
    expect(raw).not.toContain(internal);
});

test('khách khác bị che 404; nhân viên trong phạm vi đọc được', async () => {
  const { booking } = await createBooking();
  expect((await snapshot(booking.id, otherGuestToken)).status).toBe(404);
  expect((await snapshot(booking.id, await staffToken('FRONT_DESK'))).status).toBe(200);
});
