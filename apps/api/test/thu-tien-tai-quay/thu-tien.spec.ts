/**
 * HB-096 — `POST /payments` thu tiền tại quầy (UC-PAY-01/03; BR-PAY-01,02,06; BR-RBAC-05; TC-FO-06).
 *
 * Ca chính: thu đủ cọc ⇒ `CONFIRMED` cùng transaction; chưa đủ ⇒ giữ `HELD` và `balanceDue` đúng;
 * `pinToken` thiếu/sai/sai booking ⇒ `401 E_AUTH_PIN_REQUIRED`; booking ngoài cơ sở ⇒ 403; HOUSEKEEPING
 * ⇒ 403; RESERVATION_AGENT chỉ `DEPOSIT`; audit + idempotency + phát lại cùng khoá một kết quả.
 */
import { randomUUID } from 'node:crypto';
import { expect, test } from 'vitest';
import { errorBodySchema, paymentSchema } from '@pinehill/contracts';
import {
  allocationPlan,
  dueAmount,
  isCounterType,
} from '../../src/modules/pay/counter/obligation.js';
import { obligationDue } from '../../src/modules/pay/ledger/obligation.js';
import {
  clock,
  collectRequest,
  createBooking,
  rows,
  otherPropertyId,
  otherTypeId,
  pinTokenFor,
  staffToken,
  userId,
} from './fixture.js';

const code = (response: { body: unknown }) => errorBodySchema.parse(response.body).code;

/** Khoản thu đã có từ trước (vd. khách trả trực tuyến một phần) — không tạo phân bổ. */
async function seedReceipt(bookingId: string, amount: number, type = 'DEPOSIT'): Promise<void> {
  await rows(
    `INSERT INTO payments(booking_id,type,method,amount,status,idempotency_key,paid_at,created_by)
     VALUES($1::uuid,$2,'BANK_TRANSFER',$3,'SUCCEEDED',$4,clock_timestamp(),$5::uuid)`,
    [bookingId, type, amount, randomUUID(), userId],
  );
}

test('thu đủ cọc bằng tiền mặt ⇒ CONFIRMED cùng transaction, có phân bổ + audit', async () => {
  const token = await staffToken('FRONT_DESK');
  const { booking } = await createBooking();
  expect(booking.status).toBe('HELD');
  const pinToken = await pinTokenFor(token, booking.id);

  const response = await collectRequest(
    {
      bookingId: booking.id,
      type: 'DEPOSIT',
      method: 'CASH',
      amount: booking.depositAmount,
      pinToken,
    },
    { token },
  );
  expect(response.status, JSON.stringify(response.body)).toBe(201);
  const payment = paymentSchema.parse(response.body);
  expect(payment.status).toBe('SUCCEEDED');
  expect(payment.paidAt).not.toBeNull();
  expect(payment.createdBy).toBe(userId);

  const bookingRow = (
    await rows('SELECT status, paid_amount, balance_due FROM bookings WHERE id=$1', [booking.id])
  )[0]!;
  expect(bookingRow.status).toBe('CONFIRMED');
  expect(Number(bookingRow.paid_amount)).toBe(booking.depositAmount);
  expect(Number(bookingRow.balance_due)).toBe(booking.totalAmount - booking.depositAmount);

  const allocations = (
    await rows('SELECT count(*)::int AS n FROM payment_allocations WHERE payment_id=$1', [
      payment.paymentId,
    ])
  )[0]!;
  expect(Number(allocations.n)).toBeGreaterThan(0);
  const audit = (
    await rows(
      "SELECT count(*)::int AS n FROM audit_logs WHERE action='PAYMENT_COLLECTED' AND entity_id=$1",
      [payment.paymentId],
    )
  )[0]!;
  expect(Number(audit.n)).toBe(1);
});

