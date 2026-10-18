/**
 * HB-077 — AC3: `POST /bookings/{bookingId}/confirm` trên app thật + PostgreSQL 16 + Redis (DB `/4`).
 *
 * `confirm` chỉ từ `HELD`/`PENDING_PAYMENT` **còn hạn** theo **giờ CSDL** và **đủ cọc**; quá hạn ⇒ lỗi và
 * **không** đổi trạng thái (BR-BOOK-09, BR-BOOK-18) — job hết hạn hold (HB-078) là bên duy nhất kết thúc
 * hold. Khoản thu của ba ca mínimo được seed thẳng vào CSDL vì `POST /payments` thuộc HB-094/HB-096
 * (ngoài phạm vi HB-077).
 */
import { randomUUID } from 'node:crypto';
import { expect, test } from 'vitest';
import { z } from 'zod';
import { bookingSummarySchema } from '@pinehill/contracts';
import {
  bookingBody,
  bookingRequest,
  confirmRequest,
  count,
  createBooking,
  issueQuote,
  rows,
  rowsOf,
  seedPayment,
  staffToken,
  userId,
} from './fixture.js';
import { bookingRow, codeOf } from './shared.js';
import type { BookingRow } from './shared.js';

test('AC3: confirm đủ cọc ⇒ CONFIRMED, giữ nguyên assignment, ghi history + audit', async () => {
  const { booking } = await createBooking();
  const assignmentsBefore = await rowsOf(
    'SELECT id FROM room_assignments ORDER BY id',
    z.object({ id: z.string() }),
  );
  const paymentId = await seedPayment(booking.id, booking.depositAmount);
  // Khoản thu do HB-096 ghi cũng cập nhật projection `paid_amount` (BR-PAY-02) — ở đây seed thay đường đó.
  await rows('UPDATE bookings SET paid_amount=$2, balance_due=$3 WHERE id=$1', [
    booking.id,
    booking.depositAmount,
    booking.totalAmount - booking.depositAmount,
  ]);
  const token = await staffToken('FRONT_DESK');
  const beforeConfirm = await bookingRow(booking.id);
  const response = await confirmRequest(booking.id, paymentId, { token });
  expect(response.status).toBe(200);
  const confirmed = bookingSummarySchema.parse(response.body);
  expect(confirmed).toMatchObject({
    id: booking.id,
    status: 'CONFIRMED',
    paidAmount: booking.depositAmount,
  });
  // `trg_version` của CSDL tăng `version` mỗi lần UPDATE (migration baseline) — xác nhận đúng một lần.
  expect(confirmed.version).toBe(Number(beforeConfirm.version) + 1);

  const row = await bookingRow(booking.id);
  // BR-BOOK-18/09: giữ mốc hạn cũ làm bằng chứng, chỉ trạng thái đổi; assignment không bị đụng.
  expect(row).toMatchObject({
    status: 'CONFIRMED',
    version: String(confirmed.version),
    duplicate_suspected: false,
  });
  expect(row.hold_expires_at).not.toBeNull();
  expect(
    await rowsOf('SELECT id FROM room_assignments ORDER BY id', z.object({ id: z.string() })),
  ).toEqual(assignmentsBefore);
  expect(
    await rowsOf(
      `SELECT from_status, to_status, reason FROM booking_status_history
        WHERE booking_id=$1 ORDER BY at, id`,
      z.object({
        from_status: z.string().nullable(),
        to_status: z.string(),
        reason: z.string().nullable(),
      }),
      [booking.id],
    ),
  ).toEqual([
    { from_status: 'DRAFT', to_status: 'HELD', reason: 'BOOKING_CREATED' },
    { from_status: 'HELD', to_status: 'CONFIRMED', reason: 'CONFIRMED' },
  ]);
  expect(
    await count('SELECT 1 FROM audit_logs WHERE entity_id=$1 AND action=$2', [
      booking.id,
      'BOOKING_CONFIRMED',
    ]),
  ).toBe(1);
});

