/**
 * HB-209 — xem trước tiền no-show và trả phòng (api.md §2.9; BR-CANCEL-06/10, BR-FO-02/03/05; TD-28).
 * Năm tiêu chí của ticket: (1) dùng cùng engine với lệnh ghi, (2) không để lại dấu vết ghi, (3) số xem
 * trước = số lệnh ghi trả ngay sau đó, (4) cùng mã lỗi/RBAC, (5) oracle tuyến mới ở `rbac/`.
 */
import { describe, expect, test } from 'vitest';
import {
  checkOutPreviewSchema,
  noShowPreviewSchema,
  noShowResponseSchema,
} from '@pinehill/contracts';
import {
  CHECK_OUT,
  CHECK_OUT_PREVIEW,
  D,
  NIGHTLY,
  NO_SHOW,
  NO_SHOW_PREVIEW,
  bookingRow,
  chargeIds,
  checkedIn,
  clock,
  day,
  errorCode,
  http,
  mintPin,
  post,
  r1,
  rows,
  seedBooking,
  staffToken,
  vn,
} from './fixture.js';

/** Mọi bảng mà lệnh ghi no-show/trả phòng chạm tới; preview không được làm đổi bảng nào. */
async function footprint() {
  return (
    await rows(`SELECT
      (SELECT count(*) FROM bookings)::text AS bookings,
      (SELECT coalesce(sum(version),0) FROM bookings)::text AS versions,
      (SELECT string_agg(id::text||status||balance_due||penalty_amount, ',' ORDER BY id) FROM bookings) AS states,
      (SELECT count(*) FROM payments)::text AS payments,
      (SELECT count(*) FROM booking_charges)::text AS charges,
      (SELECT coalesce(sum(amount - voided_amount),0) FROM booking_charges)::text AS charge_total,
      (SELECT count(*) FROM audit_logs)::text AS audits,
      (SELECT count(*) FROM outbox_events)::text AS outbox,
      (SELECT count(*) FROM booking_status_history)::text AS history,
      (SELECT count(*) FROM room_assignments WHERE released_at IS NULL)::text AS live_assignments,
      (SELECT count(*) FROM refund_requests)::text AS refunds,
      (SELECT count(*) FROM housekeeping_tasks)::text AS tasks,
      (SELECT count(*) FROM idempotency_keys)::text AS idempotency`)
  )[0];
}

/** Gọi tuyến xem trước: không `Idempotency-Key`, không PIN (không ghi, không tiền ra). */
const preview = (path: string, token: string, body: object) =>
  http().post(path).set('Authorization', `Bearer ${token}`).send(body);

const noShowBody = (id: string) => ({ bookingId: id });
const checkOutPreviewBody = (id: string, over: object = {}) => ({
  bookingId: id,
  lateCheckOut: true,
  earlyCheckOut: false,
  ...over,
});

describe('HB-209 AC3 — no-show: số xem trước = số lệnh ghi trả', () => {
  test('trước 23:59: có số, có mốc markableFrom; sau mốc lệnh ghi trả đúng số đó', async () => {
    clock.value = vn(D, '20:00:00');
    const token = await staffToken('FRONT_DESK');
    const seed = await seedBooking({ status: 'CONFIRMED', assign: r1 });

    const before = await preview(NO_SHOW_PREVIEW, token, noShowBody(seed.id));
    expect(before.status).toBe(200);
    const shown = noShowPreviewSchema.parse(before.body);
    expect(shown).toMatchObject({
      bookingId: seed.id,
      penaltyAmount: NIGHTLY,
      expectedRefundAmount: 0,
      markableFrom: new Date(vn(D, '23:59:00')).toISOString(),
      computedAt: new Date(clock.value).toISOString(),
    });

    // Lệnh ghi trước mốc vẫn bị từ chối (preview không nới luật 23:59, BR-FO-02).
    const early = await post(NO_SHOW, token, { bookingId: seed.id, reason: 'Khách không đến' });
    expect(early.status).toBe(409);

    clock.value = vn(D, '23:59:30');
    const written = await post(NO_SHOW, await staffToken('FRONT_DESK'), {
      bookingId: seed.id,
      reason: 'Khách không đến',
    });
    expect(written.status).toBe(200);
    expect(noShowResponseSchema.parse(written.body).penaltyAmount).toBe(shown.penaltyAmount);
  });

  test('sau mốc 23:59 cùng đồng hồ: preview rồi lệnh ghi cho cùng penaltyAmount, kể cả đã thu một phần', async () => {
    clock.value = vn(D, '23:59:30');
    const token = await staffToken('FRONT_DESK');
    const seed = await seedBooking({ status: 'CONFIRMED', paid: 500_000, assign: r1 });

    const response = await preview(NO_SHOW_PREVIEW, token, noShowBody(seed.id));
    expect(response.status).toBe(200);
    const shown = noShowPreviewSchema.parse(response.body);
    // BR-CANCEL-06: penaltyAmount = max(0, giá đêm đầu − đã thu).
    expect(shown.penaltyAmount).toBe(NIGHTLY - 500_000);

    const written = await post(NO_SHOW, token, { bookingId: seed.id, reason: 'Khách không đến' });
    expect(written.status).toBe(200);
    const result = noShowResponseSchema.parse(written.body);
    expect(result.penaltyAmount).toBe(shown.penaltyAmount);
    expect(result.refundRequestId).toBeNull();
    expect(shown.expectedRefundAmount).toBe(0);
  });

  test('đã thu đủ đêm đầu: phạt 0', async () => {
    clock.value = vn(D, '23:59:30');
    const token = await staffToken('FRONT_DESK');
    const seed = await seedBooking({ status: 'CONFIRMED', paid: NIGHTLY, assign: r1 });
    const response = await preview(NO_SHOW_PREVIEW, token, noShowBody(seed.id));
    expect(response.status).toBe(200);
    expect(noShowPreviewSchema.parse(response.body).penaltyAmount).toBe(0);
  });
});

