/**
 * HB-077 — AC1 + AC2: `POST /bookings` trên app thật + PostgreSQL 16 + Redis (DB `/4`).
 *
 * - AC1: mỗi quote chỉ nhận **một** booking; `price_snapshots` ORIGINAL (quote_id/fingerprint/policy/
 *   engine_version + payload) và nghĩa vụ phòng–đêm ghi cùng transaction với booking;
 * - AC2: đặt lặp cùng khách/kỳ/loại phòng trong 24 giờ ⇒ trả booking cũ kèm `duplicateSuspected`
 *   (BR-BOOK-16); trùng nhưng khác chủ sở hữu ⇒ không lộ gì của người khác.
 */
import { randomUUID } from 'node:crypto';
import { expect, test } from 'vitest';
import { z } from 'zod';
import { bookingSummarySchema, errorBodySchema } from '@pinehill/contracts';
import {
  WEB_HOLD_MINUTES,
  bookingBody,
  bookingRequest,
  count,
  createBooking,
  guestId,
  issueQuote,
  otherGuestToken,
  propertyId,
  roomId,
  room2Id,
  rowsOf,
  staffToken,
} from './fixture.js';
import { bookingRow, codeOf, snapshotRowSchema } from './shared.js';

test('AC1: đặt phòng ghi HELD + snapshot ORIGINAL + nghĩa vụ phòng–đêm trong một transaction', async () => {
  const quote = await issueQuote();
  const key = randomUUID();
  const response = await bookingRequest({ ...bookingBody(), quoteId: quote.quoteId }, { key });
  expect(response.status, JSON.stringify(response.body)).toBe(201);
  expect(response.headers.location).toBe(
    `/api/v1/bookings/${bookingSummarySchema.parse(response.body).id}`,
  );
  const booking = bookingSummarySchema.parse(response.body);
  expect(booking).toMatchObject({
    status: 'HELD',
    guestId,
    propertyId,
    checkIn: quote.checkIn,
    checkOut: quote.checkOut,
    nights: quote.nights.length,
    adults: 2,
    children: 0,
    roomCount: 1,
    totalAmount: quote.total,
    depositPercent: quote.depositPercent,
    depositAmount: quote.depositAmount,
    paidAmount: 0,
    refundedAmount: 0,
    balanceDue: quote.total,
    penaltyAmount: 0,
    currency: 'VND',
    rescheduleCount: 0,
    oversold: false,
    priceLocked: false,
    duplicateSuspected: false,
    channelPolicyCode: null,
    // Hợp đồng đòi `createdBy` khác rỗng; booking do khách tạo không có người dùng ⇒ chủ thể là khách.
    createdBy: guestId,
    version: 1,
  });
  expect(booking.holdExpiresAt).not.toBeNull();

  const row = await bookingRow(booking.id);
  expect(row).toMatchObject({
    status: 'HELD',
    total_amount: String(quote.total),
    deposit_amount: String(quote.depositAmount),
    balance_due: String(quote.total),
    paid_amount: '0',
    room_count: 1,
    created_by: null,
  });
  // BR-BOOK-07: hạn = giờ CSDL + `Channel.holdMinutes`; dung sai vì đọc ở câu truy vấn khác.
  expect(Math.abs(row.seconds_left - WEB_HOLD_MINUTES * 60)).toBeLessThan(5);

  // AC1 + BR-RATE-16: snapshot ORIGINAL seq 1 cùng transaction, đủ bằng chứng tái lập giá/policy.
  const snapshot = (
    await rowsOf(
      `SELECT id, seq, kind, quote_id, quote_fingerprint, engine_version, gross_amount,
              commission_amount, channel_property_setting_id, payload_json, policy_snapshot_json
         FROM price_snapshots WHERE booking_id=$1`,
      snapshotRowSchema,
      [booking.id],
    )
  )[0]!;
  expect(snapshot).toMatchObject({
    seq: 1,
    kind: 'ORIGINAL',
    quote_id: quote.quoteId,
    engine_version: quote.engineVersion,
    gross_amount: String(quote.total),
    commission_amount: '0',
    channel_property_setting_id: null,
  });
  expect(snapshot.payload_json.quoteId).toBe(quote.quoteId);
  expect(snapshot.payload_json.nights).toHaveLength(quote.nights.length);
  expect(snapshot.payload_json.totals).toMatchObject({
    subtotal: quote.subtotal,
    discountAmount: quote.discountAmount,
    grossAmount: quote.total,
    commissionAmount: 0,
    depositAmount: quote.depositAmount,
  });
  expect(snapshot.payload_json.nights.map((night) => night.date)).toEqual(
    quote.nights.map((night) => night.date),
  );
  // Phân bổ đóng: tổng các ô (đơn vị bán × đêm) **đúng bằng** tổng kỳ, không thất lạc đồng nào.
  expect(snapshot.payload_json.nights.reduce((sum, night) => sum + night.grossAmount, 0)).toBe(
    quote.total,
  );
  expect(snapshot.payload_json.stay).toMatchObject({
    checkIn: quote.checkIn,
    checkOut: quote.checkOut,
    timezone: 'Asia/Ho_Chi_Minh',
  });
  expect(snapshot.policy_snapshot_json.tiers.length).toBeGreaterThan(0);

  // Nghĩa vụ phòng–đêm: sổ cái (`pay/ledger`) đòi `Σ booking_charges.kind='ROOM' == bookings.total_amount`.
  const charges = await rowsOf(
    `SELECT sum(amount)::text AS total, count(*)::int AS rows FROM booking_charges
      WHERE booking_id=$1 AND kind='ROOM'`,
    z.object({ total: z.string(), rows: z.number() }),
    [booking.id],
  );
  expect(charges[0]).toEqual({ total: String(quote.total), rows: quote.nights.length });

  const rooms = await rowsOf(
    `SELECT br.id, a.room_id, a.bed_no, a.released_at, a.start_date::text AS start_date,
            a.end_date::text AS end_date
       FROM booking_rooms br JOIN room_assignments a ON a.booking_room_id = br.id
      WHERE br.booking_id=$1`,
    z.object({
      id: z.string(),
      room_id: z.string(),
      bed_no: z.number(),
      released_at: z.date().nullable(),
      start_date: z.string(),
      end_date: z.string(),
    }),
    [booking.id],
  );
  expect(rooms).toHaveLength(1);
  expect([roomId, room2Id]).toContain(rooms[0]!.room_id);
  expect(rooms[0]).toMatchObject({
    bed_no: 0,
    released_at: null,
    start_date: quote.checkIn,
    end_date: quote.checkOut,
  });
  expect(
    await count('SELECT 1 FROM booking_charges WHERE booking_id=$1 AND booking_room_id=$2', [
      booking.id,
      rooms[0]!.id,
    ]),
  ).toBe(quote.nights.length);

  expect(
    await rowsOf(
      'SELECT from_status, to_status, reason FROM booking_status_history WHERE booking_id=$1',
      z.object({
        from_status: z.string().nullable(),
        to_status: z.string(),
        reason: z.string().nullable(),
      }),
      [booking.id],
    ),
  ).toEqual([{ from_status: 'DRAFT', to_status: 'HELD', reason: 'BOOKING_CREATED' }]);
  expect(
    await count('SELECT 1 FROM audit_logs WHERE entity_id=$1 AND action=$2', [
      booking.id,
      'BOOKING_CREATED',
    ]),
  ).toBe(1);
  expect(
    await count(
      "SELECT 1 FROM outbox_events WHERE aggregate_id=$1 AND event_type='InventoryChanged'",
      [booking.id],
    ),
  ).toBe(1);
});