test('AC3: hold quá hạn theo giờ CSDL ⇒ 409 và KHÔNG đổi trạng thái', async () => {
  const { booking } = await createBooking();
  const paymentId = await seedPayment(booking.id, booking.depositAmount);
  await rows(
    `UPDATE bookings SET hold_expires_at = clock_timestamp() - interval '90 seconds' WHERE id=$1`,
    [booking.id],
  );
  const token = await staffToken('FRONT_DESK');
  const response = await confirmRequest(booking.id, paymentId, { token });
  expect(response.status).toBe(409);
  expect(codeOf(response.body)).toBe('E_BOOK_INVALID_STATE');

  const row = await bookingRow(booking.id);
  // BR-BOOK-18: không đổi trạng thái, không hoàn/huỷ gì; job hết hạn (HB-078) mới là bên kết thúc hold.
  expect(row.status).toBe('HELD');
  expect(row.seconds_left).toBeLessThan(0);
  expect(
    await count(
      "SELECT 1 FROM booking_status_history WHERE booking_id=$1 AND to_status='CONFIRMED'",
      [booking.id],
    ),
  ).toBe(0);
  expect(
    await count("SELECT 1 FROM audit_logs WHERE entity_id=$1 AND action='BOOKING_CONFIRMED'", [
      booking.id,
    ]),
  ).toBe(0);

  // Khoá trùng vẫn đúng: hết hạn là lỗi ổn định, không phải trạng thái "đang xử lý".
  const replay = await confirmRequest(booking.id, paymentId, { token });
  expect(replay.status).toBe(409);
  expect(codeOf(replay.body)).toBe('E_BOOK_INVALID_STATE');
});

test('AC3: trạng thái khác HELD/PENDING_PAYMENT hoặc thiếu tiền cọc ⇒ 409/404, giữ nguyên trạng thái', async () => {
  const { booking } = await createBooking();
  const token = await staffToken('FRONT_DESK');

  const pending = await seedPayment(booking.id, booking.depositAmount, { status: 'PENDING' });
  const notCollected = await confirmRequest(booking.id, pending, { token });
  expect(notCollected.status).toBe(409);
  expect(codeOf(notCollected.body)).toBe('E_BOOK_INVALID_STATE');

  const short = await seedPayment(booking.id, booking.depositAmount - 1000);
  const insufficient = await confirmRequest(booking.id, short, { token });
  expect(insufficient.status).toBe(409);
  expect(codeOf(insufficient.body)).toBe('E_BOOK_INVALID_STATE');

  const unknownPayment = await confirmRequest(booking.id, randomUUID(), { token });
  expect(unknownPayment.status).toBe(404);
  expect(codeOf(unknownPayment.body)).toBe('E_GEN_NOT_FOUND');

  await rows("UPDATE bookings SET status='CANCELLED', cancelled_at=clock_timestamp() WHERE id=$1", [
    booking.id,
  ]);
  const cancelled = await confirmRequest(booking.id, randomUUID(), { token });
  expect(cancelled.status).toBe(409);
  expect(codeOf(cancelled.body)).toBe('E_BOOK_INVALID_STATE');
  expect((await bookingRow(booking.id)).status).toBe('CANCELLED');
});

test('AC3: kênh holdMinutes = 0 ⇒ PENDING_PAYMENT hạn 15 phút rồi xác nhận được (BR-BOOK-07)', async () => {
  const token = await staffToken('FRONT_DESK');
  const quote = await issueQuote({ channelCode: 'WALKIN' }, token);
  const response = await bookingRequest(
    { ...bookingBody({ channelCode: 'WALKIN' }), quoteId: quote.quoteId },
    { token },
  );
  expect(response.status).toBe(201);
  const created = bookingSummarySchema.parse(response.body);
  expect(created).toMatchObject({ status: 'PENDING_PAYMENT', createdBy: userId });
  const row: BookingRow = await bookingRow(created.id);
  expect(row.status).toBe('PENDING_PAYMENT');
  expect(Math.abs(row.seconds_left - 15 * 60)).toBeLessThan(5);
  expect(
    await rowsOf(
      'SELECT from_status, to_status FROM booking_status_history WHERE booking_id=$1',
      z.object({ from_status: z.string(), to_status: z.string() }),
      [created.id],
    ),
  ).toEqual([{ from_status: 'DRAFT', to_status: 'PENDING_PAYMENT' }]);

  const paymentId = await seedPayment(created.id, created.depositAmount);
  const confirmed = await confirmRequest(created.id, paymentId, { token });
  expect(confirmed.status).toBe(200);
  expect(bookingSummarySchema.parse(confirmed.body).status).toBe('CONFIRMED');
});
