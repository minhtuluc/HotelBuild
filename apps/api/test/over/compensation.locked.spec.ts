/**
 * HB-124 giai đoạn A — khoá chi bồi thường qua route riêng của HB-120/F6-D06:
 * ACCOUNTANT + PIN + Idempotency-Key, số tiền lấy từ `RoomMove.compensationAmount` đã duyệt,
 * `Payment.type='COMPENSATION'` + `room_move_id` unique, không đụng `paidAmount`/Payment gốc và
 * không dùng `/refund-requests/{id}/pay`.
 */
import { randomBytes, randomUUID } from 'node:crypto';
import { expect, test } from 'vitest';
import {
  errorCode,
  etagOf,
  get,
  guardRoute,
  mintPin,
  post,
  rows,
  staffToken,
} from './helpers/harness.js';
import {
  bookingRow,
  compensationPayments,
  countRows,
  paymentRows,
  rooms,
  seedBooking,
  type SeededBooking,
} from './helpers/seed.js';
import { compensationViewSchema, moveViewSchema } from './helpers/views.js';

const MOVES = '/api/v1/room-moves';
const route = (moveId: string) => `${MOVES}/${moveId}/compensation-payments`;

const createMove = (
  booking: SeededBooking,
  token: string,
  compensationAmount: number,
  toRoomId = rooms.r2,
) =>
  post(MOVES, token, {
    bookingId: booking.id,
    bookingRoomId: booking.bookingRoomIds[0],
    moveType: 'SAME_TYPE_SAME_PROPERTY',
    toRoomId,
    reason: 'Bồi thường theo BR-OVER-06',
    compensationAmount,
    transportCost: 500_000,
    forceMajeure: true,
  });

async function approvedMove(compensationAmount = 1_500_000, toRoomId = rooms.r2) {
  const booking = await seedBooking({ assignRoomIds: [rooms.r1], paid: [{ amount: 1_000_000 }] });
  const desk = await staffToken('desk');
  const created = await createMove(booking, desk, compensationAmount, toRoomId);
  guardRoute(created, 'POST /room-moves');
  expect(created.status).toBe(201);
  const view = moveViewSchema.parse(created.body);
  const approved = await post(`${MOVES}/${view.id}/approve`, await staffToken('manager'), {
    compensationAmount,
    transportCost: 500_000,
    note: 'Duyệt chi phí bồi thường và đưa đón',
    pinToken: await mintPin('manager', booking.id),
  });
  expect([200, 201]).toContain(approved.status);
  const tag = etagOf(await get(`${MOVES}/${view.id}`, desk));
  const executed = await post(
    `${MOVES}/${view.id}/execute`,
    desk,
    { pinToken: await mintPin('desk', booking.id) },
    { tag },
  );
  expect([200, 201]).toContain(executed.status);
  return { booking, moveId: view.id };
}

