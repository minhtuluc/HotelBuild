/**
 * HB-151 — TC-BOOK-17 ở mức API (UC-BOOK-02, FR-BOOK-02; NFR-USE-05).
 *
 * Đo ≤ 3 phút / ≤ 5 thao tác của giao diện thuộc HB-152/HB-157; ở đây chứng minh **đường API** mà hai
 * màn hình đó gọi: một lệnh `POST /walk-in` tạo quote + booking kênh `WALKIN` (cấu hình kênh quyết định,
 * `hold_minutes = 0` ⇒ `PENDING_PAYMENT` 15 phút theo BR-BOOK-07), rồi `POST /payments` (HB-096) thu cọc
 * bằng `pinToken` gắn đúng booking ⇒ `CONFIRMED` (BR-BOOK-09).
 */
import { expect, test } from 'vitest';
import { z } from 'zod';
import { bookingSummarySchema, errorBodySchema, paymentSchema } from '@pinehill/contracts';
import {
  channelConfig,
  count,
  depositBody,
  http,
  nextDay,
  otherPropertyId,
  paymentRequest,
  pinTokenFor,
  rows,
  staffToken,
  today,
  uniquePhone,
  userId,
  walkInBody,
  walkInRequest,
  walkInResponseSchema,
} from './fixture.js';

const bookingRowSchema = z.object({
  code: z.string(),
  status: z.string(),
  channel_id: z.string(),
  guest_id: z.string(),
  check_in: z.string(),
  check_out: z.string(),
  total_amount: z.string(),
  deposit_amount: z.string(),
  deposit_percent: z.string(),
  paid_amount: z.string(),
  balance_due: z.string(),
  created_by: z.string().nullable(),
  seconds_left: z.number(),
});

async function bookingRow(id: string) {
  const [row] = z.array(bookingRowSchema).parse(
    await rows(
      `SELECT code, status, channel_id, guest_id, check_in::text, check_out::text,
              total_amount::text, deposit_amount::text, deposit_percent::text, paid_amount::text,
              balance_due::text, created_by,
              extract(epoch FROM (hold_expires_at - clock_timestamp()))::float8 AS seconds_left
         FROM bookings WHERE id=$1`,
      [id],
    ),
  );
  if (row === undefined) throw new Error(`HB-151: booking ${id} không tồn tại`);
  return row;
}

test('TC-BOOK-17 (API): walk-in WALKIN + cọc tại quầy → CONFIRMED, snapshot/nghĩa vụ/audit/outbox đủ', async () => {
  const token = await staffToken();
  const config = await channelConfig();
  const phone = uniquePhone();
  const body = walkInBody({ guest: { fullName: 'Khách Vãng Lai', phone } });

  const response = await walkInRequest(body, { token });
  expect(response.status, JSON.stringify(response.body)).toBe(201);
  const { created, quote, booking } = walkInResponseSchema.parse(response.body);
  expect(created).toBe(true);
  expect(response.headers.location).toBe(`/api/v1/bookings/${booking.id}`);
  // Bước báo giá dùng đúng kênh cấu hình: hệ số WALKIN 1,10 của seed, không hard-code kênh/giá.
  expect(quote.channelCode).toBe('WALKIN');
  for (const night of quote.nights) expect(night.channelMultiplier).toBeCloseTo(1.1, 5);
  expect(booking).toMatchObject({
    status: 'PENDING_PAYMENT',
    channelId: config.id,
    propertyId: body['propertyId'],
    roomTypeId: body['roomTypeId'],
    checkIn: today(),
    checkOut: nextDay(today()),
    nights: 1,
    totalAmount: quote.total,
    depositPercent: quote.depositPercent,
    depositAmount: quote.depositAmount,
    paidAmount: 0,
    balanceDue: quote.total,
    duplicateSuspected: false,
  });

  // Khách vãng lai chưa có hồ sơ: HB-077 nhận diện theo SĐT chuẩn hoá (BR-CRM-01).
  const [guest] = z
    .array(z.object({ phone: z.string() }))
    .parse(await rows('SELECT phone FROM guests WHERE id=$1', [booking.guestId]));
  expect(guest?.phone).toBe(`+84${phone.slice(1)}`);

  const row = await bookingRow(booking.id);
  expect(row).toMatchObject({
    status: 'PENDING_PAYMENT',
    channel_id: config.id,
    check_in: today(),
    check_out: nextDay(today()),
    total_amount: String(quote.total),
    deposit_amount: String(quote.depositAmount),
    deposit_percent: quote.depositPercent.toFixed(2),
    paid_amount: '0',
    balance_due: String(quote.total),
    created_by: userId,
  });
  expect(row.code).toMatch(/^PH-\d{6}-[A-Z0-9]{5}$/);
  // BR-BOOK-07 + Q-13: WALKIN (holdMinutes = 0) dùng PENDING_PAYMENT hạn 15 phút, không dùng HELD.
  expect(row.seconds_left).toBeGreaterThan(840);
  expect(row.seconds_left).toBeLessThanOrEqual(900);

  // BR-RATE-16: snapshot ORIGINAL + nghĩa vụ ROOM ghi cùng transaction với booking.
  const [snapshot] = z
    .array(
      z.object({
        seq: z.number(),
        kind: z.string(),
        quote_id: z.string(),
        engine_version: z.string(),
      }),
    )
    .parse(
      await rows(
        'SELECT seq, kind, quote_id, engine_version FROM price_snapshots WHERE booking_id=$1',
        [booking.id],
      ),
    );
  expect(snapshot).toEqual({
    seq: 1,
    kind: 'ORIGINAL',
    quote_id: quote.quoteId,
    engine_version: quote.engineVersion,
  });
  expect(await count('SELECT id FROM booking_charges WHERE booking_id=$1', [booking.id])).toBe(1);
  expect(
    await count(
      'SELECT a.id FROM room_assignments a JOIN booking_rooms br ON br.id=a.booking_room_id WHERE br.booking_id=$1',
      [booking.id],
    ),
  ).toBe(1);
  expect(
    await count("SELECT id FROM audit_logs WHERE entity_id=$1 AND action='BOOKING_CREATED'", [
      booking.id,
    ]),
  ).toBe(1);
  expect(
    await count(
      "SELECT id FROM outbox_events WHERE aggregate_id=$1 AND event_type='InventoryChanged'",
      [booking.id],
    ),
  ).toBe(1);

  // Bước thu cọc: HB-096 `POST /payments` với `pinToken` gắn đúng booking (UC-BOOK-02 bước 6–7).
  const pinToken = await pinTokenFor(token, booking.id);
  const paid = await paymentRequest(depositBody(booking.id, quote.depositAmount, pinToken), token);
  expect(paid.status, JSON.stringify(paid.body)).toBe(201);
  expect(paymentSchema.parse(paid.body)).toMatchObject({
    bookingId: booking.id,
    type: 'DEPOSIT',
    method: 'CASH',
    amount: quote.depositAmount,
    status: 'SUCCEEDED',
    createdBy: userId,
  });
  const after = await bookingRow(booking.id);
  expect(after).toMatchObject({
    status: 'CONFIRMED',
    paid_amount: String(quote.depositAmount),
    balance_due: String(quote.total - quote.depositAmount),
  });
  const detail = await http()
    .get(`/api/v1/bookings/${booking.id}`)
    .set('Authorization', `Bearer ${token}`);
  expect(detail.status, JSON.stringify(detail.body)).toBe(200);
  expect(bookingSummarySchema.parse(detail.body)).toMatchObject({
    status: 'CONFIRMED',
    paidAmount: quote.depositAmount,
    balanceDue: quote.total - quote.depositAmount,
  });
});

