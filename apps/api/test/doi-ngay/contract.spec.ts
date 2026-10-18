/**
 * HB-098 — hợp đồng và đường báo giá của lệnh đổi ngày (api.md §3.3/§6.4, BR-BOOK-05, BR-RATE-17):
 * từ chối trường lạ và kỳ ngược chiều, che PII trong lý do, tiêu thụ **báo giá mới đã chấp nhận**, và
 * trường hợp booking có trẻ em (tuổi trẻ em không lưu trên booking nên phải có báo giá kèm tuổi).
 */
import { describe, expect, test } from 'vitest';
import { bookingSummarySchema } from '@pinehill/contracts';
import {
  assignmentsOf,
  auditOf,
  blockRooms,
  bookingRow,
  createBooking,
  errorCode,
  getBooking,
  issueQuote,
  login,
  rescheduleRequest,
  room2Id,
  roomId,
  shifted,
  snapshotsOf,
  stay,
  versionOf,
} from './fixture.js';

describe('HB-098 đổi ngày lưu trú — hợp đồng và báo giá', () => {
  test('hợp đồng: từ chối trường lạ, kỳ ngược chiều ⇒ 422, lý do vào audit và được che PII', async () => {
    const token = await login();
    const { booking } = await createBooking({}, { token });
    const version = await versionOf(token, booking.id);

    const extra = await rescheduleRequest(
      token,
      booking.id,
      { checkIn: shifted.checkIn, checkOut: shifted.checkOut, roomCount: 5 },
      { tag: version },
    );
    expect(extra.status).toBe(400);
    expect(errorCode(extra.body)).toBe('E_GEN_VALIDATION_FAILED');

    const reversed = await rescheduleRequest(
      token,
      booking.id,
      { checkIn: shifted.checkOut, checkOut: shifted.checkIn },
      { tag: version },
    );
    expect(reversed.status).toBe(422);
    expect(errorCode(reversed.body)).toBe('E_BOOK_INVALID_DATES');

    const reason = 'Khách đổi lịch, SĐT 0901234567';
    const accepted = await rescheduleRequest(
      token,
      booking.id,
      { checkIn: shifted.checkIn, checkOut: shifted.checkOut, reason },
      { tag: version },
    );
    expect(accepted.status, JSON.stringify(accepted.body)).toBe(200);
    const logged = (await auditOf(booking.id)).find((row) => row.action === 'BOOKING_RESCHEDULED');
    expect(logged?.reason).toBe('Khách đổi lịch, SĐT ****4567'); // NFR-SEC-03
    expect((await snapshotsOf(booking.id))[1]?.payload_json.reschedule?.reason).toBe(
      'Khách đổi lịch, SĐT ****4567',
    );
  });

  test('§6.4: báo giá kỳ khác ⇒ 409; báo giá mới đã chấp nhận ⇒ dùng đúng con số của khách', async () => {
    const token = await login();
    const { quote, booking } = await createBooking({}, { token });
    const version = await versionOf(token, booking.id);

    // Báo giá của kỳ cũ không dùng được cho kỳ mới (fingerprint băm cả kỳ) ⇒ 409.
    const mismatched = await rescheduleRequest(
      token,
      booking.id,
      { checkIn: shifted.checkIn, checkOut: shifted.checkOut, quoteId: quote.quoteId },
      { tag: version },
    );
    expect(mismatched.status).toBe(409);
    expect(errorCode(mismatched.body)).toBe('E_RATE_QUOTE_MISMATCH');

    const accepted = await issueQuote(
      { checkIn: shifted.checkIn, checkOut: shifted.checkOut },
      token,
    );
    const response = await rescheduleRequest(
      token,
      booking.id,
      { checkIn: shifted.checkIn, checkOut: shifted.checkOut, quoteId: accepted.quoteId },
      { tag: version },
    );
    expect(response.status, JSON.stringify(response.body)).toBe(200);
    const appended = (await snapshotsOf(booking.id))[1]!;
    expect(appended.payload_json.quoteId).toBe(accepted.quoteId);
    expect(appended.payload_json.totals.grossAmount).toBe(accepted.total);
    expect(bookingSummarySchema.parse(response.body).totalAmount).toBe(
      accepted.total > booking.totalAmount ? accepted.total : booking.totalAmount,
    );
  });

  test('BR-BOOK-05: booking có trẻ em cần báo giá kèm tuổi cho kỳ mới (tuổi không lưu trên booking)', async () => {
    const token = await login();
    const rooms = { roomCount: 2, children: 2, childAges: [5, 8] };
    const { booking } = await createBooking(rooms, { token });
    const version = await versionOf(token, booking.id);

    const missing = await rescheduleRequest(
      token,
      booking.id,
      { checkIn: shifted.checkIn, checkOut: shifted.checkOut },
      { tag: version },
    );
    expect(missing.status).toBe(400);
    expect(errorCode(missing.body)).toBe('E_BOOK_MISSING_FIELD');

    const quote = await issueQuote(
      { checkIn: shifted.checkIn, checkOut: shifted.checkOut, ...rooms },
      token,
    );
    const accepted = await rescheduleRequest(
      token,
      booking.id,
      { checkIn: shifted.checkIn, checkOut: shifted.checkOut, quoteId: quote.quoteId },
      { tag: version },
    );
    expect(accepted.status, JSON.stringify(accepted.body)).toBe(200);
    expect((await snapshotsOf(booking.id))[1]?.payload_json.quoteId).toBe(quote.quoteId);
  });

  test('đọc lại sau đổi ngày: chi tiết booking trả kỳ mới, version mới và ảnh giá mới là bản cuối', async () => {
    const token = await login();
    const { booking } = await createBooking({}, { token });
    const version = await versionOf(token, booking.id);
    await rescheduleRequest(
      token,
      booking.id,
      { checkIn: shifted.checkIn, checkOut: shifted.checkOut },
      { tag: version },
    );
    const detail = bookingSummarySchema.parse((await getBooking(token, booking.id)).body);
    expect(detail).toMatchObject({
      checkIn: shifted.checkIn,
      checkOut: shifted.checkOut,
      rescheduleCount: 1,
      version: Number(version) + 1,
    });
    const appended = (await snapshotsOf(booking.id))[1]!;
    expect(appended.payload_json.stay.checkIn).toBe(detail.checkIn);
    expect(appended.gross_amount).toBe(String(detail.totalAmount));
  });

  test('E1/BR-INV-02: kỳ mới không đủ tồn ⇒ 409 và rollback toàn bộ, giữ nguyên kỳ cũ', async () => {
    const token = await login();
    const { booking } = await createBooking(
      { checkIn: '2026-11-01', checkOut: '2026-11-02' },
      { token },
    );
    const before = await bookingRow(booking.id);
    await blockRooms([roomId, room2Id], '2026-11-05', '2026-11-06');

    const response = await rescheduleRequest(
      token,
      booking.id,
      { checkIn: '2026-11-05', checkOut: '2026-11-06' },
      { tag: await versionOf(token, booking.id) },
    );
    expect(response.status).toBe(409);
    expect(errorCode(response.body)).toBe('E_INV_NO_AVAILABILITY');

    expect(await bookingRow(booking.id)).toEqual(before);
    expect((await snapshotsOf(booking.id)).map((snapshot) => snapshot.kind)).toEqual(['ORIGINAL']);
    const assignments = await assignmentsOf(booking.id);
    expect(
      assignments.map((row) => ({
        start: row.start_date,
        end: row.end_date,
        released: row.released_at !== null,
        reason: row.release_reason,
        bed: row.bed_no,
      })),
    ).toEqual([{ start: stay.checkIn, end: '2026-11-02', released: false, reason: null, bed: 0 }]);
  });
});
