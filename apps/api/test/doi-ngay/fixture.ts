/**
 * Fixture tích hợp HB-098 — app thật (`AppModule.register`) + CSDL tách riêng của
 * `test/idempotency/database.js` (migrate sạch) + **Redis DB `/8`** theo phân DB của main-agent cho
 * HB-098. Dữ liệu nền (cơ sở `H029-A`, loại phòng `STD` với `R1`/`R2`, gói `FLEX7`, 7 kênh) lấy từ
 * `../room-blocks/inventory-seed.js` — không dựng bộ seed thứ hai.
 *
 * Booking của các ca kiểm thử được tạo **qua API thật** (`POST /quotes` + `POST /bookings` của
 * HB-074/HB-077), nên lệnh đổi ngày chạy trên đúng dữ liệu mà luồng đặt phòng sinh ra (ảnh giá ORIGINAL,
 * nghĩa vụ phòng–đêm, assignment) chứ không phải dữ liệu SQL tự dựng.
 *
 * Kênh `WEB` được nâng `hold_minutes` lên 20 phút (giá trị thật của seed sản phẩm) để `POST /bookings`
 * vào `HELD` — trạng thái đổi ngày được mà không cần khoản thu nào.
 */
import 'reflect-metadata';
import { randomBytes, randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, expect } from 'vitest';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { Redis } from 'ioredis';
import request from 'supertest';
import { z } from 'zod';
import {
  bookingSummarySchema,
  errorBodySchema,
  quoteSchema,
  tokenPairSchema,
} from '@pinehill/contracts';
import type { BookingSummary, Quote } from '@pinehill/contracts';
import { AppModule } from '../../src/app.module.js';
import { CLOCK } from '../../src/infrastructure/ports.js';
import { databaseUrl, password } from '../idempotency/database.js';
import {
  clock,
  propertyId,
  room2Id,
  roomId,
  rows,
  stay,
  typeId,
  userId,
} from '../room-blocks/inventory-seed.js';
import { resetConfig, seedFlexTiers, seedNonrefPlan } from './seed.js';

export { clock, propertyId, room2Id, roomId, rows, stay, typeId, userId };
export { resetConfig, seedPayment, toDraft, blockRooms } from './seed.js';

/** Hạn giữ chỗ của kênh `WEB` trong fixture (> 0 ⇒ `POST /bookings` vào `HELD`, BR-BOOK-07). */
export const WEB_HOLD_MINUTES = 20;
/** Kỳ mới dùng cho ca "dời nguyên kỳ": **dời đúng 7 ngày** nên cùng thứ trong tuần và cùng mức giá nền. */
export const shifted = { checkIn: '2026-11-08', checkOut: '2026-11-11' };

let app: NestFastifyApplication;
let redis: Redis;

export const http = () => request(app.getHttpServer());
export const errorCode = (body: unknown) => errorBodySchema.parse(body).code;

/** Phiên nhân viên thật qua `POST /auth/login` (HB-013); đổi vai trò người dùng trước khi đăng nhập. */
export async function login(role = 'FRONT_DESK'): Promise<string> {
  await rows('UPDATE users SET role=$1,is_active=true WHERE id=$2::uuid', [role, userId]);
  const response = await http()
    .post('/api/v1/auth/login')
    .send({ username: 'h029-first', password });
  expect(response.status).toBe(200);
  return tokenPairSchema.parse(response.body).accessToken;
}

let guestSeq = 0;
/** SĐT khách riêng cho từng lệnh tạo: BR-BOOK-16 chặn trùng theo SĐT + kỳ + loại phòng trong 24 giờ. */
function guestPhone(): string {
  guestSeq += 1;
  return `0900${String(guestSeq).padStart(6, '0')}`;
}