describe('HB-209 AC3 — trả phòng: số xem trước = số lệnh ghi sổ', () => {
  test.each([
    ['11:00:00', 0],
    ['13:00:00', NIGHTLY / 2],
    ['19:00:00', NIGHTLY],
  ] as const)('%s ⇒ phụ thu %s khớp khoản nợ lệnh ghi để lại', async (time, fee) => {
    clock.value = vn(D, time);
    const token = await staffToken('FRONT_DESK');
    const seed = await checkedIn(r1);

    const response = await preview(CHECK_OUT_PREVIEW, token, checkOutPreviewBody(seed.id));
    expect(response.status).toBe(200);
    const shown = checkOutPreviewSchema.parse(response.body);
    expect(shown).toMatchObject({
      bookingId: seed.id,
      feeAmount: fee,
      extrasAmount: 0,
      balanceDue: fee,
      computedAt: new Date(clock.value).toISOString(),
    });

    const written = await post(CHECK_OUT, token, {
      ...checkOutPreviewBody(seed.id),
      pinToken: await mintPin(token, seed.id),
    });
    if (fee === 0) {
      expect(written.status).toBe(200);
      expect(written.body).toMatchObject({ feeAmount: shown.feeAmount, balanceDue: 0 });
    } else {
      // Còn phải thu: lệnh ghi từ chối nhưng GHI nghĩa vụ — chính khoản đó là số đã xem trước.
      expect(written.status).toBe(422);
      const booked = await bookingRow(seed.id);
      expect(Number(booked.balance_due)).toBe(shown.balanceDue);
    }
  });

  test('có phát sinh: extrasAmount gộp theo (mô tả, đơn giá), balanceDue = phụ thu + phát sinh', async () => {
    clock.value = vn(D, '13:00:00');
    const token = await staffToken('FRONT_DESK');
    const seed = await checkedIn(r1);
    const extras = [
      { description: 'Minibar', amount: 120_000, quantity: 2 },
      { description: 'Minibar', amount: 120_000 },
      { description: 'Giặt ủi', amount: 90_000 },
    ];
    const response = await preview(
      CHECK_OUT_PREVIEW,
      token,
      checkOutPreviewBody(seed.id, { extras }),
    );
    expect(response.status).toBe(200);
    const shown = checkOutPreviewSchema.parse(response.body);
    expect(shown.extrasAmount).toBe(120_000 * 3 + 90_000);
    expect(shown.feeAmount).toBe(NIGHTLY / 2);
    expect(shown.balanceDue).toBe(shown.feeAmount + shown.extrasAmount);

    const written = await post(CHECK_OUT, token, {
      ...checkOutPreviewBody(seed.id, { extras }),
      pinToken: await mintPin(token, seed.id),
    });
    expect(written.status).toBe(422);
    expect(Number((await bookingRow(seed.id)).balance_due)).toBe(shown.balanceDue);
  });

  test('phụ thu đã ghi ở lần trước được thay (không cộng dồn) khi mốc giờ lên bậc', async () => {
    clock.value = vn(D, '13:00:00');
    const token = await staffToken('FRONT_DESK');
    const seed = await checkedIn(r1);
    const first = await post(CHECK_OUT, token, {
      ...checkOutPreviewBody(seed.id),
      pinToken: await mintPin(token, seed.id),
    });
    expect(first.status).toBe(422);

    clock.value = vn(D, '19:00:00');
    const later = await staffToken('FRONT_DESK');
    const response = await preview(CHECK_OUT_PREVIEW, later, checkOutPreviewBody(seed.id));
    expect(response.status).toBe(200);
    const shown = checkOutPreviewSchema.parse(response.body);
    expect(shown.feeAmount).toBe(NIGHTLY);
    expect(shown.balanceDue).toBe(NIGHTLY);

    const second = await post(CHECK_OUT, later, {
      ...checkOutPreviewBody(seed.id),
      pinToken: await mintPin(later, seed.id),
    });
    expect(second.status).toBe(422);
    expect(Number((await bookingRow(seed.id)).balance_due)).toBe(shown.balanceDue);
  });

  test('trả sớm: không phụ thu, số dư không thêm nợ; lệnh ghi hoàn tất với cùng số', async () => {
    clock.value = vn(D, '10:00:00');
    const token = await staffToken('FRONT_DESK');
    const seed = await seedBooking({
      status: 'CHECKED_IN',
      checkIn: day(D, -1),
      checkOut: day(D, 2),
      paid: NIGHTLY * 3,
      assign: r1,
    });
    const body = checkOutPreviewBody(seed.id, { lateCheckOut: false, earlyCheckOut: true });
    const response = await preview(CHECK_OUT_PREVIEW, token, body);
    expect(response.status).toBe(200);
    const shown = checkOutPreviewSchema.parse(response.body);
    expect(shown).toMatchObject({ feeAmount: 0, extrasAmount: 0, balanceDue: 0 });

    const written = await post(CHECK_OUT, token, {
      ...body,
      pinToken: await mintPin(token, seed.id),
    });
    expect(written.status).toBe(200);
    expect(written.body).toMatchObject({
      feeAmount: shown.feeAmount,
      balanceDue: shown.balanceDue,
    });
  });
});

