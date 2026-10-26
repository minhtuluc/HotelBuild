/**
 * HB-211 — phân bổ khoản thu theo trọng số phòng, huỷ một phần không còn 422 (BR-CANCEL-19,
 * BR-CANCEL-04/05/11, BR-PAY-07; F5-QA-04).
 *
 * Ca gốc: DLX 2 phòng × 3 đêm, tổng 6.900.000, cọc 2.070.000. Trước HB-211 khoản cọc bị gán tuần tự
 * vào một phòng nên huỷ phòng còn 0 ₫ trả 422 `E_PAY_REFUND_EXCEEDS_PAID` dù xem trước báo hoàn
 * 1.035.000. Các ca dưới đây đi qua **đúng hai writer** (`applyVerifiedEvent` của webhook PSP và
 * `POST /payments` tại quầy) rồi huỷ qua HTTP thật.
 */
import { expect, test } from 'vitest';
import { cancelPreviewSchema, cancelResponseSchema, paymentSchema } from '@pinehill/contracts';
import {
  allocatedByRoom,
  allocationRows,
  booking,
  bookingRow,
  cancel,
  clock,
  collectAtCounter,
  guestCancel,
  login,
  preview,
  receiveOnline,
  refundRequests,
  room2Id,
  roomId,
  roomIds,
  rows,
} from './fixture.js';

const TOTAL = 6_900_000n;
const DEPOSIT = 2_070_000n;
const ROOM_SHARE = 1_035_000;

/** Xem trước rồi xác nhận đúng tập phòng; trả cả hai số để so khớp xem trước == lệnh huỷ. */
async function previewAndCancel(token: string, bookingId: string, room: string) {
  const previewed = await preview(token, bookingId, guestCancel, [room]);
  expect(previewed.status, JSON.stringify(previewed.body)).toBe(200);
  const before = cancelPreviewSchema.parse(previewed.body);
  const response = await cancel(
    token,
    bookingId,
    { ...guestCancel, bookingRoomIds: [room] },
    { tag: previewed.headers.etag! },
  );
  return {
    previewAmount: before.cancellation.requestedAmount,
    response,
  };
}

test('F5-QA-04: cọc trực tuyến chia theo trọng số phòng; huỷ từng phòng trả đúng phần, không 422', async () => {
  const target = await booking({ rooms: [roomId, room2Id], nights: 3, price: 1_150_000 });
  expect(target.total).toBe(TOTAL);
  const [first, second] = await roomIds(target.id);

  const payment = await receiveOnline(target.id, DEPOSIT);
  expect(await allocatedByRoom(payment)).toEqual([
    { room: first!, amount: '1035000' },
    { room: second!, amount: '1035000' },
  ]);
  // Không phần âm, Σ phần = số tiền thu; mỗi đêm nhận đúng 345.000.
  const allocated = await rows(
    'SELECT amount::text AS amount FROM payment_allocations WHERE payment_id=$1::uuid ORDER BY id',
    [payment],
  );
  expect(allocated.map((row) => row.amount)).toEqual(Array(6).fill('345000'));
  expect(allocated.reduce((sum, row) => sum + BigInt(String(row.amount)), 0n)).toBe(DEPOSIT);

  const token = await login('FRONT_DESK');
  for (const room of [first!, second!]) {
    const result = await previewAndCancel(token, target.id, room);
    expect(result.previewAmount).toBe(ROOM_SHARE);
    expect(result.response.status, JSON.stringify(result.response.body)).toBe(200);
    const body = cancelResponseSchema.parse(result.response.body);
    expect(body.cancellation.requestedAmount).toBe(ROOM_SHARE);
  }
  expect((await bookingRow(target.id)).status).toBe('CANCELLED');
  const refunds = await refundRequests(target.id);
  expect(refunds).toHaveLength(2);
  expect(refunds.reduce((sum, row) => sum + Number(row.requested_amount), 0)).toBe(Number(DEPOSIT));
});