test('phát lại cùng Idempotency-Key trả đúng bản ghi cũ, không tạo khoản thứ hai', async () => {
  const token = await staffToken('FRONT_DESK');
  const { booking } = await createBooking();
  const pinToken = await pinTokenFor(token, booking.id);
  const key = randomUUID();
  const body = {
    bookingId: booking.id,
    type: 'DEPOSIT',
    method: 'BANK_TRANSFER',
    amount: booking.depositAmount,
    pinToken,
  };

  const first = await collectRequest(body, { token, key });
  expect(first.status).toBe(201);
  const replay = await collectRequest(body, { token, key });
  expect(replay.status).toBe(201);
  expect(replay.headers['idempotency-replayed']).toBe('true');
  expect(paymentSchema.parse(replay.body).paymentId).toBe(
    paymentSchema.parse(first.body).paymentId,
  );

  const count = (
    await rows('SELECT count(*)::int AS n FROM payments WHERE booking_id=$1', [booking.id])
  )[0]!;
  expect(Number(count.n)).toBe(1);
});

test('chưa đủ cọc ⇒ giữ HELD và balanceDue đúng; thu nốt đúng phần thiếu ⇒ CONFIRMED', async () => {
  const token = await staffToken('FRONT_DESK');
  const { booking } = await createBooking();
  const partial = Math.floor(booking.depositAmount / 3);
  await seedReceipt(booking.id, partial);

  const before = (
    await rows('SELECT status, balance_due FROM bookings WHERE id=$1', [booking.id])
  )[0]!;
  expect(before.status).toBe('HELD');
  // Sổ cái chưa có phân bổ nên toàn bộ tiền phòng còn nợ; đây là `balanceDue` đúng theo BR-PAY-02.
  expect(Number(before.balance_due)).toBe(booking.totalAmount);

  const remaining = booking.depositAmount - partial;
  const pinToken = await pinTokenFor(token, booking.id);
  const response = await collectRequest(
    { bookingId: booking.id, type: 'DEPOSIT', method: 'CASH', amount: remaining, pinToken },
    { token },
  );
  expect(response.status, JSON.stringify(response.body)).toBe(201);
  const after = (
    await rows('SELECT status, paid_amount FROM bookings WHERE id=$1', [booking.id])
  )[0]!;
  expect(after.status).toBe('CONFIRMED');
  expect(Number(after.paid_amount)).toBe(booking.depositAmount);
});

test('pinToken thiếu/sai, gắn booking khác, đã dùng ⇒ 401 E_AUTH_PIN_REQUIRED', async () => {
  const token = await staffToken('FRONT_DESK');
  const first = await createBooking();
  const second = await createBooking();

  const missing = await collectRequest(
    {
      bookingId: first.booking.id,
      type: 'DEPOSIT',
      method: 'CASH',
      amount: first.booking.depositAmount,
    },
    { token },
  );
  expect(missing.status).toBe(401);
  expect(code(missing)).toBe('E_AUTH_PIN_REQUIRED');

  const forFirst = await pinTokenFor(token, first.booking.id);
  const wrongBooking = await collectRequest(
    {
      bookingId: second.booking.id,
      type: 'DEPOSIT',
      method: 'CASH',
      amount: second.booking.depositAmount,
      pinToken: forFirst,
    },
    { token },
  );
  expect(wrongBooking.status).toBe(401);
  expect(code(wrongBooking)).toBe('E_AUTH_PIN_REQUIRED');
  const untouched = (
    await rows('SELECT count(*)::int AS n FROM payments WHERE booking_id=$1', [second.booking.id])
  )[0]!;
  expect(Number(untouched.n)).toBe(0);

  // Dùng đúng booking: lần đầu thành công (đủ cọc ⇒ CONFIRMED), token bị tiêu thụ.
  const applied = await collectRequest(
    {
      bookingId: first.booking.id,
      type: 'DEPOSIT',
      method: 'CASH',
      amount: first.booking.depositAmount,
      pinToken: forFirst,
    },
    { token },
  );
  expect(applied.status, JSON.stringify(applied.body)).toBe(201);

  // Cùng token cho khoản còn lại ⇒ bị từ chối (dùng một lần), dù tiền vẫn khớp nghĩa vụ.
  const remaining = first.booking.totalAmount - first.booking.depositAmount;
  const replayed = await collectRequest(
    {
      bookingId: first.booking.id,
      type: 'BALANCE',
      method: 'CASH',
      amount: remaining,
      pinToken: forFirst,
    },
    { token },
  );
  expect(replayed.status).toBe(401);
  expect(code(replayed)).toBe('E_AUTH_PIN_REQUIRED');
});