describe('HB-209 AC2 — không để lại dấu vết ghi', () => {
  test('no-show preview: mọi bảng giữ nguyên, không tạo khoá idempotency', async () => {
    clock.value = vn(D, '23:59:30');
    const token = await staffToken('FRONT_DESK');
    const seed = await seedBooking({ status: 'CONFIRMED', assign: r1 });
    const before = await footprint();
    const response = await preview(NO_SHOW_PREVIEW, token, noShowBody(seed.id));
    expect(response.status).toBe(200);
    expect(await footprint()).toEqual(before);
  });

  test('trả phòng preview: không ghi nghĩa vụ, không cập nhật số dư, không audit/outbox', async () => {
    clock.value = vn(D, '19:00:00');
    const token = await staffToken('FRONT_DESK');
    const seed = await checkedIn(r1);
    const before = await footprint();
    const chargesBefore = await chargeIds(seed.id);
    const response = await preview(
      CHECK_OUT_PREVIEW,
      token,
      checkOutPreviewBody(seed.id, { extras: [{ description: 'Minibar', amount: 50_000 }] }),
    );
    expect(response.status).toBe(200);
    expect(await footprint()).toEqual(before);
    expect(await chargeIds(seed.id)).toEqual(chargesBefore);
  });

  test('trả sớm preview cũng không void đêm chưa ở, không tạo yêu cầu hoàn', async () => {
    clock.value = vn(D, '10:00:00');
    const token = await staffToken('FRONT_DESK');
    const seed = await seedBooking({
      status: 'CHECKED_IN',
      checkIn: day(D, -1),
      checkOut: day(D, 2),
      paid: NIGHTLY * 3,
      assign: r1,
    });
    const before = await footprint();
    const response = await preview(
      CHECK_OUT_PREVIEW,
      token,
      checkOutPreviewBody(seed.id, { lateCheckOut: false, earlyCheckOut: true }),
    );
    expect(response.status).toBe(200);
    expect(await footprint()).toEqual(before);
  });

  test('preview không cần PIN và không cần Idempotency-Key', async () => {
    const token = await staffToken('FRONT_DESK');
    const seed = await checkedIn(r1);
    const response = await preview(CHECK_OUT_PREVIEW, token, checkOutPreviewBody(seed.id));
    expect(response.status).toBe(200);
    expect(response.headers['cache-control']).toBe('no-store');
  });
});

