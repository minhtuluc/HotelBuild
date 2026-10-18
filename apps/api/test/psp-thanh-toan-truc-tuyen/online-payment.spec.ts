/**
 * HB-094 — `POST /payments/online` trên app thật + PostgreSQL 16 + Redis (DB `/6`).
 *
 * Tiêu chí nghiệm thu của ticket:
 * - AC1: `orderRef` bền gắn booking + khoản; số tiền = nghĩa vụ hiện tại (cọc/số dư) đọc từ sổ cái;
 *   lệch ⇒ `422 E_PAY_AMOUNT_MISMATCH` (BR-PAY-01/02).
 * - AC2: bắt đầu thanh toán **không** gia hạn hold; hold hết hạn ⇒ không còn cọc để khởi tạo
 *   (BR-BOOK-18 — tiền thu muộn đi vào đường hoàn của HB-095).
 * - AC3/AC4: `payments` `PENDING` + audit trong **cùng** transaction, lệnh hỏng không để lại vết;
 *   idempotency phát lại đúng phản hồi; không có chỗ nào nhận dữ liệu thẻ (BR-PAY-04).
 */
import { expect, test } from 'vitest';
import { paymentSchema } from '@pinehill/contracts';

import {
  createBooking,
  guestToken,
  otherGuestToken,
  otherPropertyId,
  onlineBody,
  onlineRequest,
  rows,
  seedBooking,
  staffToken,
  userId,
} from './fixture.js';
import { codeOf, nextKey, paymentRow } from './shared.js';

/** Booking chuẩn của fixture: giá và cọc do engine/seed trả, test không tự tính lại (BR-RATE-17). */
async function createdBooking() {
  const { booking } = await createBooking(
    { fullName: 'HB-094 Guest', phone: '0900000094' },
    guestToken,
  );
  return booking;
}

test('AC1: khởi tạo cọc đúng nghĩa vụ ⇒ Payment PENDING, URL có đúng thuật toán ×100, orderRef = Idempotency-Key', async () => {
  const booking = await createdBooking();
  const key = nextKey();
  const response = await onlineRequest(onlineBody(booking.id, { amount: booking.depositAmount }), {
    key,
  });
  expect(response.status, JSON.stringify(response.body)).toBe(201);
  const payment = paymentSchema.parse(response.body);
  expect(payment).toMatchObject({
    bookingId: booking.id,
    type: 'DEPOSIT',
    method: 'VNPAY',
    amount: booking.depositAmount,
    status: 'PENDING',
    providerTxnId: null,
  });
  expect(Number(booking.depositAmount)).toBeGreaterThan(0);
  expect(Date.parse(payment.expiresAt!) - Date.parse(payment.createdAt)).toBe(900_000);
  const url = new URL(payment.paymentUrl!);
  expect(url.origin).toBe('https://sandbox.vnpayment.vn');
  expect(url.searchParams.get('vnp_Amount')).toBe(String(Number(booking.depositAmount) * 100));
  expect(url.searchParams.get('vnp_SecureHash')).toBeTruthy();
  expect(url.searchParams.get('cardNumber')).toBeNull();
  // `orderRef` bền = chính khoá chống trùng của lệnh (BR-PAY-03 đối chiếu callback bằng khoá này).
  expect(
    await rows(
      'SELECT idempotency_key, provider_txn_id, status, amount::text AS amount FROM payments WHERE id=$1::uuid',
      [payment.paymentId],
    ),
  ).toEqual([
    {
      idempotency_key: key,
      provider_txn_id: null,
      status: 'PENDING',
      amount: String(booking.depositAmount),
    },
  ]);
  expect(
    await rows(
      'SELECT action, entity_type FROM audit_logs WHERE entity_id=$1::uuid AND entity_type=$2',
      [payment.paymentId, 'Payment'],
    ),
  ).toEqual([{ action: 'PAYMENT_ONLINE_INITIATED', entity_type: 'Payment' }]);
});

test('AC1: số tiền lệch nghĩa vụ ⇒ 422 E_PAY_AMOUNT_MISMATCH, không phát sinh Payment/audit/idempotency rác', async () => {
  const booking = await createdBooking();
  for (const amount of [booking.depositAmount - 1000, booking.depositAmount + 1000]) {
    const response = await onlineRequest(onlineBody(booking.id, { amount }));
    expect(response.status, JSON.stringify(response.body)).toBe(422);
    expect(codeOf(response.body)).toBe('E_PAY_AMOUNT_MISMATCH');
  }
  expect(await rows('SELECT 1 FROM payments WHERE booking_id=$1::uuid', [booking.id])).toEqual([]);
  expect(
    await rows(
      'SELECT 1 FROM audit_logs WHERE action=$1 AND entity_id IN (SELECT id FROM payments WHERE booking_id=$2::uuid)',
      ['PAYMENT_ONLINE_INITIATED', booking.id],
    ),
  ).toEqual([]);
});

test('AC1/BR-PAY-02: nghĩa vụ BALANCE đọc từ sổ cái — cọc chưa đủ không được', async () => {
  const booking = await createdBooking();
  const bad = await onlineRequest(
    onlineBody(booking.id, { type: 'BALANCE', amount: booking.depositAmount }),
  );
  expect(bad.status, JSON.stringify(bad.body)).toBe(422);
  expect(codeOf(bad.body)).toBe('E_PAY_AMOUNT_MISMATCH');
});

