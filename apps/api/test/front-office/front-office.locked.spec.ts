/**
 * HB-143 — test khoá tiền sảnh (check-in, check-out, no-show) trên PostgreSQL16 thật.
 *
 * GIAI ĐOẠN A ĐỎ CÓ CHỦ ĐÍCH. Ba tuyến dưới đây **chưa tồn tại**, nên mỗi ca dừng ở `guardRoute`
 * với thông điệp "chưa được hiện thực (404 E_GEN_NOT_FOUND)":
 *   - POST /api/v1/front-office/check-in   → HB-144
 *   - POST /api/v1/front-office/check-out  → HB-145
 *   - POST /api/v1/front-office/no-show    → HB-147
 * Đó là lý do đỏ **duy nhất** được phép. Seed được đọc lại từ CSDL trước khi gọi HTTP nên lỗi
 * fixture/typo không thể giả làm "thiếu endpoint". Sau khi endpoint có thật, không ca nào được
 * sửa/nới; xanh hết mới đạt HB-144/145/147.
 *
 * Mốc giờ nghiệp vụ (ngày VN, 23:59, 12:00/18:00) đi qua cổng `CLOCK` — app bị thay bằng clock giả
 * như mọi harness F1/F7. ADR-014 vẫn bắt buộc đọc `clock_timestamp()` dưới khoá khi so hạn/giành
 * tài nguyên; file này không ghim thứ tự khoá.
 */
import { describe, expect, test } from 'vitest';
import {
  checkInResponseSchema,
  checkOutResponseSchema,
  noShowResponseSchema,
} from '@pinehill/contracts';
import {
  CHECK_IN,
  CHECK_OUT,
  NO_SHOW,
  D,
  NIGHTLY,
  bookingRow,
  chargeIds,
  checkInBody,
  checkOutBody,
  clock,
  completedKeys,
  day,
  errorCode,
  guardRoute,
  history,
  housekeeping,
  mintPin,
  paymentIds,
  post,
  r1,
  r2,
  r3,
  r4,
  refusedCheckIn,
  releaseRow,
  roomTasks,
  rows,
  seedBooking,
  staffToken,
  unreleased,
  userId,
  vn,
  withFailingAudit,
} from './fixture.js';