test('HB124_approved_compensation_payout_and_ambiguous_retry', async () => {
  const { booking, moveId } = await approvedMove();
  const manager = await staffToken('manager');
  const owner = await staffToken('owner');
  const cashier = await staffToken('accountant');

  // MANAGER/OWNER chỉ đọc trạng thái/chứng từ.
  const read = await get(route(moveId), manager);
  guardRoute(read, 'GET /room-moves/{id}/compensation-payments');
  expect(read.status).toBe(200);
  expect(JSON.stringify(read.body)).not.toContain('pinToken');

  const managerPayout = await post(route(moveId), manager, {
    method: 'CASH',
    evidenceRefs: ['receipt:hb124-1'],
    pinToken: await mintPin('manager', booking.id),
  });
  expect(managerPayout.status).toBe(403);
  const ownerPayout = await post(route(moveId), owner, {
    method: 'CASH',
    evidenceRefs: ['receipt:hb124-1'],
    pinToken: await mintPin('owner', booking.id),
  });
  expect(ownerPayout.status).toBe(403);

  const noPin = await post(route(moveId), cashier, {
    method: 'CASH',
    evidenceRefs: ['receipt:hb124-1'],
  });
  expect(noPin.status).toBe(401);
  expect(errorCode(noPin)).toBe('E_AUTH_PIN_REQUIRED');

  const key = randomUUID();
  const body = {
    method: 'CASH',
    evidenceRefs: ['receipt:hb124-1'],
    // Client khai số khác: server phải bỏ qua, lấy đúng quyết định đã duyệt.
    amount: 9_999_999,
    pinToken: await mintPin('accountant', booking.id),
  };
  const paid = await post(route(moveId), cashier, body, { key });
  expect([200, 201]).toContain(paid.status);
  const view = compensationViewSchema.parse(paid.body);
  expect(view).toMatchObject({ amount: 1_500_000, method: 'CASH', status: 'SUCCEEDED' });
  expect(view.paymentId.length).toBeGreaterThan(0);
  expect(view.operationId.length).toBeGreaterThan(0);

  const stored = await compensationPayments(moveId);
  expect(stored).toHaveLength(1);
  expect(stored[0]).toMatchObject({
    type: 'COMPENSATION',
    method: 'CASH',
    amount: '1500000',
    status: 'SUCCEEDED',
    room_move_id: moveId,
  });
  // Không sửa khoản thu gốc/paidAmount, không dùng quỹ REFUND.
  expect(await bookingRow(booking.id)).toMatchObject({ paid_amount: '1000000' });
  expect(
    await countRows("SELECT id FROM payments WHERE booking_id=$1 AND type='REFUND'", [booking.id]),
  ).toBe(0);
  expect(
    await countRows('SELECT id FROM refund_allocations WHERE original_payment_id=ANY($1::uuid[])', [
      (await paymentRows(booking.id)).map((line) => line.id),
    ]),
  ).toBe(0);

  // Replay cùng khoá: kết quả cũ, không tạo chứng từ thứ hai.
  const replay = await post(route(moveId), cashier, body, { key });
  expect(replay.status).toBe(paid.status);
  expect(replay.body).toEqual(paid.body);
  expect(await compensationPayments(moveId)).toHaveLength(1);
  // Khoá khác cho cùng nghĩa vụ: vẫn chỉ một khoản chi.
  const duplicate = await post(
    route(moveId),
    cashier,
    { method: 'BANK_TRANSFER', bankReference: 'VCB-240101', evidenceRefs: ['bank:1'] },
    { key: randomUUID() },
  );
  expect([409, 422]).toContain(duplicate.status);
  expect(await compensationPayments(moveId)).toHaveLength(1);

  // Timeout giữ intent PENDING: lần gọi mới tra operation cũ, không tạo lần chi thứ hai.
  const second = await approvedMove(700_000, rooms.r3);
  const leftover = randomBytes(8).toString('hex');
  await insertLeftover(second.moveId, leftover);
  const retried = await post(
    route(second.moveId),
    await staffToken('accountant'),
    { method: 'BANK_TRANSFER', bankReference: 'VCB-240102', evidenceRefs: ['bank:2'] },
    { key: randomUUID() },
  );
  expect([200, 202, 409]).toContain(retried.status);
  const leftovers = await compensationPayments(second.moveId);
  expect(leftovers).toHaveLength(1);
  expect(leftovers[0]).toMatchObject({ status: 'PENDING', amount: '700000' });
});

/** Intent chi PENDING còn sót sau timeout (đúng mô hình "timeout giữ PENDING, tra operation"). */
async function insertLeftover(roomMoveId: string, key: string): Promise<void> {
  await rows(
    `INSERT INTO payments(booking_id,type,method,amount,status,idempotency_key,created_by,room_move_id)
     SELECT booking_id,'COMPENSATION','BANK_TRANSFER',compensation_amount,'PENDING',$2,approved_by,$1::uuid
       FROM room_moves WHERE id=$1::uuid`,
    [roomMoveId, key],
  );
}