test('AC2: hold đã hết hạn theo giờ CSDL ⇒ không còn nghĩa vụ cọc để khởi tạo', async () => {
  const booking = await createdBooking();
  await rows(
    `UPDATE bookings SET hold_expires_at=clock_timestamp() - interval '1 minute' WHERE id=$1::uuid`,
    [booking.id],
  );
  const response = await onlineRequest(onlineBody(booking.id, { amount: booking.depositAmount }));
  expect(response.status).toBe(422);
  expect(codeOf(response.body)).toBe('E_PAY_AMOUNT_MISMATCH');
  const row = (
    await rows(
      'SELECT EXTRACT(EPOCH FROM (clock_timestamp() - hold_expires_at))::int AS overdue_s FROM bookings WHERE id=$1::uuid',
      [booking.id],
    )
  )[0];
  // Job hết hạn (HB-078) mới là bên kết thúc hold — lệnh chỉ bị từ chối, không đụng hold (AC2).
  expect(typeof row?.overdue_s).toBe('number');
  expect(row?.overdue_s).toBeGreaterThan(0);
});

test('AC3: cùng Idempotency-Key, cùng thân ⇒ phát lại đúng Payment cũ; khác thân ⇒ 409', async () => {
  const booking = await createdBooking();
  const key = nextKey();
  const first = await onlineRequest(onlineBody(booking.id, { amount: booking.depositAmount }), {
    key,
  });
  expect(first.status).toBe(201);
  const firstPayment = paymentSchema.parse(first.body);
  const replay = await onlineRequest(onlineBody(booking.id, { amount: booking.depositAmount }), {
    key,
  });
  expect(replay.status).toBe(201);
  expect(replay.headers['idempotency-replayed']).toBe('true');
  expect(paymentSchema.parse(replay.body).paymentId).toBe(firstPayment.paymentId);
  // Cùng khoá, khác thân lệnh: từ chối 409 theo BR-GEN-08, không phát sinh Payment thứ hai.
  const conflicting = await onlineRequest(
    onlineBody(booking.id, { method: 'MOMO', amount: booking.depositAmount }),
    { key },
  );
  expect(conflicting.status).toBe(409);
  expect(codeOf(conflicting.body)).toBe('E_SYS_IDEMPOTENCY_KEY_REUSED');
  expect(await rows('SELECT 1 FROM payments WHERE booking_id=$1::uuid', [booking.id])).toHaveLength(
    1,
  );
});

test('AC4: trường thẻ với loại/phương thức ngoài hai tuyến trực tuyến bị từ chối', async () => {
  const booking = await createdBooking();
  const forbiddenBodies = [
    { cardNumber: '4242424242424242' },
    { method: 'CASH' },
    { type: 'REFUND' },
    { type: 'COMPENSATION' },
  ];
  for (const overrides of forbiddenBodies) {
    const response = await onlineRequest(
      onlineBody(booking.id, { amount: booking.depositAmount, ...overrides }),
    );
    expect(response.status, JSON.stringify(overrides)).toBe(400);
    expect(codeOf(response.body)).toBe('E_GEN_VALIDATION_FAILED');
  }
  expect(await rows('SELECT 1 FROM payments WHERE booking_id=$1::uuid', [booking.id])).toEqual([]);
});

test('AC2/BR-PAY-11: booking kết thúc không khởi tạo thanh toán', async () => {
  for (const status of ['CANCELLED', 'CHECKED_OUT', 'NO_SHOW', 'EXPIRED'] as const) {
    const bookingId = await seedBooking({ status });
    const response = await onlineRequest(onlineBody(bookingId, { amount: 300000 }));
    expect(response.status, status).toBe(409);
    expect(codeOf(response.body)).toBe('E_BOOK_INVALID_STATE');
    expect(await rows('SELECT 1 FROM payments WHERE booking_id=$1::uuid', [bookingId])).toEqual([]);
  }
});

test('AC1: khách chỉ thanh toán cho booking của mình; khác khách ⇒ 404 không lộ tài nguyên', async () => {
  const booking = await createdBooking();
  const response = await onlineRequest(onlineBody(booking.id, { amount: booking.depositAmount }), {
    token: otherGuestToken,
  });
  expect(response.status).toBe(404);
  expect(codeOf(response.body)).toBe('E_GEN_NOT_FOUND');
  expect(await rows('SELECT 1 FROM payments WHERE booking_id=$1::uuid', [booking.id])).toEqual([]);
});

test('AC1: thiếu Bearer ⇒ 401; nhân viên ngoài phạm vi cơ sở ⇒ 403', async () => {
  const booking = await createdBooking();
  const anonymous = await onlineRequest(onlineBody(booking.id, { amount: booking.depositAmount }), {
    token: null,
  });
  expect(anonymous.status).toBe(401);
  expect(codeOf(anonymous.body)).toBe('E_AUTH_INVALID_CREDENTIALS');
  const outsiderId = await seedBooking({ property: otherPropertyId });
  const outsider = await onlineRequest(onlineBody(outsiderId, { amount: 300000 }), {
    token: await staffToken('FRONT_DESK'),
  });
  expect(outsider.status).toBe(403);
  expect(codeOf(outsider.body)).toBe('E_AUTH_OUT_OF_SCOPE');
  expect(await rows('SELECT 1 FROM payments WHERE booking_id=$1::uuid', [outsiderId])).toEqual([]);
});

test('AC1: nhân viên đúng cơ sở được khởi tạo, ghi `created_by` để đối soát (BR-PAY-06)', async () => {
  const booking = await createdBooking();
  const response = await onlineRequest(onlineBody(booking.id, { amount: booking.depositAmount }), {
    token: await staffToken('MANAGER'),
  });
  expect(response.status).toBe(201);
  const payment = paymentSchema.parse(response.body);
  expect((await paymentRow(payment.paymentId)).created_by).toBe(userId);
});
