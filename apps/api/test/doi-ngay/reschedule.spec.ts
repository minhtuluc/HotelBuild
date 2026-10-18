/**
 * HB-098 — đổi ngày lưu trú (UC-BOOK-06, BR-BOOK-12/13, BR-CANCEL-08, BR-RATE-16/17, BR-CHAN-06).
 *
 * Đây là kiểm thử **tích hợp thật**: PostgreSQL 16 + Redis `/8`, app Nest đầy đủ (`AppModule.register`),
 * booking tạo bằng chính API của HB-077 nên ảnh giá ORIGINAL, nghĩa vụ phòng–đêm và assignment là dữ
 * liệu thật. Mọi khẳng định `total`/`balanceDue` đọc từ phản hồi API và hàng CSDL, không dựng lại công
 * thức giá (BR-RATE-17).
 */
import { randomUUID } from 'node:crypto';
import { describe, expect, test } from 'vitest';
import { z } from 'zod';
import { bookingSummarySchema, errorBodySchema } from '@pinehill/contracts';
import {
  assignmentsOf,
  auditOf,
  bookingRow,
  chargesOf,
  createBooking,
  errorCode,
  login,
  refundRequestsOf,
  rescheduleRequest,
  rows,
  shifted,
  snapshotsOf,
  stay,
  userId,
  versionOf,
} from './fixture.js';

/** Mã lỗi của lệnh đổi ngày theo api.md §4.2 (không tự chế mã). */
const bodyOf = (body: unknown) => errorBodySchema.parse(body);