describe('HB-143 · check-in (BR-FO-01/02/07)', () => {
  test('chưa CONFIRMED → E_FO_CHECKIN_NOT_ALLOWED, không gán phòng', async () => {
    const seed = await seedBooking({ status: 'HELD' });
    await housekeeping(r1);
    await refusedCheckIn(seed, r1, 'FRONT_DESK');
    expect(await bookingRow(seed.id)).toMatchObject({ status: 'HELD' });
  });

  test('nợ vượt ngưỡng: FRONT_DESK/MANAGER bị chặn, chỉ OWNER cho qua', async () => {
    // 8 đêm × 1.000.000 = 8.000.000; đã thu 2.000.000 ⇒ nợ 6.000.000 (>5.000.000 và 75%).
    const seed = await seedBooking({ nightly: 1_000_000, checkOut: day(D, 8), paid: 2_000_000 });
    await housekeeping(r2);
    await refusedCheckIn(seed, r2, 'FRONT_DESK');
    await refusedCheckIn(seed, r2, 'MANAGER');
    expect(await bookingRow(seed.id)).toMatchObject({ status: 'CONFIRMED' });

    const owner = await post(CHECK_IN, await staffToken('OWNER'), checkInBody(seed, r2));
    expect(owner.status).toBe(201);
    expect(checkInResponseSchema.parse(owner.body)).toMatchObject({
      bookingId: seed.id,
      status: 'CHECKED_IN',
      roomIds: [r2],
      earlyCheckInFee: 0,
    });
    expect(await bookingRow(seed.id)).toMatchObject({ status: 'CHECKED_IN' });
    expect(await unreleased(seed.bookingRoomId)).toHaveLength(1);
  });

  test('MANAGER cho nợ trong ngưỡng (≤5.000.000 và ≤50%) → CHECKED_IN + audit lý do/hạn thu', async () => {
    // 10 đêm × 1.000.000 = 10.000.000; đã thu 8.000.000 ⇒ nợ 2.000.000 (20%).
    const seed = await seedBooking({ nightly: 1_000_000, checkOut: day(D, 10), paid: 8_000_000 });
    await housekeeping(r3);
    const body = checkInBody(seed, r3, 'Cho nợ tới khi trả phòng');
    const desk = await post(CHECK_IN, await staffToken('FRONT_DESK'), body);
    guardRoute(desk, CHECK_IN);
    expect(desk.status).toBe(409);

    const response = await post(CHECK_IN, await staffToken('MANAGER'), body);
    expect(response.status).toBe(201);
    expect(checkInResponseSchema.parse(response.body)).toMatchObject({
      status: 'CHECKED_IN',
      roomIds: [r3],
      earlyCheckInFee: 0,
    });
    expect(await bookingRow(seed.id)).toMatchObject({ status: 'CHECKED_IN' });
    expect(
      await rows(
        `SELECT room_id,bed_no,start_date::text AS start_date,end_date::text AS end_date
         FROM room_assignments WHERE booking_room_id=$1 AND released_at IS NULL`,
        [seed.bookingRoomId],
      ),
    ).toEqual([{ room_id: r3, bed_no: 0, start_date: D, end_date: day(D, 10) }]);
    // BR-FO-01: duyệt nợ ghi số tiền, booking, người, lý do, hạn thu trong cùng transaction.
    const audits = await rows(
      `SELECT actor_id,reason,concat(coalesce(before_json::text,''),coalesce(after_json::text,'')) AS payload
       FROM audit_logs WHERE entity_type='Booking' AND entity_id=$1`,
      [seed.id],
    );
    expect(
      audits.some(
        (row) =>
          row.actor_id === userId &&
          String(row.reason ?? '').length > 0 &&
          String(row.payload).includes('2000000') &&
          String(row.payload).includes(day(D, 10)),
      ),
      'Thiếu AuditLog duyệt nợ kèm số tiền + hạn thu (BR-FO-01)',
    ).toBe(true);
    expect(await history(seed.id, 'CHECKED_IN')).toHaveLength(1);
  });

  test('từ 23:59:00 ngày nhận phòng → chặn, buộc xử lý no-show trước', async () => {
    clock.value = vn(D, '23:59:00');
    const seed = await seedBooking();
    await housekeeping(r4);
    await refusedCheckIn(seed, r4, 'FRONT_DESK');
    expect(await bookingRow(seed.id)).toMatchObject({ status: 'CONFIRMED' });
  });

  test('phòng chưa sạch: task PENDING, không có task, hoặc DONE của lượt cũ → không giao', async () => {
    const pending = await seedBooking();
    await housekeeping(r1, D, 'PENDING');
    const none = await seedBooking();
    const oldDone = await seedBooking();
    await housekeeping(r3, day(D, -1));
    await refusedCheckIn(pending, r1, 'FRONT_DESK');
    await refusedCheckIn(none, r2, 'FRONT_DESK');
    await refusedCheckIn(oldDone, r3, 'FRONT_DESK');
  });

  test('phòng còn khách cũ hoặc đang MAINTENANCE → không giao', async () => {
    const occupant = await seedBooking({ status: 'CHECKED_IN', checkIn: day(D, -1), assign: r1 });
    await housekeeping(r1);
    const incoming = await seedBooking();
    await rows("UPDATE rooms SET status='MAINTENANCE' WHERE id=$1", [r2]);
    await housekeeping(r2);
    const blocked = await seedBooking();
    await refusedCheckIn(incoming, r1, 'FRONT_DESK');
    await refusedCheckIn(blocked, r2, 'FRONT_DESK');
    expect(await bookingRow(occupant.id)).toMatchObject({ status: 'CHECKED_IN' });
  });
});

