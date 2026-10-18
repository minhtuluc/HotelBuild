/**
 * HB-098 — xoá cứng `DRAFT`/`HELD` (UC-BOOK-05, BR-BOOK-14/17, TC-BOOK-24): chỉ khi **chưa** có bất kỳ
 * khoản thanh toán nào, nhả đơn vị bán trước, và **vết kiểm toán `beforeJson` được ghi trước khi xoá**
 * (trigger `trg_bookings_delete` ghi trong chính transaction của lệnh).
 */
import { randomUUID } from 'node:crypto';
import { describe, expect, test } from 'vitest';
import { z } from 'zod';
import {
  assignmentsOf,
  auditOf,
  bookingRow,
  chargesOf,
  createBooking,
  deleteRequest,
  errorCode,
  login,
  rows,
  seedPayment,
  toDraft,
  userId,
} from './fixture.js';

const deleteAuditSchema = z.object({
  booking: z.record(z.string(), z.json()),
  priceSnapshots: z.array(z.record(z.string(), z.json())),
});

describe('HB-098 xoá cứng DRAFT/HELD', () => {
  test('BR-BOOK-14/17: HELD chưa phát sinh thanh toán ⇒ 204, audit beforeJson cùng transaction, nhả chỗ', async () => {
    const token = await login();
    const { booking } = await createBooking({}, { token });
    expect(booking.status).toBe('HELD');
    expect(await chargesOf(booking.id)).toHaveLength(3); // nghĩa vụ phòng–đêm của 3 đêm

    const response = await deleteRequest(token, booking.id, {
      reason: 'Khách rút giữ chỗ, xoá bản nháp',
    });
    expect(response.status, JSON.stringify(response.body)).toBe(204);

    expect(await bookingRow(booking.id)).toBeUndefined();
    expect(await chargesOf(booking.id)).toEqual([]);
    expect(
      await rows('SELECT id FROM price_snapshots WHERE booking_id=$1::uuid', [booking.id]),
    ).toEqual([]);
    expect(
      await rows('SELECT id FROM booking_rooms WHERE booking_id=$1::uuid', [booking.id]),
    ).toEqual([]);
    expect(await assignmentsOf(booking.id)).toEqual([]);

    // BR-BOOK-17: AuditLog ghi **trước** khi xoá, `beforeJson` đầy đủ của bản ghi đã biến mất.
    const audit = await auditOf(booking.id);
    const removed = audit.find((row) => row.action === 'DELETE');
    expect(removed).toMatchObject({ actor_id: userId, actor_role: 'FRONT_DESK' });
    expect(removed?.reason).toBe('Khách rút giữ chỗ, xoá bản nháp');
    const before = deleteAuditSchema.parse(removed?.before_json);
    expect(before.booking).toMatchObject({ id: booking.id, status: 'HELD' });
    expect(before.priceSnapshots).toHaveLength(1);
    expect(before.priceSnapshots[0]).toMatchObject({ seq: 1, kind: 'ORIGINAL' });
  });

  test('BR-BOOK-14: có bất kỳ khoản thanh toán nào (kể cả PENDING/FAILED) ⇒ 409, bản ghi còn nguyên', async () => {
    const token = await login();
    const { booking } = await createBooking({}, { token });
    await seedPayment(booking.id, 100_000, 'PENDING');

    const pending = await deleteRequest(token, booking.id, { reason: 'Xoá nhầm' });
    expect(pending.status).toBe(409);
    expect(errorCode(pending.body)).toBe('E_BOOK_HARD_DELETE_FORBIDDEN');
    expect(await bookingRow(booking.id)).toBeTruthy();
    expect((await auditOf(booking.id)).find((row) => row.action === 'DELETE')).toBeUndefined();

    await seedPayment(booking.id, 100_000, 'SUCCEEDED');
    const succeeded = await deleteRequest(token, booking.id, { reason: 'Xoá nhầm' });
    expect(succeeded.status).toBe(409);
    expect(errorCode(succeeded.body)).toBe('E_BOOK_HARD_DELETE_FORBIDDEN');
  });

  test('BR-BOOK-14: chỉ DRAFT/HELD — CONFIRMED bị từ chối dù chưa có khoản thu nào; DRAFT thì được', async () => {
    const token = await login();
    const confirmed = await createBooking({}, { token });
    await rows("UPDATE bookings SET status='CONFIRMED' WHERE id=$1::uuid", [confirmed.booking.id]);
    const denied = await deleteRequest(token, confirmed.booking.id, { reason: 'Xoá nhầm' });
    expect(denied.status).toBe(409);
    expect(errorCode(denied.body)).toBe('E_BOOK_HARD_DELETE_FORBIDDEN');
    expect(await bookingRow(confirmed.booking.id)).toBeTruthy();

    const draft = await createBooking({ checkIn: '2026-11-20', checkOut: '2026-11-22' }, { token });
    await toDraft(draft.booking.id);
    const removed = await deleteRequest(token, draft.booking.id, { reason: 'Bản nháp của quầy' });
    expect(removed.status, JSON.stringify(removed.body)).toBe(204);
    expect(await bookingRow(draft.booking.id)).toBeUndefined();
  });

  test('hợp đồng: thiếu `reason` ⇒ 400, booking lạ ⇒ 404, gửi lại cùng khoá ⇒ 204', async () => {
    const token = await login();
    const { booking } = await createBooking({}, { token });

    const noReason = await deleteRequest(token, booking.id);
    expect(noReason.status).toBe(400);
    expect(errorCode(noReason.body)).toBe('E_GEN_VALIDATION_FAILED');
    const blank = await deleteRequest(token, booking.id, { reason: '   ' });
    expect(blank.status).toBe(400);

    const unknown = await deleteRequest(token, randomUUID(), { reason: 'Không tồn tại' });
    expect(unknown.status).toBe(404);
    expect(errorCode(unknown.body)).toBe('E_GEN_NOT_FOUND');

    const key = randomUUID();
    const first = await deleteRequest(token, booking.id, { reason: 'Xoá theo lệnh quầy', key });
    expect(first.status).toBe(204);
    const replay = await deleteRequest(token, booking.id, { reason: 'Xoá theo lệnh quầy', key });
    expect(replay.status).toBe(204);
    expect(await bookingRow(booking.id)).toBeUndefined();
  });
});