export const bookingBody = (overrides: object = {}): Record<string, unknown> => ({
  propertyId,
  roomTypeId: typeId,
  ratePlanCode: 'FLEX7',
  channelCode: 'WEB',
  checkIn: stay.checkIn,
  checkOut: stay.checkOut,
  adults: 2,
  children: 0,
  roomCount: 1,
  guest: { fullName: 'HB-098 Guest', phone: guestPhone() },
  ...overrides,
});

/** `POST /quotes` (HB-074) bằng chính phiên sẽ đổi ngày — fingerprint của quote gắn principal. */
export async function issueQuote(overrides: object = {}, token: string): Promise<Quote> {
  const response = await http()
    .post('/api/v1/quotes')
    .set('Authorization', `Bearer ${token}`)
    .set('Idempotency-Key', randomUUID())
    .send({
      propertyId,
      roomTypeId: typeId,
      channelCode: 'WEB',
      ratePlanCode: 'FLEX7',
      checkIn: stay.checkIn,
      checkOut: stay.checkOut,
      adults: 2,
      children: 0,
      roomCount: 1,
      ...overrides,
    });
  expect(response.status, JSON.stringify(response.body)).toBe(201);
  return quoteSchema.parse(response.body);
}

export interface CreatedBooking {
  readonly quote: Quote;
  readonly booking: BookingSummary;
}

/** Tạo booking qua API thật (quote mới + lệnh mới) — trả cả quote để ca sau dùng lại. */
export async function createBooking(
  overrides: object,
  options: { readonly token: string; readonly quote?: Quote },
): Promise<CreatedBooking> {
  const token = options.token;
  const quote = options.quote ?? (await issueQuote(overrides, token));
  const response = await http()
    .post('/api/v1/bookings')
    .set('Authorization', `Bearer ${token}`)
    .set('Idempotency-Key', randomUUID())
    .send({ ...bookingBody(overrides), quoteId: quote.quoteId });
  const failure: unknown = response.body;
  expect(response.status, JSON.stringify({ overrides, failure })).toBe(201);
  return { quote, booking: bookingSummarySchema.parse(response.body) };
}

/** `ETag`/phiên bản để gửi vào `If-Match`: chính `version` mà `GET /bookings/{id}` trả về (§2.5). */
export async function versionOf(token: string, bookingId: string): Promise<string> {
  const response = await http()
    .get(`/api/v1/bookings/${bookingId}`)
    .set('Authorization', `Bearer ${token}`);
  expect(response.status, JSON.stringify(response.body)).toBe(200);
  const summary = bookingSummarySchema.parse(response.body);
  if (summary.version === undefined) throw new Error('GET /bookings/{id} thiếu `version`');
  return String(summary.version);
}

export function getBooking(token: string, bookingId: string) {
  return http().get(`/api/v1/bookings/${bookingId}`).set('Authorization', `Bearer ${token}`);
}

export function rescheduleRequest(
  token: string,
  bookingId: string,
  body: object,
  options: { tag?: string; key?: string } = {},
) {
  const call = http()
    .post(`/api/v1/bookings/${bookingId}/reschedule`)
    .set('Authorization', `Bearer ${token}`)
    .set('Idempotency-Key', options.key ?? randomUUID());
  if (options.tag !== undefined) call.set('If-Match', options.tag);
  return call.send(body);
}

export function deleteRequest(
  token: string,
  bookingId: string,
  options: { reason?: string; key?: string } = {},
) {
  const call = http()
    .delete(`/api/v1/bookings/${bookingId}`)
    .set('Authorization', `Bearer ${token}`)
    .set('Idempotency-Key', options.key ?? randomUUID());
  if (options.reason !== undefined) call.query({ reason: options.reason });
  return call;
}

const rescheduleBlock = z.object({
  previousCheckIn: z.string().min(1),
  previousCheckOut: z.string().min(1),
  previousTotalAmount: z.number().int().nonnegative(),
  previousRescheduleCount: z.number().int().nonnegative(),
  offeredTotal: z.number().int().nonnegative(),
  balanceIncrease: z.number().int().nonnegative(),
  retainedAmount: z.number().int().nonnegative(),
  feeAmount: z.number().int().nonnegative(),
  rescheduleCount: z.number().int().positive(),
  reason: z.string().min(1),
});