test('walk-in chưa thu cọc giữ PENDING_PAYMENT đúng hạn 15 phút và không sinh chứng từ', async () => {
  const token = await staffToken();
  const response = await walkInRequest(walkInBody(), { token });
  expect(response.status, JSON.stringify(response.body)).toBe(201);
  const { booking } = walkInResponseSchema.parse(response.body);
  expect(booking.status).toBe('PENDING_PAYMENT');
  const row = await bookingRow(booking.id);
  expect(row.seconds_left).toBeGreaterThan(840);
  expect(row.seconds_left).toBeLessThanOrEqual(900);
  expect(await count('SELECT id FROM payments WHERE booking_id=$1', [booking.id])).toBe(0);
});

test('khách trong danh sách đen bị chặn trước khi tạo booking (BR-CRM-04)', async () => {
  const token = await staffToken();
  const phone = uniquePhone();
  await rows(
    "INSERT INTO guests(full_name,phone,blacklisted,blacklist_reason) VALUES('Khách Đen',$1,true,'Synthetic HB-151')",
    [`+84${phone.slice(1)}`],
  );
  const response = await walkInRequest(walkInBody({ guest: { fullName: 'Khách Đen', phone } }), {
    token,
  });
  expect(response.status).toBe(403);
  expect(errorBodySchema.parse(response.body).code).toBe('E_BOOK_BLACKLISTED');
  expect(await count('SELECT id FROM bookings')).toBe(0);
});

test('walk-in là tuyến nhân viên: sai quyền 403, ngoài phạm vi cơ sở 403 trước khi giữ khoá', async () => {
  const accountant = await staffToken('ACCOUNTANT');
  const denied = await walkInRequest(walkInBody(), { token: accountant });
  expect(denied.status).toBe(403);
  expect(errorBodySchema.parse(denied.body).code).toBe('E_RBAC_FORBIDDEN');

  const frontDesk = await staffToken('FRONT_DESK');
  const outside = await walkInRequest(walkInBody({ propertyId: otherPropertyId }), {
    token: frontDesk,
  });
  expect(outside.status).toBe(403);
  expect(errorBodySchema.parse(outside.body).code).toBe('E_AUTH_OUT_OF_SCOPE');
  expect(await count('SELECT id FROM bookings')).toBe(0);
});

test('client không được tự khai kênh hoặc bỏ qua Idempotency-Key', async () => {
  const token = await staffToken();
  const channelInBody = await walkInRequest(walkInBody({ channelCode: 'WEB' }), { token });
  expect(channelInBody.status).toBe(400);
  expect(errorBodySchema.parse(channelInBody.body).code).toBe('E_GEN_VALIDATION_FAILED');

  const missingGuest = await walkInRequest(walkInBody({ guest: undefined }), { token });
  expect(missingGuest.status).toBe(400);
  expect(errorBodySchema.parse(missingGuest.body).code).toBe('E_GEN_VALIDATION_FAILED');

  const noKey = await walkInRequest(walkInBody(), { token, omitKey: true });
  expect(noKey.status).toBe(400);
  expect(errorBodySchema.parse(noKey.body).code).toBe('E_GEN_VALIDATION_FAILED');
  expect(await count('SELECT id FROM bookings')).toBe(0);
});
