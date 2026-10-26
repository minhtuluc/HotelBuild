/**
 * Fixture HB-211 — dùng lại app/CSDL/Redis của `huy-booking` (booking nhiều phòng dựng bằng SQL, huỷ qua
 * HTTP thật), thêm hai đường ghi `payment_allocations` thật:
 * - `receiveOnline` gọi thẳng `applyVerifiedEvent` (webhook PSP) trong transaction thật;
 * - `collectAtCounter` gọi `POST /payments` với PIN (lệnh thu tại quầy).
 */
import { randomUUID } from 'node:crypto';
import { expect } from 'vitest';
import { pinTokenSchema } from '@pinehill/contracts';
import type { ActorContext } from '../../src/common/actor/actor-context.js';
import { AuditWriter } from '../../src/infrastructure/audit/audit-writer.js';
import { BookingLedger } from '../../src/modules/pay/ledger/service.js';
import type { PspMethod } from '../../src/modules/pay/psp/port.js';
import { applyVerifiedEvent } from '../../src/modules/pay/webhooks/apply.js';
import { password } from '../idempotency/database.js';
import { clock, db, http, rows } from '../huy-booking/fixture.js';

export { roomId, room2Id } from '../huy-booking/fixture.js';
export {
  booking,
  bookingRow,
  cancel,
  clock,
  db,
  guestCancel,
  http,
  login,
  pay,
  preview,
  refundRequests,
  rows,
} from '../huy-booking/fixture.js';

/** Tác nhân hệ thống của webhook PSP — không PII, đúng vai trò `SYSTEM` (BR-PAY-04). */
const SYSTEM: ActorContext = {
  id: null,
  role: 'SYSTEM',
  ip: null,
  correlationId: 'hb211-test',
};

/** BookingRoom theo thứ tự id — thứ tự mà allocator và engine cùng dùng. */
export async function roomIds(bookingId: string): Promise<string[]> {
  const result = await rows('SELECT id FROM booking_rooms WHERE booking_id=$1 ORDER BY id', [
    bookingId,
  ]);
  return result.map((row) => String(row.id));
}

/** Phân bổ đang hoạt động của một khoản thu, gộp theo phòng (đọc như `refundBase`). */
export async function allocatedByRoom(
  paymentId: string,
): Promise<{ room: string; amount: string }[]> {
  return (
    await rows(
      `SELECT c.booking_room_id AS room, coalesce(sum(a.amount), 0)::text AS amount
         FROM payment_allocations a JOIN booking_charges c ON c.id = a.charge_id
        WHERE a.payment_id=$1::uuid
        GROUP BY c.booking_room_id
        ORDER BY c.booking_room_id`,
      [paymentId],
    )
  ).map((row) => ({ room: String(row.room), amount: String(row.amount) }));
}

/** Ảnh chụp các dòng phân bổ (id + số tiền) để chứng minh bất biến khi có khoản thu mới. */
export async function allocationRows(bookingId: string) {
  return rows(
    `SELECT a.id, a.payment_id, a.charge_id, a.amount::text AS amount, a.released_amount::text AS released
       FROM payment_allocations a JOIN booking_charges c ON c.id = a.charge_id
      WHERE c.booking_id=$1::uuid
      ORDER BY a.id`,
    [bookingId],
  );
}

/**
 * Nhận một khoản thu trực tuyến qua **đúng webhook PSP** (`applyVerifiedEvent`): tạo Payment PENDING với
 * `orderRef`, rồi áp sự kiện SUCCEEDED trong transaction thật. Trả `paymentId`.
 */
export async function receiveOnline(
  bookingId: string,
  amount: bigint,
  method: PspMethod = 'VNPAY',
  type = 'DEPOSIT',
): Promise<string> {
  const orderRef = randomUUID();
  const paymentId = String(
    (
      await rows(
        `INSERT INTO payments(booking_id,type,method,amount,status,idempotency_key)
         VALUES($1::uuid,$2,$3,$4,'PENDING',$5) RETURNING id`,
        [bookingId, type, method, amount.toString(), orderRef],
      )
    )[0]!.id,
  );
  await db.$transaction(async (tx) => {
    const outcome = await applyVerifiedEvent(tx, new BookingLedger(clock), new AuditWriter(clock), {
      method,
      eventId: orderRef,
      orderRef,
      providerTxnId: `TXN-${randomUUID()}`,
      amount,
      outcome: 'SUCCEEDED',
      paidAt: clock.now(),
      now: clock.now(),
      actor: SYSTEM,
    });
    expect(outcome.decision).toBe('APPLIED');
  });
  return paymentId;
}

/** Mở một `pinToken` cho đúng booking qua API thật (đặt PIN nếu chưa có). */
export async function pinTokenFor(token: string, bookingId: string): Promise<string> {
  const saved = await http()
    .put('/api/v1/auth/pin')
    .set('Authorization', `Bearer ${token}`)
    .send({ pin: '123456', currentPassword: password });
  expect(saved.status, JSON.stringify(saved.body)).toBe(204);
  const opened = await http()
    .post('/api/v1/auth/pin/verify')
    .set('Authorization', `Bearer ${token}`)
    .send({ pin: '123456', bookingId });
  expect(opened.status, JSON.stringify(opened.body)).toBe(200);
  return pinTokenSchema.parse(opened.body).pinToken;
}

/** Lệnh thu tại quầy thật (`POST /payments`) — trả nguyên response để test tự khẳng định. */
export async function collectAtCounter(
  token: string,
  body: { bookingId: string; type: 'DEPOSIT' | 'BALANCE'; amount: number },
): Promise<{ status: number; body: unknown }> {
  const pinToken = await pinTokenFor(token, body.bookingId);
  const response = await http()
    .post('/api/v1/payments')
    .set('Authorization', `Bearer ${token}`)
    .set('Idempotency-Key', randomUUID())
    .send({ ...body, method: 'CASH', pinToken });
  return { status: response.status, body: response.body };
}
