/**
 * Fixture tích hợp HB-095: app thật (`AppModule.register`) + CSDL riêng của `test/idempotency/database.js`
 * (migrate sạch, runtime vai `app_rw`) + **Redis DB `/7`** đúng ticket (HB-094 dùng `/6`, HB-099 `/15`).
 *
 * Booking tạo **qua đường sản phẩm** (`POST /quotes` + `POST /bookings`) để `booking_charges` ROOM
 * xuất hiện đúng cho sổ cái; khoản thu online dùng chính `POST /payments/online` (HB-094) — `orderRef`
 * là Idempotency-Key mà BR-PAY-03 đối chiếu callback; callback mô phỏng bằng `PspSimulator` (HB-094)
 * cùng `PspSettings` của app, nên chữ ký đi qua đúng đường xác minh thật của adapter (không dựng bộ
 * ký thứ hai — cùng hợp đồng HB-094).
 */
import 'reflect-metadata';
import { randomBytes, randomUUID } from 'node:crypto';
import { afterAll, beforeAll, expect } from 'vitest';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { Redis } from 'ioredis';
import request from 'supertest';
import { z } from 'zod';
import { bookingSummarySchema, paymentSchema, quoteSchema } from '@pinehill/contracts';
import type { AccessTokenClaims, BookingSummary, Payment, Quote } from '@pinehill/contracts';
import { AppModule } from '../../src/app.module.js';
import { CLOCK } from '../../src/infrastructure/ports.js';
import { signAccessToken } from '../../src/infrastructure/crypto/access-tokens.js';
import { pspSettings } from '../../src/modules/pay/psp/settings.js';
import { PspSimulator } from '../../src/modules/pay/psp/simulator.js';
import type { ApiConfig } from '../../src/config/env.js';
import { databaseUrl } from '../idempotency/database.js';
import { clock, rows, propertyId, typeId, stay } from '../room-blocks/inventory-seed.js';

let app: NestFastifyApplication;
let redis: Redis;
let token = '';
const secrets = {
  access: randomBytes(32).toString('hex'),
  refresh: randomBytes(32).toString('hex'),
};

export const http = () => request(app.getHttpServer());
export {
  clock,
  rows,
  propertyId,
  otherPropertyId,
  typeId,
  otherTypeId,
  stay,
  userId,
} from '../room-blocks/inventory-seed.js';
const GUEST_ROLE = z.custom<AccessTokenClaims['role']>((value) => value === 'GUEST').parse('GUEST');