test('AC1: lần thứ hai dùng cùng quote hỏng, không sinh booking/snapshot thứ hai', async () => {
  const { quote, booking } = await createBooking();
  const again = await bookingRequest({ ...bookingBody(), quoteId: quote.quoteId });
  expect(again.status).toBe(409);
  expect(codeOf(again.body)).toBe('E_RATE_QUOTE_MISMATCH');
  expect(await count('SELECT 1 FROM bookings')).toBe(1);
  expect(await count('SELECT 1 FROM price_snapshots WHERE quote_id=$1', [quote.quoteId])).toBe(1);
  expect(await count('SELECT 1 FROM room_assignments')).toBe(1);
  expect(booking.id).toBeTruthy();
  // Cùng khoá idempotency ⇒ phát lại kết quả cũ (201), không phải lệnh mới.
  const before = await bookingRequest({ ...bookingBody(), quoteId: quote.quoteId });
  expect(before.status).toBe(409);
});

test('AC1: hai lệnh song song cùng quote ⇒ đúng một booking', async () => {
  const quote = await issueQuote();
  const [first, second] = await Promise.all([
    bookingRequest({ ...bookingBody(), quoteId: quote.quoteId }),
    bookingRequest({ ...bookingBody(), quoteId: quote.quoteId }),
  ]);
  expect([first.status, second.status].sort()).toEqual([201, 409]);
  expect(codeOf(first.status === 409 ? first.body : second.body)).toBe('E_RATE_QUOTE_MISMATCH');
  expect(await count('SELECT 1 FROM bookings')).toBe(1);
  expect(await count('SELECT 1 FROM price_snapshots WHERE quote_id=$1', [quote.quoteId])).toBe(1);
});

