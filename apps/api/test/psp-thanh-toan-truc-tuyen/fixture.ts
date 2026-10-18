/**
 * Fixture tích hợp HB-094: app thật (`AppModule.register`) + CSDL tách riêng của
 * `test/idempotency/database.js` (migrate sạch) + **Redis DB `/6`** per ticket.
 *
 * Dữ kiện nền lấy từ `test/room-blocks/inventory-seed.js` (cơ sở `H029-A`, loại STD hai phòng, gói
 * `FLEX7`, 7 kênh, WEB hold 20 phút) — không dựng bộ seed thứ hai. Booking dùng cho các ca kiểm số
 * tiền được tạo **qua HTTP thật** (`POST /quotes` của HB-074 + `POST /bookings` của HB-077), để
 * `booking_charges` ROOM và snapshot học ở đúng đường sản phẩm, sổ cái đọc được (BR-PAY-02).
 *
 * Phiên khách: hai tuyến là tuyến khách (api.md §2.6) nhưng `/guest-auth` thuộc HB-017, nên fixture
 * phát hành đúng loại token mà HB-017 sẽ phát (`signAccessToken`, vai trò ngoài thang nhân viên) —
 * `book/bookings/principal.ts` đã có nhánh `GUEST` cho token này. Bộ khoá PSP **để trống** ⇒ adapter
 * chạy bộ mô phỏng cùng hợp đồng (AC4, sandbox chưa có).
 */
import 'reflect-metadata';
import { randomBytes, randomUUID } from 'node:crypto';
import { afterAll, beforeAll, expect } from 'vitest';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { Redis } from 'ioredis';
import request from 'supertest';
import { z } from 'zod';
import { bookingSummarySchema, quoteSchema, tokenPairSchema } from '@pinehill/contracts';
import type { AccessTokenClaims, BookingSummary, Quote } from '@pinehill/contracts';
import { AppModule } from '../../src/app.module.js';
import { CLOCK } from '../../src/infrastructure/ports.js';
import { signAccessToken } from '../../src/infrastructure/crypto/access-tokens.js';
import { pspSettings } from '../../src/modules/pay/psp/settings.js';
import { PspSimulator } from '../../src/modules/pay/psp/simulator.js';
import type { ApiConfig } from '../../src/config/env.js';
import { databaseUrl, password } from '../idempotency/database.js';
import { clock, propertyId, typeId, stay, userId } from '../room-blocks/inventory-seed.js';
import { rows } from '../idempotency/database.js';
export { rows };

let app: NestFastifyApplication;
let redis: Redis;
const secrets = {
  access: randomBytes(32).toString('hex'),
  refresh: randomBytes(32).toString('hex'),
};

export const http = () => request(app.getHttpServer());
export {
  clock,
  /** Cơ sở khác của seed dùng chung (H029-B) cho ca kiểm phạm vi ngoài. */
  otherPropertyId,
  propertyId,
  typeId,
  stay,
  userId,
} from '../room-blocks/inventory-seed.js';

const GUEST_ROLE = z.custom<AccessTokenClaims['role']>((value) => value === 'GUEST').parse('GUEST');

async function issueGuest(phone: string, fullName: string): Promise<{ id: string; token: string }> {
  const id = String(
    (
      await rows('INSERT INTO guests(full_name,phone) VALUES($1,$2) RETURNING id', [
        fullName,
        phone,
      ])
    )[0]?.id,
  );
  return { id, token: await guestTokenFor(id) };
}

/** Token phiên khách cho một `guests.id` đã có — HB-017 sẽ phát hành đúng loại này. */
export async function guestTokenFor(id: string): Promise<string> {
  const { token } = await signAccessToken(
    { userId: id, role: GUEST_ROLE, propertyScope: [], sessionId: randomUUID() },
    secrets.access,
    clock.now(),
  );
  return token;
}

export async function staffToken(role = 'FRONT_DESK'): Promise<string> {
  await rows('UPDATE users SET role=$1 WHERE id=$2::uuid', [role, userId]);
  const response = await http()
    .post('/api/v1/auth/login')
    .send({ username: 'h029-first', password });
  expect(response.status).toBe(200);
  return tokenPairSchema.parse(response.body).accessToken;
}