/** Hình dạng `payload_json` mà HB-097 (`snapshotPayloadSchema`) và báo cáo đọc lại (csdl §3.6). */
export const snapshotPayloadSchema = z.object({
  schemaVersion: z.number().int().positive(),
  engineVersion: z.string().min(1),
  quoteId: z.string().min(1),
  quoteFingerprint: z.string().regex(/^[0-9a-f]{64}$/),
  channelCode: z.string().min(1),
  stay: z.object({
    checkIn: z.string().min(1),
    checkOut: z.string().min(1),
    timezone: z.string().min(1),
    checkInTime: z.string().min(1),
    checkOutTime: z.string().min(1),
  }),
  nights: z.array(
    z.object({
      bookingRoomId: z.string().min(1),
      date: z.string().min(1),
      grossAmount: z.number().int().nonnegative(),
      commissionAmount: z.number().int().nonnegative(),
      nightlyPrice: z.number().int().positive(),
    }),
  ),
  totals: z.object({
    subtotal: z.number().int().nonnegative(),
    discountAmount: z.number().int().nonnegative(),
    grossAmount: z.number().int().nonnegative(),
    commissionAmount: z.number().int().nonnegative(),
    depositAmount: z.number().int().nonnegative(),
    currency: z.literal('VND'),
  }),
  reschedule: rescheduleBlock.optional(),
});

export const snapshotRowSchema = z.object({
  seq: z.number().int().positive(),
  kind: z.string().min(1),
  quote_id: z.string().nullable(),
  quote_fingerprint: z.string().nullable(),
  engine_version: z.string().min(1),
  gross_amount: z.string(),
  commission_amount: z.string(),
  payload_json: snapshotPayloadSchema,
  policy_snapshot_json: z.record(z.string(), z.json()),
});

export type SnapshotRow = z.infer<typeof snapshotRowSchema>;

/** Ảnh giá của booking theo `seq` — nguồn đối chiếu "giữ ORIGINAL, append RESCHEDULE". */
export async function snapshotsOf(bookingId: string): Promise<SnapshotRow[]> {
  return z.array(snapshotRowSchema).parse(
    await rows(
      `SELECT seq, kind, quote_id, quote_fingerprint, engine_version, gross_amount,
              commission_amount, payload_json, policy_snapshot_json
         FROM price_snapshots WHERE booking_id=$1::uuid ORDER BY seq`,
      [bookingId],
    ),
  );
}

export const chargeRowSchema = z.object({
  kind: z.string().min(1),
  source_key: z.string().min(1),
  amount: z.string(),
  voided_amount: z.string(),
});

/** Nghĩa vụ tiền của booking (ROOM/PENALTY/RESCHEDULE_FEE/EXTRA_SERVICE) theo khoá nguồn. */
export async function chargesOf(bookingId: string) {
  return z.array(chargeRowSchema).parse(
    await rows(
      `SELECT kind, source_key, amount, voided_amount FROM booking_charges
        WHERE booking_id=$1::uuid ORDER BY source_key`,
      [bookingId],
    ),
  );
}

export const assignmentRowSchema = z.object({
  booking_room_id: z.string().uuid(),
  room_id: z.string().uuid(),
  bed_no: z.number().int().nonnegative(),
  start_date: z.string(),
  end_date: z.string(),
  released_at: z.date().nullable(),
  release_reason: z.string().nullable(),
});