test('booking ngoài phạm vi cơ sở ⇒ 403; booking lạ ⇒ 404; thân sai ⇒ 400; thiếu khoá ⇒ 400', async () => {
  const token = await staffToken('FRONT_DESK');
  const foreign = await createBooking({ property: otherPropertyId, roomType: otherTypeId });
  // Token mở khoá KHÔNG gắn booking: phạm vi cơ sở phải chặn *trước* khi chạm pinToken.
  const pinToken = await pinTokenFor(token);
  const denied = await collectRequest(
    {
      bookingId: foreign.booking.id,
      type: 'DEPOSIT',
      method: 'CASH',
      amount: foreign.booking.depositAmount,
      pinToken,
    },
    { token },
  );
  expect(denied.status).toBe(403);
  expect(code(denied)).toBe('E_AUTH_OUT_OF_SCOPE');

  const unknown = await collectRequest(
    {
      bookingId: '00000000-0000-4000-8000-000000000000',
      type: 'DEPOSIT',
      method: 'CASH',
      amount: 1000,
      pinToken,
    },
    { token },
  );
  expect(unknown.status).toBe(404);

  const malformed = await collectRequest(
    { bookingId: foreign.booking.id, type: 'NOPE' },
    { token },
  );
  expect(malformed.status).toBe(400);
  expect(code(malformed)).toBe('E_GEN_VALIDATION_FAILED');

  // Thiếu `Idempotency-Key`: dùng booking **trong** phạm vi để đi qua tiền kiểm quyền rồi mới chạm
  // hợp đồng khoá chống trùng (ngoài phạm vi thì 403 đúng thứ tự trước).
  const mine = await createBooking();
  const noKey = await collectRequest(
    {
      bookingId: mine.booking.id,
      type: 'DEPOSIT',
      method: 'CASH',
      amount: mine.booking.depositAmount,
    },
    { token, key: null },
  );
  expect(noKey.status).toBe(400);
  expect(code(noKey)).toBe('E_GEN_VALIDATION_FAILED');
});

test('tiền lệch nghĩa vụ ⇒ 422 và không tạo khoản thu nào', async () => {
  const token = await staffToken('FRONT_DESK');
  const { booking } = await createBooking();
  const pinToken = await pinTokenFor(token, booking.id);
  const response = await collectRequest(
    {
      bookingId: booking.id,
      type: 'DEPOSIT',
      method: 'CASH',
      amount: booking.depositAmount + 1000,
      pinToken,
    },
    { token },
  );
  expect(response.status).toBe(422);
  expect(code(response)).toBe('E_PAY_AMOUNT_MISMATCH');
  const count = (
    await rows('SELECT count(*)::int AS n FROM payments WHERE booking_id=$1', [booking.id])
  )[0]!;
  expect(Number(count.n)).toBe(0);
});

