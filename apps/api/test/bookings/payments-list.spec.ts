/**
 * HB-254 — `GET /bookings/{bookingId}` trả `payments` (api.md §3.5): danh sách giao dịch của booking,
 * `[]` khi chưa có. Thiếu trường này thì màn thanh toán của customer web và Android khoá nút trả cọc
 * ("Chưa đủ dữ liệu máy chủ…") vì không chứng minh được là chưa có giao dịch trực tuyến nào đang mở.
 */
import { expect, test } from 'vitest';
import { bookingSummarySchema } from '@pinehill/contracts';
import { listedPayment } from '../../src/modules/pay/online/projection.js';
import { createBooking, getRequest, otherGuestToken, rows, userId } from './fixture.js';

const created = new Date('2026-09-19T03:14:02.000Z');

async function insertPayment(
  bookingId: string,
  values: {
    method: string;
    status: string;
    amount: number;
    key: string;
    at: Date;
    paidAt?: Date;
    by?: string;
  },
): Promise<string> {
  const inserted = await rows(
    `INSERT INTO payments(booking_id,type,method,amount,status,idempotency_key,created_at,updated_at,
       paid_at,created_by)
     VALUES($1::uuid,'DEPOSIT',$2,$3,$4,$5,$6,$6,$7,$8::uuid) RETURNING id`,
    [
      bookingId,
      values.method,
      values.amount,
      values.status,
      values.key,
      values.at,
      values.paidAt ?? null,
      values.by ?? null,
    ],
  );
  return String(inserted[0]?.id);
}

test('HB-254: booking chưa có giao dịch trả payments = [] (không bỏ trường)', async () => {
  const { booking } = await createBooking();
  const response = await getRequest(booking.id);
  expect(response.status).toBe(200);
  expect(response.body).toHaveProperty('payments', []);
});

test('HB-254: liệt kê giao dịch theo thời điểm tạo; cổng trực tuyến có hạn 15 phút, không lộ URL cũ', async () => {
  const { booking } = await createBooking();
  const online = await insertPayment(booking.id, {
    method: 'VNPAY',
    status: 'PENDING',
    amount: 390_000,
    key: 'hb254-online',
    at: created,
  });
  const cash = await insertPayment(booking.id, {
    method: 'CASH',
    status: 'SUCCEEDED',
    amount: 100_000,
    key: 'hb254-cash',
    at: new Date(created.getTime() + 60_000),
    paidAt: new Date(created.getTime() + 60_000),
    by: userId,
  });

  const summary = bookingSummarySchema.parse((await getRequest(booking.id)).body);
  expect(summary.payments).toEqual([
    {
      paymentId: online,
      bookingId: booking.id,
      type: 'DEPOSIT',
      method: 'VNPAY',
      amount: 390_000,
      status: 'PENDING',
      providerTxnId: null,
      paymentUrl: null,
      expiresAt: '2026-09-19T03:29:02.000Z',
      paidAt: null,
      createdAt: '2026-09-19T03:14:02.000Z',
      createdBy: null,
    },
    {
      paymentId: cash,
      bookingId: booking.id,
      type: 'DEPOSIT',
      method: 'CASH',
      amount: 100_000,
      status: 'SUCCEEDED',
      providerTxnId: null,
      paymentUrl: null,
      expiresAt: null,
      paidAt: '2026-09-19T03:15:02.000Z',
      createdAt: '2026-09-19T03:15:02.000Z',
      createdBy: userId,
    },
  ]);

  // Khách khác vẫn bị che 404 — danh sách giao dịch không mở thêm đường đọc nào.
  expect((await getRequest(booking.id, { token: otherGuestToken })).status).toBe(404);
});

test('HB-254: dòng hoàn lưu số âm được trả độ lớn dương; chiều tiền nằm ở type', () => {
  const at = new Date('2026-09-19T03:14:02.000Z');
  expect(
    listedPayment({
      id: 'p-refund',
      booking_id: 'b1',
      type: 'REFUND',
      method: 'BANK_TRANSFER',
      amount: -250_000n,
      status: 'SUCCEEDED',
      provider_txn_id: null,
      paid_at: at,
      created_at: at,
      created_by: null,
    }),
  ).toMatchObject({ type: 'REFUND', amount: 250_000, expiresAt: null, paymentUrl: null });
});