/** Đơn vị bán của booking: hàng còn hoạt động là khoảng `[start, end)` đang giữ chỗ. */
export async function assignmentsOf(bookingId: string) {
  return z.array(assignmentRowSchema).parse(
    await rows(
      `SELECT a.booking_room_id, a.room_id, a.bed_no, to_char(a.start_date,'YYYY-MM-DD') AS start_date,
              to_char(a.end_date,'YYYY-MM-DD') AS end_date, a.released_at, a.release_reason
         FROM room_assignments a JOIN booking_rooms br ON br.id = a.booking_room_id
        WHERE br.booking_id=$1::uuid ORDER BY a.start_date, a.id`,
      [bookingId],
    ),
  );
}

export const bookingRowSchema = z.object({
  status: z.string().min(1),
  version: z.string(),
  check_in: z.string(),
  check_out: z.string(),
  total_amount: z.string(),
  deposit_amount: z.string(),
  paid_amount: z.string(),
  balance_due: z.string(),
  reschedule_count: z.number().int().nonnegative(),
});

export type BookingRow = z.infer<typeof bookingRowSchema>;

export async function bookingRow(bookingId: string): Promise<BookingRow | undefined> {
  return z.array(bookingRowSchema).parse(
    await rows(
      `SELECT status, version, to_char(check_in,'YYYY-MM-DD') AS check_in,
              to_char(check_out,'YYYY-MM-DD') AS check_out, total_amount, deposit_amount,
              paid_amount, balance_due, reschedule_count
         FROM bookings WHERE id=$1::uuid`,
      [bookingId],
    ),
  )[0];
}

export const auditRowSchema = z.object({
  action: z.string().min(1),
  actor_id: z.string().nullable(),
  actor_role: z.string().min(1),
  before_json: z.record(z.string(), z.json()).nullable(),
  after_json: z.record(z.string(), z.json()).nullable(),
  reason: z.string().nullable(),
});

/** Vết kiểm toán của booking theo thứ tự ghi (append-only, thoát TRUNCATE bookings). */
export async function auditOf(bookingId: string) {
  return z.array(auditRowSchema).parse(
    await rows(
      `SELECT action, actor_id, actor_role, before_json, after_json, reason FROM audit_logs
        WHERE entity_id=$1::uuid ORDER BY chain_seq`,
      [bookingId],
    ),
  );
}

export function refundRequestsOf(bookingId: string) {
  return rows('SELECT id, status FROM refund_requests WHERE booking_id=$1::uuid', [bookingId]);
}

beforeAll(async () => {
  if (!process.env.REDIS_URL) throw new Error('HB-098 requires Redis7; no skip fallback');
  const url = new URL(process.env.REDIS_URL);
  url.pathname = '/8';
  redis = new Redis(url.href);
  await redis.ping();
  const module = AppModule.register({
    DATABASE_URL: databaseUrl,
    REDIS_URL: url.href,
    JWT_ACCESS_SECRET: randomBytes(32).toString('hex'),
    JWT_REFRESH_SECRET: randomBytes(32).toString('hex'),
    BUSINESS_TIMEZONE: 'Asia/Ho_Chi_Minh',
    IDEMPOTENCY_TTL_HOURS: 24,
    LOG_LEVEL: 'silent',
    HOST: '127.0.0.1',
    PORT: 0,
  });
  app = await NestFactory.create<NestFastifyApplication>(
    {
      ...module,
      providers: [
        ...(module.providers ?? []).filter(
          (provider) =>
            typeof provider !== 'object' ||
            provider === null ||
            !('provide' in provider) ||
            provider.provide !== CLOCK,
        ),
        { provide: CLOCK, useValue: clock },
      ],
    },
    new FastifyAdapter(),
    { logger: false, abortOnError: false },
  );
  app.setGlobalPrefix('api/v1');
  await app.listen(0, '127.0.0.1');
  await seedFlexTiers();
  await seedNonrefPlan();
}, 90000);

beforeEach(async () => {
  await redis.flushdb();
  await rows("UPDATE channels SET hold_minutes=$1 WHERE code='WEB'", [WEB_HOLD_MINUTES]);
  await resetConfig();
});

afterAll(async () => {
  await app?.close();
  await redis?.quit();
}, 30000);