test('AC1: quote lạ (mất cache) ⇒ 410 E_RATE_QUOTE_EXPIRED, không ghi gì', async () => {
  const response = await bookingRequest({ ...bookingBody(), quoteId: randomUUID() });
  expect(response.status).toBe(410);
  expect(codeOf(response.body)).toBe('E_RATE_QUOTE_EXPIRED');
  expect(await count('SELECT 1 FROM bookings')).toBe(0);
});

test('AC1: thiếu trường bắt buộc và trường lạ đi đúng mã lỗi của hợp đồng', async () => {
  const missing = await bookingRequest(bookingBody());
  expect(missing.status).toBe(400);
  const body = errorBodySchema.parse(missing.body);
  expect(body.code).toBe('E_BOOK_MISSING_FIELD');
  expect(body.details?.map((detail) => detail.field)).toContain('quoteId');

  const unknown = await bookingRequest({ ...bookingBody(), quoteId: 'x', extra: true });
  expect(unknown.status).toBe(400);
  expect(codeOf(unknown.body)).toBe('E_GEN_VALIDATION_FAILED');
  expect(await count('SELECT 1 FROM bookings')).toBe(0);
});

test('AC2: đặt lặp trong 24 giờ ⇒ trả booking cũ kèm duplicateSuspected, không tạo bản thứ hai', async () => {
  const first = await createBooking();
  const secondQuote = await issueQuote();
  const repeat = await bookingRequest({ ...bookingBody(), quoteId: secondQuote.quoteId });
  expect(repeat.status).toBe(200);
  const repeated = bookingSummarySchema.parse(repeat.body);
  expect(repeated.id).toBe(first.booking.id);
  expect(repeated.duplicateSuspected).toBe(true);
  expect(await count('SELECT 1 FROM bookings')).toBe(1);
  // BR-BOOK-16: dấu vết nghi trùng nằm trên chính booking cũ + nhật ký kiểm toán.
  expect(await count('SELECT 1 FROM bookings WHERE duplicate_suspected')).toBe(1);
  expect(
    await count('SELECT 1 FROM audit_logs WHERE entity_id=$1 AND action=$2', [
      first.booking.id,
      'BOOKING_DUPLICATE_SUSPECTED',
    ]),
  ).toBe(1);
  // Lần thứ ba: cờ đã bật, không ghi thêm nhật ký trùng.
  const third = await bookingRequest({
    ...bookingBody(),
    quoteId: (await issueQuote()).quoteId,
  });
  expect(third.status).toBe(200);
  expect(bookingSummarySchema.parse(third.body).duplicateSuspected).toBe(true);
  expect(
    await count('SELECT 1 FROM audit_logs WHERE entity_id=$1 AND action=$2', [
      first.booking.id,
      'BOOKING_DUPLICATE_SUSPECTED',
    ]),
  ).toBe(1);
});

test('AC2: trùng nhưng khác chủ sở hữu ⇒ 409, không lộ mã/nội dung booking của người khác', async () => {
  const first = await createBooking();
  const strangerToken = otherGuestToken;
  // Khách khác gửi **cùng SĐT** (hợp đồng cho phép liên hệ là người khác) và có quote của chính mình.
  const strangerQuote = await issueQuote({}, strangerToken);
  const response = await bookingRequest(
    { ...bookingBody(), quoteId: strangerQuote.quoteId },
    { token: strangerToken },
  );
  expect(response.status).toBe(409);
  const body = errorBodySchema.parse(response.body);
  expect(body.code).toBe('E_BOOK_INVALID_STATE');
  expect(JSON.stringify(response.body)).not.toContain(first.booking.code);
  expect(await count('SELECT 1 FROM bookings')).toBe(1);
  expect(
    await count('SELECT 1 FROM price_snapshots WHERE quote_id=$1', [strangerQuote.quoteId]),
  ).toBe(0);

  // Nhân viên cùng cơ sở tra đúng SĐT ⇒ cùng chủ sở hữu (hồ sơ khách) nên nhận booking cũ kèm cờ.
  const staff = await staffToken('FRONT_DESK');
  const staffQuote = await issueQuote({}, staff);
  const verified = await bookingRequest(
    { ...bookingBody(), quoteId: staffQuote.quoteId },
    { token: staff },
  );
  expect(verified.status).toBe(200);
  expect(bookingSummarySchema.parse(verified.body)).toMatchObject({
    id: first.booking.id,
    duplicateSuspected: true,
  });
  expect(await count('SELECT 1 FROM bookings')).toBe(1);
});
