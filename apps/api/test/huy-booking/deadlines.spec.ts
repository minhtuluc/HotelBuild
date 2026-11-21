/**
 * HB-245 (yêu cầu frontend #7) — `refundDeadlines` trong `BookingSummary`: mốc tuyệt đối từ snapshot
 * chính sách đã chốt, và **cùng ranh giới** với lệnh huỷ thật (xem trước ngay tại mốc / sau mốc 1 ms).
 */
import { expect, test } from 'vitest';
import { z } from 'zod';
import { bookingSummarySchema, cancelPreviewSchema } from '@pinehill/contracts';
import { booking, clock, http, login, preview } from './fixture.js';

const read = (token: string, id: string) =>
  http().get(`/api/v1/bookings/${id}`).set('Authorization', `Bearer ${token}`);

// Seed: nhận phòng 2026-11-01 lúc 14:00 giờ VN = 07:00Z; bậc FLEX7 ≥168h 100%, ≥72h 50%, ≥24h 0%, còn lại 0% + đêm đầu.
const expected = [
  { until: '2026-10-25T07:00:00.000Z', refundPercent: 100, chargeFirstNight: false },
  { until: '2026-10-29T07:00:00.000Z', refundPercent: 50, chargeFirstNight: false },
  { until: '2026-10-31T07:00:00.000Z', refundPercent: 0, chargeFirstNight: false },
  { until: null, refundPercent: 0, chargeFirstNight: true },
];

test('HB245_booking_deadlines_match_cancel_engine_boundaries', async () => {
  const token = await login('FRONT_DESK');
  const confirmed = await booking();
  const response = await read(token, confirmed.id);
  expect(response.status, JSON.stringify(response.body)).toBe(200);
  expect(bookingSummarySchema.parse(response.body).refundDeadlines).toEqual(expected);

  const list = await http()
    .get('/api/v1/bookings')
    .query({ statuses: 'CONFIRMED', limit: 100 })
    .set('Authorization', `Bearer ${token}`);
  const listed = z
    .object({ data: z.array(bookingSummarySchema) })
    .parse(list.body)
    .data.find((item) => item.id === confirmed.id);
  expect(listed?.refundDeadlines).toEqual(expected);

  const saved = clock.value;
  try {
    clock.value = Date.parse(expected[1]!.until!);
    // Đồng hồ nhảy ~20 ngày ⇒ token cũ hết hạn; đăng nhập lại như `cancel.spec.ts`.
    const later = await login('FRONT_DESK');
    const raw = await preview(later, confirmed.id);
    expect(raw.status, JSON.stringify(raw.body)).toBe(200);
    const atDeadline = cancelPreviewSchema.parse(raw.body);
    expect(atDeadline.cancellation.refundPercent).toBe(50);
    clock.value += 1;
    const after = cancelPreviewSchema.parse((await preview(later, confirmed.id)).body);
    expect(after.cancellation.refundPercent).toBe(0);
  } finally {
    clock.value = saved;
  }
});

test('HB245_no_deadlines_for_ota_contract_or_closed_bookings', async () => {
  const token = await login('FRONT_DESK');
  const ota = await booking({ channel: 'OTA_AGODA', channelPolicyCode: 'AGODA-NR' });
  // Đã nhận phòng: không còn huỷ được (rời sớm theo BR-CANCEL-09) ⇒ không có mốc.
  const checkedIn = await booking({ status: 'CHECKED_IN' });
  const held = await booking({ status: 'HELD' });
  const otaBody = bookingSummarySchema.parse((await read(token, ota.id)).body);
  expect(otaBody.refundDeadlines).toBeUndefined();
  expect(bookingSummarySchema.parse((await read(token, checkedIn.id)).body).refundDeadlines).toBe(
    undefined,
  );
  // Trước xác nhận vẫn hiện mốc (áp từ khi CONFIRMED); huỷ lúc này hoàn đủ tiền đã thu.
  expect(bookingSummarySchema.parse((await read(token, held.id)).body).refundDeadlines).toEqual(
    expected,
  );
});