describe('HB-143 · check-out (BR-FO-03/05/06)', () => {
  test('thiếu hoặc sai pinToken → E_AUTH_PIN_REQUIRED, không giải phóng phòng', async () => {
    const seed = await seedBooking({
      status: 'CHECKED_IN',
      checkIn: day(D, -1),
      checkOut: D,
      paid: NIGHTLY,
      assign: r1,
    });
    clock.value = vn(D, '11:30:00');
    const token = await staffToken('FRONT_DESK');
    for (const body of [checkOutBody(seed), checkOutBody(seed, '0'.repeat(32))]) {
      const response = await post(CHECK_OUT, token, body);
      guardRoute(response, CHECK_OUT);
      expect(response.status).toBe(401);
      expect(errorCode(response)).toBe('E_AUTH_PIN_REQUIRED');
    }
    expect(await bookingRow(seed.id)).toMatchObject({ status: 'CHECKED_IN' });
    expect(await unreleased(seed.bookingRoomId)).toHaveLength(1);
    expect(await roomTasks(r1, D)).toEqual([]);
  });

  test('còn nợ → không hoá đơn, không giải phóng, không sinh việc dọn', async () => {
    // Nghĩa vụ ROOM 1.100.000, đã thu 900.000 ⇒ còn nợ 200.000 (BR-FO-05).
    const seed = await seedBooking({
      status: 'CHECKED_IN',
      checkIn: day(D, -1),
      checkOut: D,
      paid: 900_000,
      assign: r1,
    });
    clock.value = vn(D, '11:30:00');
    const token = await staffToken('FRONT_DESK');
    const response = await post(
      CHECK_OUT,
      token,
      checkOutBody(seed, await mintPin(token, seed.id)),
    );
    guardRoute(response, CHECK_OUT);
    // Hợp đồng §2.9 chỉ khai 409/422 cho tuyến này; bất biến là không thành công, không giải phóng.
    expect([409, 422]).toContain(response.status);
    expect(await bookingRow(seed.id)).toMatchObject({
      status: 'CHECKED_IN',
      balance_due: '200000',
    });
    expect(await unreleased(seed.bookingRoomId)).toHaveLength(1);
    expect(await roomTasks(r1, D)).toEqual([]);
    expect(
      await rows(
        `SELECT id FROM audit_logs WHERE entity_id=$1
           AND concat(coalesce(before_json::text,''),coalesce(after_json::text,'')) LIKE '%CHECKED_OUT%'`,
        [seed.id],
      ),
    ).toEqual([]);
  });

  test('thu đủ → CHECKED_OUT, giải phóng assignment, sinh HousekeepingTask ngày trả phòng', async () => {
    const seed = await seedBooking({
      status: 'CHECKED_IN',
      checkIn: day(D, -1),
      checkOut: D,
      paid: NIGHTLY,
      assign: r1,
    });
    clock.value = vn(D, '11:30:00');
    const token = await staffToken('FRONT_DESK');
    const response = await post(
      CHECK_OUT,
      token,
      checkOutBody(seed, await mintPin(token, seed.id)),
    );
    guardRoute(response, CHECK_OUT);
    expect(response.status).toBe(200);
    const body = checkOutResponseSchema.parse(response.body);
    expect(body).toMatchObject({
      bookingId: seed.id,
      status: 'CHECKED_OUT',
      extrasAmount: 0,
      feeAmount: 0,
      balanceDue: 0,
    });
    expect(body.housekeepingTaskIds).toHaveLength(1);
    expect(await bookingRow(seed.id)).toMatchObject({
      status: 'CHECKED_OUT',
      balance_due: '0',
    });

    const released = await releaseRow(seed.bookingRoomId);
    expect(released.released_at).not.toBeNull();
    expect(String(released.release_reason).length).toBeGreaterThan(0);
    const created = await roomTasks(r1, D);
    expect(created).toHaveLength(1);
    expect(created[0]!.id).toBe(body.housekeepingTaskIds[0]);
    expect(created[0]!.status).toBe('PENDING');
    expect(await history(seed.id, 'CHECKED_OUT')).toHaveLength(1);
    expect(
      await rows(
        "SELECT id FROM audit_logs WHERE entity_type='Booking' AND entity_id=$1 AND actor_id=$2",
        [seed.id, userId],
      ),
    ).not.toEqual([]);
  });

  test('phụ thu muộn TC-FO-03: trước 12:00 = 0, 12:00–18:00 = 50%, sau 18:00 = 100%', async () => {
    const tiers = [
      ['11:30:00', 0],
      ['15:00:00', NIGHTLY / 2],
      ['19:00:00', NIGHTLY],
    ] as const;
    for (const [index, [time, expected]] of tiers.entries()) {
      clock.value = vn(D, time);
      const seed = await seedBooking({
        status: 'CHECKED_IN',
        checkIn: day(D, -1),
        checkOut: D,
        paid: NIGHTLY,
        assign: [r2, r3, r4][index]!,
      });
      const token = await staffToken('FRONT_DESK');
      const response = await post(
        CHECK_OUT,
        token,
        checkOutBody(seed, await mintPin(token, seed.id)),
      );
      guardRoute(response, `${CHECK_OUT} (mốc ${time})`);
      expect(response.status, `check-out lúc ${time}`).toBe(200);
      expect(checkOutResponseSchema.parse(response.body).feeAmount, `phụ thu lúc ${time}`).toBe(
        expected,
      );
    }
  });
});