/** `POST /quotes` bằng chủ thể sẽ gọi đặt phòng — fingerprint của HB-074 gắn principal. */
export async function issueQuote(token: string, overrides: object = {}): Promise<Quote> {
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

/** Tạo booking hợp lệ qua đường sản phẩm (HB-077): HELD, có `booking_charges` ROOM cho sổ cái. */
export async function createBooking(
  guest: { fullName: string; phone: string },
  token: string = guestToken,
): Promise<CreatedBooking> {
  const quote = await issueQuote(token);
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
  return { quote, booking: bookingSummarySchema.parse(response.body) };
}

/** `POST /payments/online` — `token: null` để gửi lệnh **không** có Bearer, `key: null` để bỏ header. */
export function onlineRequest(
  body: Record<string, unknown>,
  options: { token?: string | null; key?: string | null } = {},
): request.Test {
  const call = http().post('/api/v1/payments/online');
  const token = options.token === undefined ? guestToken : options.token;
  if (token !== null) call.set('Authorization', `Bearer ${token}`);
  if (options.key !== null) call.set('Idempotency-Key', options.key ?? randomUUID());
  return call.send(body);
}

export function statusRequest(paymentId: string, token: string | null = guestToken): request.Test {
  const call = http().get(`/api/v1/payments/${paymentId}/status`);
  if (token !== null) call.set('Authorization', `Bearer ${token}`);
  return call;
}

export const onlineBody = (bookingId: string, overrides: object = {}): Record<string, unknown> => ({
  bookingId,
  type: 'DEPOSIT',
  method: 'VNPAY',
  amount: 907000,
  returnUrl: 'https://guest.app/booking/return',
  ...overrides,
});

/** Khoản thu đã ghi nhận (thay thế `POST /payments` của HB-096, ngoài phạm vi HB-077/HB-094). */
export async function seedPayment(
  bookingId: string,
  amount: number | bigint,
  options: { status?: string; type?: string } = {},
): Promise<string> {
  return String(
    (
      await rows(
        `INSERT INTO payments(booking_id,type,method,amount,status,idempotency_key,paid_at)
         VALUES($1::uuid,$2,'BANK_TRANSFER',$3,$4,$5,
                CASE WHEN $4='SUCCEEDED' THEN clock_timestamp() END)
         RETURNING id`,
        [bookingId, options.type ?? 'DEPOSIT', amount, options.status ?? 'SUCCEEDED', randomUUID()],
      )
    )[0]!.id,
  );
}

/** Booking thuần SQL cho các ca biên (đã kết thúc/sai phạm vi): không cần sổ cái vì chưa tới bước đó. */
export async function seedBooking(options: {
  property?: string;
  type?: string;
  status?: string;
  holdExpired?: boolean;
}): Promise<string> {
  const values = {
    property: propertyId,
    type: typeId,
    status: 'HELD',
    holdExpired: false,
    ...options,
  };
  const rateId = String(
    (await rows('SELECT id FROM rate_plans WHERE code=$1 LIMIT 1', ['FLEX7']))[0]!.id,
  );
  const channelId = String(
    (await rows('SELECT id FROM channels WHERE code=$1 LIMIT 1', ['WEB']))[0]!.id,
  );
  return String(
    (
      await rows(
        `INSERT INTO bookings(code,guest_id,property_id,room_type_id,rate_plan_id,channel_id,check_in,
             check_out,adults,deposit_percent,status,hold_expires_at,total_amount,deposit_amount,
             balance_due,currency,cancelled_at)
         VALUES($1,$2::uuid,$3::uuid,$4::uuid,$5::uuid,$6::uuid,$7,$8,1,30,$9,
                CASE WHEN $10 THEN clock_timestamp() - interval '90 seconds' ELSE clock_timestamp() + interval '20 minutes' END,
                1000000,300000,700000,'VND',
                CASE WHEN $9='CANCELLED' THEN clock_timestamp() END) RETURNING id`,
        [
          `PH-261101-${randomUUID().replaceAll('-', '').slice(0, 5).toUpperCase()}`,
          guestId,
          values.property,
          values.type,
          rateId,
          channelId,
          stay.checkIn,
          stay.checkOut,
          values.status,
          values.holdExpired,
        ],
      )
    )[0]!.id,
  );
}

export async function count(sql: string, values: unknown[] = []): Promise<number> {
  return Number((await rows(`SELECT count(*)::int AS total FROM (${sql}) t`, values))[0]?.total);
}

/** Đọc hàng CSDL và parse zod theo lược đồ do test khai (QT §2: không `as`). */
export async function rowsOf<S extends z.ZodType>(
  sql: string,
  schema: S,
  values: unknown[] = [],
): Promise<z.infer<S>[]> {
  return z.array(schema).parse(await rows(sql, values));
}

/** Dùng lại bộ mô phỏng đúng **cùng cấu hình** của app đang chạy (AC4: cùng hợp đồng, cùng khoá). */
export function pspSimulator() {
  return new PspSimulator(pspSettings(appConfig));
}

export let appConfig: ApiConfig;
export let guestId = '';
export let guestToken = '';
export let otherGuestToken = '';

beforeAll(async () => {
  if (!process.env.REDIS_URL) throw new Error('HB-094 requires Redis7; no skip fallback');
  const url = new URL(process.env.REDIS_URL);
  url.pathname = '/6';
  redis = new Redis(url.href);
  await redis.ping();
  const runtime = new URL(databaseUrl);
  appConfig = {
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
  // Bậc chính sách huỷ cho gói của seed dùng chung (`inventory-seed` chỉ tạo `cancellation_policies`).
  // `POST /bookings` (HB-077) chốt snapshot chính sách, gây lỗi `E_RATE_CONFIGURATION_INVALID` nếu thiếu.
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
  const guest = await issueGuest('+84900000094', 'HB-094 Guest');
  guestId = guest.id;
  guestToken = guest.token;
  const other = await issueGuest('+84900000095', 'HB-094 Other guest');
  otherGuestToken = other.token;
}, 120000);

afterAll(async () => {
  await app?.close();
  await redis?.quit();
}, 30000);