describe('HB-098 đổi ngày lưu trú', () => {
  test('BR-BOOK-12/16: dời nguyên kỳ — giữ ORIGINAL, append RESCHEDULE, chuyển assignment, không đổi trạng thái', async () => {
    const token = await login();
    const { booking } = await createBooking({}, { token });
    expect(booking.status).toBe('HELD');
    const before = await bookingRow(booking.id);
    const [original] = await snapshotsOf(booking.id);
    const reason = 'Khách dời lịch sang tuần sau';
    const version = await versionOf(token, booking.id);

    const response = await rescheduleRequest(
      token,
      booking.id,
      { checkIn: shifted.checkIn, checkOut: shifted.checkOut, reason },
      { tag: version },
    );
    expect(response.status, JSON.stringify(response.body)).toBe(200);
    const updated = bookingSummarySchema.parse(response.body);

    // Bằng chứng thứ tự ghi: lệnh trước tạo booking, lệnh này chỉ thêm vết đổi ngày.
    const audit = await auditOf(booking.id);
    expect(audit.map((row) => row.action)).toEqual(['BOOKING_CREATED', 'BOOKING_RESCHEDULED']);

    expect(updated.id).toBe(booking.id);
    expect(updated.status).toBe(booking.status); // BR-BOOK-12: không đổi trạng thái
    expect(updated.rescheduleCount).toBe(1);
    expect(updated.checkIn).toBe(shifted.checkIn);
    expect(updated.checkOut).toBe(shifted.checkOut);
    // Bản ghi tăng ít nhất một bậc (`trg_version` của lệnh ghi); nếu sổ phải đồng bộ thêm
    // (`LEDGER_RECONCILED`) thì tăng thêm bậc nữa — neo cũ không còn khớp trong mọi trường hợp.
    expect(Number(updated.version)).toBeGreaterThan(Number(version));
    // Dời đúng 7 ngày ⇒ cùng thứ trong tuần (BR-RATE-06) nên giá kỳ mới **bằng** giá cũ: không chênh.
    expect(updated.totalAmount).toBe(booking.totalAmount);

    const after = await bookingRow(booking.id);
    expect(after).toMatchObject({
      status: 'HELD',
      reschedule_count: 1,
      check_in: shifted.checkIn,
      check_out: shifted.checkOut,
      total_amount: String(booking.totalAmount),
      balance_due: String(booking.totalAmount),
      version: String(updated.version),
    });
    expect(before?.version).not.toBe(after?.version);

    const snapshots = await snapshotsOf(booking.id);
    expect(snapshots.map((snapshot) => [snapshot.seq, snapshot.kind])).toEqual([
      [1, 'ORIGINAL'],
      [2, 'RESCHEDULE'],
    ]);
    const appended = snapshots[1]!;
    expect(snapshots[0]).toEqual(original); // ảnh ORIGINAL bất biến (trigger append-only)
    expect(appended.quote_id).toBeNull(); // ck_snapshot_quote: chỉ ORIGINAL giữ quote
    expect(appended.quote_fingerprint).toBeNull();
    expect(appended.payload_json.stay).toMatchObject({
      checkIn: shifted.checkIn,
      checkOut: shifted.checkOut,
    });
    expect(appended.payload_json.nights.map((night) => night.date)).toEqual([
      '2026-11-08',
      '2026-11-09',
      '2026-11-10',
    ]);
    expect(appended.payload_json.reschedule).toMatchObject({
      previousCheckIn: stay.checkIn,
      previousCheckOut: stay.checkOut,
      previousTotalAmount: booking.totalAmount,
      previousRescheduleCount: 0,
      offeredTotal: booking.totalAmount,
      balanceIncrease: 0,
      retainedAmount: 0,
      feeAmount: 0,
      rescheduleCount: 1,
      reason,
    });

    // Nhả chỗ cũ và giữ chỗ mới trong **cùng** transaction (BR-BOOK-12, luồng HB-076).
    const assignments = await assignmentsOf(booking.id);
    expect(
      assignments
        .filter((assignment) => assignment.released_at !== null)
        .map((assignment) => [
          assignment.start_date,
          assignment.end_date,
          assignment.release_reason,
        ]),
    ).toEqual([[stay.checkIn, stay.checkOut, 'RESCHEDULE']]);
    const active = assignments.filter((assignment) => assignment.released_at === null);
    expect(active.map((assignment) => [assignment.start_date, assignment.end_date])).toEqual([
      [shifted.checkIn, shifted.checkOut],
    ]);

    // BR-CANCEL-08: đổi ngày **không** tạo yêu cầu hoàn; nghĩa vụ khớp tổng cam kết.
    expect(await refundRequestsOf(booking.id)).toEqual([]);
    const charges = await chargesOf(booking.id);
    expect(charges.every((charge) => charge.kind === 'ROOM')).toBe(true);
    expect(charges.reduce((sum, charge) => sum + BigInt(charge.amount), 0n)).toBe(
      BigInt(booking.totalAmount),
    );

    const logged = audit.find((row) => row.action === 'BOOKING_RESCHEDULED');
    // Kẻ ghi vết là phiên nhân viên đã gọi lệnh (HB-009 `actor_id`/`actor_role`).
    expect(logged).toMatchObject({ actor_id: userId, actor_role: 'FRONT_DESK', reason });
    expect(logged?.before_json).toMatchObject({
      checkIn: stay.checkIn,
      totalAmount: booking.totalAmount,
    });
    expect(logged?.after_json).toMatchObject({
      checkIn: shifted.checkIn,
      bookingRoomIds: active.map((assignment) => assignment.booking_room_id),
      assignedRoomIds: active.map((assignment) => assignment.room_id),
      rescheduleCount: 1,
    });

    // BR-CHAN-06: kênh thấy kỳ mới qua outbox cùng transaction.
    const events = z.array(z.object({ payload_json: z.record(z.string(), z.json()) })).parse(
      await rows(
        `SELECT payload_json FROM outbox_events WHERE aggregate_id=$1::uuid
             AND event_type='InventoryChanged' ORDER BY created_at, id`,
        [booking.id],
      ),
    );
    expect(events).toHaveLength(2);
    expect(events[1]?.payload_json).toMatchObject({
      operation: 'BOOKING_RESCHEDULED',
      startDate: shifted.checkIn,
      endDate: shifted.checkOut,
    });
  });

  test('BR-BOOK-13/BR-CANCEL-08: giá kỳ mới thấp hơn ⇒ không hạ cam kết cũ, không sinh hoàn', async () => {
    const token = await login();
    const { booking } = await createBooking(
      { checkIn: '2026-11-01', checkOut: '2026-11-04' },
      { token },
    );
    const response = await rescheduleRequest(
      token,
      booking.id,
      { checkIn: '2026-11-01', checkOut: '2026-11-03' },
      { tag: await versionOf(token, booking.id) },
    );
    expect(response.status, JSON.stringify(response.body)).toBe(200);
    const updated = bookingSummarySchema.parse(response.body);
    const appended = (await snapshotsOf(booking.id))[1]!;
    const offered = appended.payload_json.totals.grossAmount;

    expect(offered).toBeLessThan(booking.totalAmount); // ca kiểm thử đúng là "giá giảm"
    expect(updated.totalAmount).toBe(booking.totalAmount); // max(cũ, mới)
    expect(updated.balanceDue).toBe(booking.totalAmount);
    expect(appended.payload_json.reschedule).toMatchObject({
      offeredTotal: offered,
      retainedAmount: booking.totalAmount - offered,
      balanceIncrease: 0,
      feeAmount: 0,
    });
    expect(await refundRequestsOf(booking.id)).toEqual([]);
    expect((await chargesOf(booking.id)).map((charge) => charge.kind)).toEqual([
      'ROOM',
      'ROOM',
      'ROOM',
    ]);
    expect((await bookingRow(booking.id))?.reschedule_count).toBe(1);
  });

  test('BR-BOOK-12/BR-CANCEL-07: NONREF phí 10% làm tròn lên 1.000 và chênh lệch tăng vào balance_due', async () => {
    const token = await login();
    // Giá nền lẻ (nhưng vẫn là bội số 1.000 theo BR-GEN-03) để chứng minh bước làm tròn lên 1.000 của phí.
    await rows(
      "UPDATE room_types SET base_price=133000,min_price=133000,max_price=133000 WHERE code='STD'",
    );
    const { booking } = await createBooking(
      { ratePlanCode: 'NONREF', checkIn: '2026-11-01', checkOut: '2026-11-03' },
      { token },
    );
    expect(booking.depositPercent).toBe(100);
    const oldTotal = booking.totalAmount;

    const response = await rescheduleRequest(
      token,
      booking.id,
      { checkIn: '2026-11-01', checkOut: '2026-11-04', reason: 'Kéo dài kỳ lưu trú' },
      { tag: await versionOf(token, booking.id) },
    );
    expect(response.status, JSON.stringify(response.body)).toBe(200);
    const updated = bookingSummarySchema.parse(response.body);
    const appended = (await snapshotsOf(booking.id))[1]!;
    const offered = appended.payload_json.totals.grossAmount;
    const expectedFee = Math.ceil((oldTotal * 10) / 100 / 1000) * 1000;

    expect(offered).toBeGreaterThan(oldTotal);
    expect(updated.totalAmount).toBe(offered); // max(cũ, mới) = giá kỳ mới
    expect(updated.depositAmount).toBe(booking.depositAmount); // giữ cọc của cam kết cũ
    expect(updated.paidAmount).toBe(0);
    expect(appended.payload_json.reschedule).toMatchObject({
      offeredTotal: offered,
      balanceIncrease: offered - oldTotal,
      retainedAmount: 0,
      feeAmount: expectedFee,
    });
    expect(expectedFee).toBeGreaterThan(oldTotal / 10); // làm tròn **lên**, không phải xuống

    const charges = await chargesOf(booking.id);
    const increase = charges.filter((charge) => charge.source_key.includes(':R1'));
    expect(increase.length).toBe(3);
    expect(increase.reduce((sum, charge) => sum + BigInt(charge.amount), 0n)).toBe(
      BigInt(offered - oldTotal),
    );
    const fee = charges.find((charge) => charge.kind === 'RESCHEDULE_FEE');
    expect(fee).toMatchObject({ source_key: 'RESCHEDULE_FEE:1', amount: String(expectedFee) });
    // BR-PAY-02: số dư là projection của sổ nghĩa vụ (tiền phòng mới + phí đổi).
    expect(updated.balanceDue).toBe(offered + expectedFee);
  });

  test('§1.3/§6.4: thiếu If-Match ⇒ 428, lệch ⇒ 412, neo đã dùng ⇒ 412, đúng ⇒ 200 và version tăng', async () => {
    const token = await login();
    const { booking } = await createBooking({}, { token });
    const body = { checkIn: shifted.checkIn, checkOut: shifted.checkOut };

    const missing = await rescheduleRequest(token, booking.id, body);
    expect(missing.status).toBe(428);
    expect(errorCode(missing.body)).toBe('E_GEN_PRECONDITION_REQUIRED');

    const wrong = await rescheduleRequest(token, booking.id, body, { tag: '9' });
    expect(wrong.status).toBe(412);
    expect(errorCode(wrong.body)).toBe('E_GEN_VERSION_CONFLICT');

    const version = await versionOf(token, booking.id);
    const accepted = await rescheduleRequest(token, booking.id, body, { tag: version });
    expect(accepted.status, JSON.stringify(accepted.body)).toBe(200);
    expect(bookingSummarySchema.parse(accepted.body).version).toBeGreaterThan(Number(version));

    // Neo cũ không dùng lại được (nâng `maxReschedules` để phép kiểm số lần không che `412`).
    await rows("UPDATE rate_plans SET max_reschedules=2 WHERE code='FLEX7'");
    const stale = await rescheduleRequest(
      token,
      booking.id,
      { checkIn: '2026-11-20', checkOut: '2026-11-23' },
      { tag: version },
    );
    expect(stale.status).toBe(412);
    expect(errorCode(stale.body)).toBe('E_GEN_VERSION_CONFLICT');
  });

  test('§1.6: gửi lại cùng Idempotency-Key trả đúng kết quả cũ, không ghi thêm ảnh giá', async () => {
    const token = await login();
    const { booking } = await createBooking({}, { token });
    const version = await versionOf(token, booking.id);
    const key = randomUUID();
    const body = { checkIn: shifted.checkIn, checkOut: shifted.checkOut };

    const first = await rescheduleRequest(token, booking.id, body, { tag: version, key });
    expect(first.status, JSON.stringify(first.body)).toBe(200);
    const replay = await rescheduleRequest(token, booking.id, body, { tag: version, key });
    expect(replay.status).toBe(200);
    expect(replay.body).toEqual(first.body);
    expect((await snapshotsOf(booking.id)).map((snapshot) => snapshot.kind)).toEqual([
      'ORIGINAL',
      'RESCHEDULE',
    ]);
    expect((await bookingRow(booking.id))?.reschedule_count).toBe(1);
    expect(
      (await assignmentsOf(booking.id)).filter((row) => row.released_at === null),
    ).toHaveLength(1);
  });

  test('BR-BOOK-12/13: chặn lượt thứ hai (kèm gợi ý huỷ + đặt mới), quá sát 168 giờ, đã nhận phòng, gói cấm', async () => {
    const token = await login();
    const { booking } = await createBooking({}, { token });
    const first = await rescheduleRequest(
      token,
      booking.id,
      { checkIn: shifted.checkIn, checkOut: shifted.checkOut },
      { tag: await versionOf(token, booking.id) },
    );
    expect(first.status).toBe(200);
    const second = await rescheduleRequest(
      token,
      booking.id,
      { checkIn: '2026-11-10', checkOut: '2026-11-13' },
      { tag: await versionOf(token, booking.id) },
    );
    expect(second.status).toBe(409);
    expect(bodyOf(second.body).code).toBe('E_BOOK_INVALID_STATE');
    expect(bodyOf(second.body).message).toContain('huỷ');

    // E3: dưới `rescheduleMinHours` (mặc định 168) tính theo **giờ CSDL** so với kỳ cũ.
    const soon = await createBooking({ checkIn: '2026-10-20', checkOut: '2026-10-22' }, { token });
    const tooLate = await rescheduleRequest(
      token,
      soon.booking.id,
      { checkIn: '2026-10-23', checkOut: '2026-10-25' },
      { tag: await versionOf(token, soon.booking.id) },
    );
    expect(tooLate.status).toBe(409);
    expect(errorCode(tooLate.body)).toBe('E_BOOK_INVALID_STATE');

    // BR-BOOK-13: đã nhận phòng thì phải check-out rồi tạo booking mới (kỳ riêng để không vướng tồn).
    const checkedIn = await createBooking(
      { checkIn: '2026-11-15', checkOut: '2026-11-18' },
      { token },
    );
    await rows("UPDATE bookings SET status='CHECKED_IN' WHERE id=$1::uuid", [checkedIn.booking.id]);
    const immutable = await rescheduleRequest(
      token,
      checkedIn.booking.id,
      { checkIn: shifted.checkIn, checkOut: shifted.checkOut },
      { tag: await versionOf(token, checkedIn.booking.id) },
    );
    expect(immutable.status).toBe(409);
    expect(errorCode(immutable.body)).toBe('E_BOOK_CHECKED_IN_IMMUTABLE');

    // BR-RATE-20: `rescheduleAllowed` là dữ liệu của gói giá.
    await rows("UPDATE rate_plans SET reschedule_allowed=false WHERE code='FLEX7'");
    const plan = await createBooking({ checkIn: '2026-11-20', checkOut: '2026-11-23' }, { token });
    const denied = await rescheduleRequest(
      token,
      plan.booking.id,
      { checkIn: shifted.checkIn, checkOut: shifted.checkOut },
      { tag: await versionOf(token, plan.booking.id) },
    );
    expect(denied.status).toBe(409);
    expect(errorCode(denied.body)).toBe('E_BOOK_INVALID_STATE');

    // Trạng thái kết thúc (BR-BOOK-06) cũng bị chặn.
    const cancelled = await createBooking(
      { checkIn: '2026-11-25', checkOut: '2026-11-28' },
      { token },
    );
    await rows(
      "UPDATE bookings SET status='CANCELLED', cancelled_at=clock_timestamp() WHERE id=$1::uuid",
      [cancelled.booking.id],
    );
    const ended = await rescheduleRequest(
      token,
      cancelled.booking.id,
      { checkIn: shifted.checkIn, checkOut: shifted.checkOut },
      { tag: await versionOf(token, cancelled.booking.id) },
    );
    expect(ended.status).toBe(409);
  });
});