describe('HB-143 · no-show (BR-CANCEL-10)', () => {
  test('chỉ CONFIRMED chưa check-in mới ghi được; trạng thái khác trả E_BOOK_INVALID_STATE', async () => {
    const confirmed = await seedBooking();
    const others = [
      await seedBooking({ status: 'CHECKED_IN', assign: r2 }),
      await seedBooking({ status: 'CHECKED_OUT', checkIn: day(D, -1), checkOut: D }),
      await seedBooking({ status: 'CANCELLED' }),
    ];
    const token = await staffToken('FRONT_DESK');
    const ok = await post(NO_SHOW, token, { bookingId: confirmed.id, reason: 'Khách không đến' });
    guardRoute(ok, NO_SHOW);
    expect(ok.status).toBe(200);
    expect(noShowResponseSchema.parse(ok.body)).toMatchObject({
      bookingId: confirmed.id,
      status: 'NO_SHOW',
    });
    expect(await bookingRow(confirmed.id)).toMatchObject({ status: 'NO_SHOW' });
    for (const seed of others) {
      const response = await post(NO_SHOW, token, { bookingId: seed.id, reason: 'Sai trạng thái' });
      expect(response.status).toBe(409);
      expect(errorCode(response)).toBe('E_BOOK_INVALID_STATE');
      expect(await chargeIds(seed.id, 'PENALTY')).toEqual([]);
    }
  });

  test('áp bậc cuối + phụ thu đêm đầu theo snapshot; không tự thu tiền', async () => {
    // 2 đêm × 1.100.000, đã thu 300.000 ⇒ phạt = max(0, 1.100.000 − 300.000) = 800.000.
    const seed = await seedBooking({ paid: 300_000, assign: r3 });
    clock.value = vn(D, '23:59:00');
    const token = await staffToken('FRONT_DESK');
    const paymentsBefore = await paymentIds(seed.id);
    const response = await post(NO_SHOW, token, {
      bookingId: seed.id,
      reason: 'Không đến, đã quá 23:59',
    });
    guardRoute(response, NO_SHOW);
    expect(response.status).toBe(200);
    expect(noShowResponseSchema.parse(response.body)).toMatchObject({
      bookingId: seed.id,
      status: 'NO_SHOW',
      penaltyAmount: 800_000,
      refundRequestId: null,
    });
    expect(await bookingRow(seed.id)).toMatchObject({
      status: 'NO_SHOW',
      penalty_amount: '800000',
      balance_due: '800000',
    });
    expect(
      await rows("SELECT amount FROM booking_charges WHERE booking_id=$1 AND kind='PENALTY'", [
        seed.id,
      ]),
    ).toEqual([{ amount: '800000' }]);
    expect(await rows('SELECT id FROM refund_requests WHERE booking_id=$1', [seed.id])).toEqual([]);
    expect(await paymentIds(seed.id)).toEqual(paymentsBefore);
    expect((await releaseRow(seed.bookingRoomId)).released_at).not.toBeNull();
  });

  test('sau khi xác nhận no-show, chạy lại không thu thêm (TC-FO-07)', async () => {
    const seed = await seedBooking({ paid: 300_000 });
    const token = await staffToken('FRONT_DESK');
    const body = { bookingId: seed.id, reason: 'Khách không đến' };
    const first = await post(NO_SHOW, token, body);
    guardRoute(first, NO_SHOW);
    expect(first.status).toBe(200);
    const after = await bookingRow(seed.id);
    const charges = await chargeIds(seed.id);
    const payments = await paymentIds(seed.id);

    const second = await post(NO_SHOW, token, body);
    expect(second.status).toBe(409);
    expect(errorCode(second)).toBe('E_BOOK_INVALID_STATE');
    expect(await bookingRow(seed.id)).toEqual(after);
    expect(await chargeIds(seed.id)).toEqual(charges);
    expect(await paymentIds(seed.id)).toEqual(payments);
    expect(await chargeIds(seed.id, 'PENALTY')).toHaveLength(1);
  });
});