/** `POST /quotes` thật của HB-074: giá và cọc do engine trả — test không tự tính lại (BR-RATE-17). */
export async function issueQuote(overrides: object = {}): Promise<Quote> {
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

/** `POST /bookings` thật của HB-077: HELD, có `booking_charges` ROOM cho sổ cái đọc được (BR-PAY-02). */
export async function createBooking(
  guest: { fullName: string; phone: string },
  overrides: object = {},
): Promise<BookingSummary> {
  const quote = await issueQuote(overrides);
  const response = await http()
    .post('/api/v1/bookings')
    .set('Authorization', `Bearer ${token}`)
    .set('Idempotency-Key', randomUUID())
    .send({
      propertyId,
      roomTypeId: typeId,
      ratePlanCode: 'FLEX7',
      channelCode: 'WEB',
      checkIn: stay.checkIn,
      checkOut: stay.checkOut,
      adults: 2,
      children: 0,
      roomCount: 1,
      guest,
      quoteId: quote.quoteId,
    });
  expect(response.status, JSON.stringify(response.body)).toBe(201);
  return bookingSummarySchema.parse(response.body);
}

/** `POST /payments/online` thật của HB-094: `Payment PENDING`, `orderRef` = Idempotency-Key (BR-PAY-03). */
export async function initiateOnlineDeposit(
  booking: BookingSummary,
  overrides: object = {},
): Promise<Payment> {
  const response = await http()
    .post('/api/v1/payments/online')
    .set('Authorization', `Bearer ${token}`)
    .set('Idempotency-Key', randomUUID())
    .send({
      bookingId: booking.id,
      type: 'DEPOSIT',
      method: 'VNPAY',
      amount: booking.depositAmount,
      returnUrl: 'https://guest.app/booking/return',
      ...overrides,
    });
  expect(response.status, JSON.stringify(response.body)).toBe(201);
  return paymentSchema.parse(response.body);
}

/** Callback PSP thô đúng định dạng/giá/khóa, bằng bộ mô phỏng **cùng cấu hình** với app (AC4). */
export function pspSimulator(): PspSimulator {
  return new PspSimulator(pspSettings(appConfig));
}

export function callbackUrl(method: 'vnpay' | 'momo'): string {
  return `/api/v1/integrations/psp/${method}/callback`;
}

export async function count(sql: string, values: unknown[] = []): Promise<number> {
  return Number((await rows(`SELECT count(*)::int AS total FROM (${sql}) t`, values))[0]?.total);
}

/** Trạng thái booking theo CSDL — kiểm "không hạ trạng thái booking" (TN-2/3). */
export async function bookingStatus(id: string): Promise<string> {
  return String((await rows('SELECT status FROM bookings WHERE id=$1::uuid', [id]))[0]?.status);
}

const auditRowSchema = z.object({
  action: z.string(),
  after_json: z.record(z.string(), z.unknown()).nullable(),
});
export type AuditRow = z.infer<typeof auditRowSchema>;

/** Bản audit của một Payment — kiểm "audit mỗi sự kiện" và "không thẻ/PII" (BR-PAY-04). */
export async function auditOf(paymentId: string): Promise<AuditRow[]> {
  return z.array(auditRowSchema).parse(
    await rows(
      `SELECT action,after_json FROM audit_logs
          WHERE entity_type='Payment' AND entity_id=$1::uuid ORDER BY created_at, chain_seq`,
      [paymentId],
    ),
  );
}

const paymentRowSchema = z.object({
  status: z.string(),
  provider_txn_id: z.string().nullable(),
  amount: z.string(),
  paid_at: z.date().nullable(),
});

export type PaymentRow = z.infer<typeof paymentRowSchema>;

export async function paidRow(paymentId: string): Promise<PaymentRow> {
  return z
    .array(paymentRowSchema)
    .parse(
      await rows(
        'SELECT status,provider_txn_id,amount::text AS amount,paid_at FROM payments WHERE id=$1::uuid',
        [paymentId],
      ),
    )[0]!;
}

export let appConfig: ApiConfig;
export let mockAppConfig: ApiConfig;
/** Mã đối tác của bộ khoá **thật** dùng trong test (khác giá trị mô phỏng công khai của `pay/psp`). */
export const MERCHANT_CODE = 'HB095TEST';

/** App thứ hai chạy `mode: 'mock'` (thiếu khoá thật) — dùng cho ca P0/F1; cùng CSDL, cùng Redis. */
export async function createMockModeApp(): Promise<NestFastifyApplication> {
  const module = AppModule.register(mockAppConfig);
  const instance = await NestFactory.create<NestFastifyApplication>(
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
  instance.setGlobalPrefix('api/v1');
  await instance.init();
  await instance.getHttpAdapter().getInstance().ready();
  return instance;
}

beforeAll(async () => {
  if (!process.env.REDIS_URL) throw new Error('HB-095 requires Redis; no skip fallback');
  const url = new URL(process.env.REDIS_URL);
  url.pathname = '/7';
  redis = new Redis(url.href);
  await redis.ping();
  const runtime = new URL(databaseUrl);
  const base: ApiConfig = {
    DATABASE_URL: runtime.href,
    REDIS_URL: url.href,
    JWT_ACCESS_SECRET: secrets.access,
    JWT_REFRESH_SECRET: secrets.refresh,
    BUSINESS_TIMEZONE: 'Asia/Ho_Chi_Minh',
    IDEMPOTENCY_TTL_HOURS: 24,
    LOG_LEVEL: 'error',
    HOST: '127.0.0.1',
    PORT: 0,
  };
  // Bộ khoá **thật** (khác giá trị mô phỏng công khai của `pay/psp`) ⇒ `mode = 'live'`; HB-095 từ chối
  // mọi callback khi còn chạy khoá mô phỏng (P0/F1) nên các ca dưới đây đi đúng đường live.
  const pspKeys = {
    VNPAY_TMN_CODE: MERCHANT_CODE,
    VNPAY_HASH_SECRET: randomBytes(32).toString('hex'),
    MOMO_PARTNER_CODE: MERCHANT_CODE,
    MOMO_ACCESS_KEY: randomBytes(16).toString('hex'),
    MOMO_SECRET_KEY: randomBytes(32).toString('hex'),
  };
  appConfig = { ...base, ...pspKeys };
  // Cùng app nhưng **thiếu** khoá PSP ⇒ adapter chạy bộ mô phỏng công khai (mode `mock`).
  mockAppConfig = base;
  const module = AppModule.register(appConfig);
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
  // Bậc chính sách cho gói seed dùng chung (`inventory-seed` chỉ tạo policy); thiếu ⇒
  // `POST /bookings` lỗi `E_RATE_CONFIGURATION_INVALID` (HB-077 chốt snapshot khi tạo booking).
  const policyId = String(
    (await rows('SELECT id FROM cancellation_policies ORDER BY created_at, id LIMIT 1'))[0]!.id,
  );
  await rows(
    `INSERT INTO cancellation_tiers(policy_id,offset_hours,refund_percent,charge_first_night,label,sort_order)
     VALUES ($1::uuid,168,100,false,'Từ 168 giờ',1),($1::uuid,24,50,false,'Từ 24 giờ',2),
            ($1::uuid,-1,0,true,'Bậc bắt tất',3)`,
    [policyId],
  );
  await rows('UPDATE channels SET hold_minutes=$1 WHERE code=$2', [20, 'WEB']);
  // Phiên khách phải gắn **hàng `guests` thật**: `POST /bookings` phân giải chủ thể qua `bookingCaller`
  // (HB-077) nên token cho `users.id` sẽ hỏng ở bước tạo booking (QĐ-04: fixture phát đúng loại token
  // mà HB-017 sẽ phát).
  const guestId = String(
    (
      await rows('INSERT INTO guests(full_name,phone) VALUES($1,$2) RETURNING id', [
        'HB-095 Guest',
        '+84900000095',
      ])
    )[0]?.id,
  );
  token = (
    await signAccessToken(
      { userId: guestId, role: GUEST_ROLE, propertyScope: [], sessionId: randomUUID() },
      secrets.access,
      clock.now(),
    )
  ).token;
}, 120000);

afterAll(async () => {
  await app?.close();
  await redis?.quit();
}, 30000);