describe('HB-209 AC4 — cùng mã lỗi và RBAC với lệnh ghi', () => {
  test('no-show: chỉ FRONT_DESK; vai trò khác 403', async () => {
    const seed = await seedBooking({ status: 'CONFIRMED', assign: r1 });
    clock.value = vn(D, '23:59:30');
    for (const role of ['MANAGER', 'OWNER', 'HOUSEKEEPING', 'RESERVATION_AGENT']) {
      const response = await preview(NO_SHOW_PREVIEW, await staffToken(role), noShowBody(seed.id));
      expect(response.status, role).toBe(403);
    }
    const ok = await preview(NO_SHOW_PREVIEW, await staffToken('FRONT_DESK'), noShowBody(seed.id));
    expect(ok.status).toBe(200);
  });

  test('trả phòng: FRONT_DESK/MANAGER/OWNER được, HOUSEKEEPING/RESERVATION_AGENT 403', async () => {
    const seed = await checkedIn(r1);
    for (const role of ['FRONT_DESK', 'MANAGER', 'OWNER']) {
      const response = await preview(
        CHECK_OUT_PREVIEW,
        await staffToken(role),
        checkOutPreviewBody(seed.id),
      );
      expect(response.status, role).toBe(200);
    }
    for (const role of ['HOUSEKEEPING', 'RESERVATION_AGENT']) {
      const response = await preview(
        CHECK_OUT_PREVIEW,
        await staffToken(role),
        checkOutPreviewBody(seed.id),
      );
      expect(response.status, role).toBe(403);
    }
  });

  test('chưa đăng nhập 401 cho cả hai tuyến', async () => {
    const seed = await checkedIn(r1);
    expect((await http().post(NO_SHOW_PREVIEW).send(noShowBody(seed.id))).status).toBe(401);
    expect((await http().post(CHECK_OUT_PREVIEW).send(checkOutPreviewBody(seed.id))).status).toBe(
      401,
    );
  });

  test('sai trạng thái: no-show cần CONFIRMED, trả phòng cần CHECKED_IN ⇒ 409 E_BOOK_INVALID_STATE', async () => {
    const token = await staffToken('FRONT_DESK');
    const stayed = await checkedIn(r1);
    const noShow = await preview(NO_SHOW_PREVIEW, token, noShowBody(stayed.id));
    expect(noShow.status).toBe(409);
    expect(errorCode(noShow)).toBe('E_BOOK_INVALID_STATE');

    const confirmed = await seedBooking({ status: 'CONFIRMED' });
    const checkOut = await preview(CHECK_OUT_PREVIEW, token, checkOutPreviewBody(confirmed.id));
    expect(checkOut.status).toBe(409);
    expect(errorCode(checkOut)).toBe('E_BOOK_INVALID_STATE');
  });

  test('cờ earlyCheckOut không khớp ngày thực tế ⇒ 409 như lệnh ghi', async () => {
    clock.value = vn(D, '13:00:00');
    const token = await staffToken('FRONT_DESK');
    const seed = await checkedIn(r1);
    const response = await preview(
      CHECK_OUT_PREVIEW,
      token,
      checkOutPreviewBody(seed.id, { lateCheckOut: false, earlyCheckOut: true }),
    );
    expect(response.status).toBe(409);
    expect(errorCode(response)).toBe('E_BOOK_INVALID_STATE');
  });

  test('booking không tồn tại ⇒ 404; thân lệnh sai ⇒ 400', async () => {
    const token = await staffToken('FRONT_DESK');
    const unknown = '00000000-0000-4000-8000-000000000999';
    expect((await preview(NO_SHOW_PREVIEW, token, noShowBody(unknown))).status).toBe(404);
    expect((await preview(CHECK_OUT_PREVIEW, token, checkOutPreviewBody(unknown))).status).toBe(
      404,
    );
    expect((await preview(NO_SHOW_PREVIEW, token, { bookingId: 'x', extra: 1 })).status).toBe(400);
    expect((await preview(CHECK_OUT_PREVIEW, token, { bookingId: unknown })).status).toBe(400);
  });
});