test('HOUSEKEEPING/SYSADMIN ⇒ 403; RESERVATION_AGENT chỉ nhận cọc; ACCOUNTANT thu số dư được', async () => {
  const housekeeping = await staffToken('HOUSEKEEPING');
  const { booking: hkBooking } = await createBooking();
  const hk = await collectRequest(
    {
      bookingId: hkBooking.id,
      type: 'DEPOSIT',
      method: 'CASH',
      amount: hkBooking.depositAmount,
    },
    { token: housekeeping },
  );
  expect(hk.status).toBe(403);
  expect(code(hk)).toBe('E_RBAC_FORBIDDEN');

  const sysadmin = await staffToken('SYSADMIN', 'h029-second');
  const sys = await collectRequest(
    {
      bookingId: hkBooking.id,
      type: 'DEPOSIT',
      method: 'CASH',
      amount: hkBooking.depositAmount,
    },
    { token: sysadmin },
  );
  expect(sys.status).toBe(403);

  const agent = await staffToken('RESERVATION_AGENT');
  const { booking: agentBooking } = await createBooking();
  const agentPin = await pinTokenFor(agent, agentBooking.id);
  const deposit = await collectRequest(
    {
      bookingId: agentBooking.id,
      type: 'DEPOSIT',
      method: 'CASH',
      amount: agentBooking.depositAmount,
      pinToken: agentPin,
    },
    { token: agent },
  );
  expect(deposit.status, JSON.stringify(deposit.body)).toBe(201);
  const other = await createBooking();
  const otherPin = await pinTokenFor(agent, other.booking.id);
  const balance = await collectRequest(
    {
      bookingId: other.booking.id,
      type: 'BALANCE',
      method: 'CASH',
      amount: 1000,
      pinToken: otherPin,
    },
    { token: agent },
  );
  expect(balance.status).toBe(403);
  expect(code(balance)).toBe('E_RBAC_FORBIDDEN');

  const accountant = await staffToken('ACCOUNTANT', 'h029-second');
  const invoice = await createBooking();
  const accountantPin = await pinTokenFor(accountant, invoice.booking.id);
  const paid = await collectRequest(
    {
      bookingId: invoice.booking.id,
      type: 'DEPOSIT',
      method: 'BANK_TRANSFER',
      amount: invoice.booking.depositAmount,
      pinToken: accountantPin,
    },
    { token: accountant },
  );
  expect(paid.status, JSON.stringify(paid.body)).toBe(201);
  const remaining = invoice.booking.totalAmount - invoice.booking.depositAmount;
  const accountantPin2 = await pinTokenFor(accountant, invoice.booking.id);
  const settled = await collectRequest(
    {
      bookingId: invoice.booking.id,
      type: 'BALANCE',
      method: 'BANK_TRANSFER',
      amount: remaining,
      pinToken: accountantPin2,
    },
    { token: accountant },
  );
  expect(settled.status, JSON.stringify(settled.body)).toBe(201);
  const settledRow = await rows('SELECT balance_due FROM bookings WHERE id=$1', [
    invoice.booking.id,
  ]);
  expect(Number(settledRow[0]!.balance_due)).toBe(0);
});

test('nghĩa vụ dùng chung: cọc chặn bởi ROOM, số dư/phạt và thứ tự phân bổ', () => {
  const now = clock.now();
  const base = {
    status: 'HELD',
    depositAmount: 907_000n,
    depositPaid: 800_000n,
    balanceDue: 1_000_000n,
    holdExpiresAt: new Date(now.getTime() + 60_000),
    now,
    outstanding: [
      { id: 'b', kind: 'PENALTY', outstanding: 93_000n },
      { id: 'a', kind: 'ROOM', outstanding: 907_000n },
    ],
  };
  expect(dueAmount('DEPOSIT', base)).toBe(107_000n);
  expect(dueAmount('BALANCE', base)).toBe(1_000_000n);
  expect(dueAmount('PENALTY', base)).toBe(93_000n);

  // Ca chốt P2-4: thiếu cọc 500.000 nhưng nghĩa vụ ROOM chỉ còn 400.000 ⇒ trả 400.000, và **bằng đúng**
  // kết quả của hàm chung `obligationDue` mà đường trực tuyến HB-094 dùng (một công thức, không lệch).
  const capped = {
    ...base,
    depositAmount: 1_000_000n,
    depositPaid: 500_000n,
    outstanding: [{ id: 'a', kind: 'ROOM', outstanding: 400_000n }],
  };
  expect(dueAmount('DEPOSIT', capped)).toBe(400_000n);
  expect(dueAmount('DEPOSIT', capped)).toBe(
    obligationDue(
      {
        status: 'HELD',
        depositAmount: 1_000_000n,
        depositPaid: 500_000n,
        balanceDue: 400_000n,
        roomOutstanding: 400_000n,
        holdExpiresAt: base.holdExpiresAt,
        now,
      },
      'DEPOSIT',
    ),
  );

  // Hết hạn hold hoặc đã qua giai đoạn trước xác nhận ⇒ không còn nghĩa vụ cọc.
  expect(dueAmount('DEPOSIT', { ...base, holdExpiresAt: new Date(now.getTime() - 1) })).toBe(0n);
  expect(dueAmount('DEPOSIT', { ...base, status: 'CONFIRMED' })).toBe(0n);

  expect(allocationPlan('BALANCE', 1_000_000n, base)).toEqual([
    { chargeId: 'a', amount: 907_000n },
    { chargeId: 'b', amount: 93_000n },
  ]);
  expect(allocationPlan('PENALTY', 93_000n, base)).toEqual([{ chargeId: 'b', amount: 93_000n }]);
  expect(isCounterType('REFUND')).toBe(false);
  expect(isCounterType('BALANCE')).toBe(true);
});