test('thu cọc tại quầy cũng chia theo trọng số; huỷ hai phòng ngược thứ tự vẫn đủ tiền', async () => {
  const target = await booking({
    rooms: [roomId, room2Id],
    nights: 3,
    price: 1_150_000,
    status: 'HELD',
    holdExpiresAt: new Date(clock.now().getTime() + 3_600_000),
  });
  await rows('UPDATE bookings SET deposit_amount=$2 WHERE id=$1', [target.id, DEPOSIT.toString()]);
  const [first, second] = await roomIds(target.id);

  const token = await login('FRONT_DESK');
  const collected = await collectAtCounter(token, {
    bookingId: target.id,
    type: 'DEPOSIT',
    amount: Number(DEPOSIT),
  });
  expect(collected.status, JSON.stringify(collected.body)).toBe(201);
  const payment = paymentSchema.parse(collected.body);
  expect((await bookingRow(target.id)).status).toBe('CONFIRMED');
  expect(await allocatedByRoom(payment.paymentId)).toEqual([
    { room: first!, amount: '1035000' },
    { room: second!, amount: '1035000' },
  ]);

  // Thứ tự huỷ ngược lại ca trên: phòng id lớn trước, phòng id nhỏ sau.
  for (const room of [second!, first!]) {
    const result = await previewAndCancel(token, target.id, room);
    expect(result.previewAmount).toBe(ROOM_SHARE);
    expect(result.response.status, JSON.stringify(result.response.body)).toBe(200);
    expect(cancelResponseSchema.parse(result.response.body).cancellation.requestedAmount).toBe(
      ROOM_SHARE,
    );
  }
  expect((await bookingRow(target.id)).status).toBe('CANCELLED');
  const refunds = await refundRequests(target.id);
  expect(refunds.reduce((sum, row) => sum + Number(row.requested_amount), 0)).toBe(Number(DEPOSIT));
});

test('khoản thu sau tạo dòng phân bổ mới cùng trọng số, không sửa dòng cũ', async () => {
  const target = await booking({ rooms: [roomId, room2Id], nights: 3, price: 1_150_000 });
  const [first, second] = await roomIds(target.id);
  const deposit = await receiveOnline(target.id, DEPOSIT, 'VNPAY', 'DEPOSIT');
  const before = await allocationRows(target.id);
  expect(before).toHaveLength(6);

  const balance = await receiveOnline(target.id, DEPOSIT, 'MOMO', 'BALANCE');
  const after = await allocationRows(target.id);
  expect(after).toHaveLength(12);
  expect(after.filter((row) => row.payment_id === deposit)).toEqual(before);
  expect(await allocatedByRoom(balance)).toEqual([
    { room: first!, amount: '1035000' },
    { room: second!, amount: '1035000' },
  ]);
  const totals = await rows(
    `SELECT c.booking_room_id AS room, sum(a.amount)::text AS amount
       FROM payment_allocations a JOIN booking_charges c ON c.id = a.charge_id
      WHERE c.booking_id=$1::uuid
      GROUP BY c.booking_room_id
      ORDER BY c.booking_room_id`,
    [target.id],
  );
  expect(totals).toEqual([
    { room: first!, amount: '2070000' },
    { room: second!, amount: '2070000' },
  ]);

  const token = await login('FRONT_DESK');
  for (const room of [first!, second!]) {
    const result = await previewAndCancel(token, target.id, room);
    expect(result.previewAmount).toBe(Number(DEPOSIT));
    expect(result.response.status, JSON.stringify(result.response.body)).toBe(200);
  }
  expect((await bookingRow(target.id)).status).toBe('CANCELLED');
  const refunds = await refundRequests(target.id);
  expect(refunds.reduce((sum, row) => sum + Number(row.requested_amount), 0)).toBe(
    Number(DEPOSIT) * 2,
  );
});

test('booking một phòng thu đủ: từng đêm nhận đúng nghĩa vụ như hành vi cũ', async () => {
  const target = await booking({ nights: 3, price: 500_000 });
  const payment = await receiveOnline(target.id, 1_500_000n);
  const paid = await rows(
    `SELECT c.amount::text AS obligated, a.amount::text AS allocated
       FROM booking_charges c JOIN payment_allocations a ON a.charge_id = c.id
      WHERE c.booking_id=$1::uuid ORDER BY c.id`,
    [target.id],
  );
  expect(paid).toHaveLength(3);
  expect(paid.map((row) => row.allocated)).toEqual(paid.map((row) => row.obligated));
  expect(await allocatedByRoom(payment)).toEqual([
    { room: (await roomIds(target.id))[0]!, amount: '1500000' },
  ]);
});