describe('HB-143 · audit cùng transaction (BR-GEN-07)', () => {
  test('check-in rollback toàn bộ khi audit không ghi được', async () => {
    const seed = await seedBooking();
    await housekeeping(r1);
    const token = await staffToken('FRONT_DESK');
    await withFailingAudit(async () => {
      const response = await post(CHECK_IN, token, checkInBody(seed, r1));
      guardRoute(response, CHECK_IN);
      expect(response.status).toBe(500);
    });
    expect(await bookingRow(seed.id)).toMatchObject({ status: 'CONFIRMED' });
    expect(await unreleased(seed.bookingRoomId)).toEqual([]);
    expect(await history(seed.id)).toEqual([]);
    expect(await completedKeys('%front-office/check-in')).toEqual([]);
  });

  test('check-out rollback toàn bộ khi audit không ghi được', async () => {
    const seed = await seedBooking({
      status: 'CHECKED_IN',
      checkIn: day(D, -1),
      checkOut: D,
      paid: NIGHTLY,
      assign: r1,
    });
    clock.value = vn(D, '11:30:00');
    const token = await staffToken('FRONT_DESK');
    const pin = await mintPin(token, seed.id);
    await withFailingAudit(async () => {
      const response = await post(CHECK_OUT, token, checkOutBody(seed, pin));
      guardRoute(response, CHECK_OUT);
      expect(response.status).toBe(500);
    });
    expect(await bookingRow(seed.id)).toMatchObject({ status: 'CHECKED_IN', balance_due: '0' });
    expect(await unreleased(seed.bookingRoomId)).toHaveLength(1);
    expect(await roomTasks(r1, D)).toEqual([]);
    expect(await completedKeys('%front-office/check-out')).toEqual([]);
  });

  test('no-show rollback toàn bộ khi audit không ghi được', async () => {
    const seed = await seedBooking({ paid: 300_000 });
    const token = await staffToken('FRONT_DESK');
    await withFailingAudit(async () => {
      const response = await post(NO_SHOW, token, {
        bookingId: seed.id,
        reason: 'Khách không đến',
      });
      guardRoute(response, NO_SHOW);
      expect(response.status).toBe(500);
    });
    expect(await bookingRow(seed.id)).toMatchObject({
      status: 'CONFIRMED',
      penalty_amount: '0',
      balance_due: '1900000',
    });
    expect(await chargeIds(seed.id, 'PENALTY')).toEqual([]);
    expect(await history(seed.id)).toEqual([]);
    expect(await completedKeys('%front-office/no-show')).toEqual([]);
  });
});
