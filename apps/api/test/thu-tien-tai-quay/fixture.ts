/**
 * Fixture tích hợp HB-096: app thật (`AppModule.register`) + CSDL tách riêng của
 * `test/idempotency/database.js` (migrate sạch) + **Redis DB `/13`** theo phân DB của main-agent.
 *
 * Dữ kiện nền lấy từ `test/room-blocks/inventory-seed.js` (cơ sở `H029-A`/`H029-B`, gói `FLEX7`, 7 kênh)
 * — không dựng bộ seed thứ hai. Booking `HELD` tạo qua đúng hành trình khách của HB-077
 * (`POST /quotes` → `POST /bookings`) nên có `booking_charges` ROOM khớp `total_amount`, đủ điều kiện
 * cho sổ cái HB-093. Phiên khách phát đúng loại token HB-017 sẽ phát (tuyến BOOK là `@Public`); phiên
 * nhân viên dùng `POST /auth/login` thật. Fixture nâng `WEB.hold_minutes` lên 20 phút (giá trị thật của
 * kênh WEB) để booking vào `HELD`.
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
  pinTokenSchema,
  quoteSchema,
  tokenPairSchema,
} from '@pinehill/contracts';
import type { AccessTokenClaims, BookingSummary, Quote } from '@pinehill/contracts';
import { AppModule } from '../../src/app.module.js';
import { CLOCK } from '../../src/infrastructure/ports.js';
import { signAccessToken } from '../../src/infrastructure/crypto/access-tokens.js';
import {
  clock,
  databaseUrl,
  otherPropertyId,
  password,
  propertyId,
  rows,
  secondUserId,
  userId,
} from '../idempotency/database.js';
import { otherTypeId, stay, typeId } from '../room-blocks/inventory-seed.js';

export const PIN = '123456';
/** Hạn giữ chỗ thật của kênh WEB (seed `reference-data.ts`); seed dùng chung để mặc định 0. */
export const WEB_HOLD_MINUTES = 20;

let app: NestFastifyApplication;
let redis: Redis;
const secrets = {
  access: randomBytes(32).toString('hex'),
  refresh: randomBytes(32).toString('hex'),
};

const GUEST_ROLE = z.custom<AccessTokenClaims['role']>((value) => value === 'GUEST').parse('GUEST');

export const http = () => request(app.getHttpServer());

/** Token phiên khách cho một `guests.id` đã có — HB-017 sẽ phát hành đúng loại này. */
export async function guestTokenFor(id: string): Promise<string> {
  const { token } = await signAccessToken(
    { userId: id, role: GUEST_ROLE, propertyScope: [], sessionId: randomUUID() },
    secrets.access,
    clock.now(),
  );
  return token;
}

/** Tạo guest + token của chính họ. */
export async function issueGuest(
  phone: string,
  fullName: string,
): Promise<{ id: string; token: string }> {
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

/** Phiên nhân viên thật qua `POST /auth/login` (HB-013); đổi vai trò trước khi đăng nhập. */
export async function staffToken(
  role = 'FRONT_DESK',
  username: 'h029-first' | 'h029-second' = 'h029-first',
): Promise<string> {
  const id = username === 'h029-first' ? userId : secondUserId;
  await rows('UPDATE users SET role=$1 WHERE id=$2::uuid', [role, id]);
  const response = await http().post('/api/v1/auth/login').send({ username, password });
  expect(response.status).toBe(200);
  return tokenPairSchema.parse(response.body).accessToken;
}

/** Đặt PIN rồi mở khoá để nhận `pinToken` (HB-015) — gắn `bookingId` khi có. */
export async function pinTokenFor(token: string, bookingId?: string): Promise<string> {
  const saved = await http()
    .put('/api/v1/auth/pin')
    .set('Authorization', `Bearer ${token}`)
    .send({ pin: PIN, currentPassword: password });
  expect(saved.status).toBe(204);
  const opened = await http()
    .post('/api/v1/auth/pin/verify')
    .set('Authorization', `Bearer ${token}`)
    .send(bookingId === undefined ? { pin: PIN } : { pin: PIN, bookingId });
  expect(opened.status, JSON.stringify(opened.body)).toBe(200);
  return pinTokenSchema.parse(opened.body).pinToken;
}

export let guestToken = '';
export let otherGuestToken = '';

/** `POST /quotes` bằng chính chủ thể sẽ gọi đặt phòng — fingerprint gắn principal. */
export async function issueQuote(
  overrides: object = {},
  token: string = guestToken,
): Promise<Quote> {
  const principal = token;
  const response = await http()
    .post('/api/v1/quotes')
    .set('Authorization', `Bearer ${principal}`)
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
  expect(response.status).toBe(201);
  return quoteSchema.parse(response.body);
}

/**
 * Dịch ngày lịch (thuần chuỗi `YYYY-MM-DD`) — mỗi booking một kỳ khác nhau để không trùng lịch/nhân bản
 * (BR-BOOK-16: cùng kênh + SĐT + loại phòng + ngày nhận phòng trong 24h ⇒ cờ nghi trùng) và không tranh
 * chỗ gán phòng.
 */
function shiftDate(date: string, days: number): string {
  const shifted = new Date(`${date}T00:00:00.000Z`);
  shifted.setUTCDate(shifted.getUTCDate() + days);
  return shifted.toISOString().slice(0, 10);
}

let bookingSequence = 0;

export interface HeldBooking {
  readonly quote: Quote;
  readonly booking: BookingSummary;
}

/** Tạo booking `HELD` (kênh WEB có hold) đúng hành trình HB-077 — kèm `booking_charges` ROOM. */
export async function createBooking(
  options: {
    token?: string;
    property?: string;
    roomType?: string;
    phone?: string;
    checkIn?: string;
    checkOut?: string;
  } = {},
): Promise<HeldBooking> {
  const property = options.property ?? propertyId;
  const roomType = options.roomType ?? typeId;
  const token = options.token ?? guestToken;
  // Mỗi lần gọi dịch 4 ngày (> độ dài 3 đêm) để các kỳ không chồng nhau: không nghi trùng
  // (BR-BOOK-16) và không tranh chỗ gán phòng của loại STD chỉ có 2 phòng.
  const offset = options.checkIn === undefined ? bookingSequence++ * 4 : 0;
  const checkIn = options.checkIn ?? shiftDate(stay.checkIn, offset);
  const checkOut = options.checkOut ?? shiftDate(stay.checkOut, offset);
  const quote = await issueQuote(
    { propertyId: property, roomTypeId: roomType, checkIn, checkOut },
    token,
  );
  const response = await http()
    .post('/api/v1/bookings')
    .set('Authorization', `Bearer ${token}`)
    .set('Idempotency-Key', randomUUID())
    .send({
      quoteId: quote.quoteId,
      propertyId: property,
      roomTypeId: roomType,
      ratePlanCode: 'FLEX7',
      channelCode: 'WEB',
      checkIn,
      checkOut,
      adults: 2,
      children: 0,
      roomCount: 1,
      guest: { fullName: 'HB-096 Guest', phone: options.phone ?? '0900000096' },
    });
  expect(response.status, JSON.stringify(response.body)).toBe(201);
  return { quote, booking: bookingSummarySchema.parse(response.body) };
}

/** `POST /payments` — `token: null` để gửi lệnh không Bearer, `key: null` để bỏ `Idempotency-Key`. */
export function collectRequest(
  body: object,
  options: { token?: string | null; key?: string | null } = {},
): request.Test {
  const call = http().post('/api/v1/payments');
  if (options.token !== null && options.token !== undefined)
    call.set('Authorization', `Bearer ${options.token}`);
  if (options.key !== null) call.set('Idempotency-Key', options.key ?? randomUUID());
  return call.send(body);
}

export function balanceRequest(
  bookingId: string,
  options: { token?: string | null } = {},
): request.Test {
  const call = http().get(`/api/v1/bookings/${bookingId}/balance`);
  if (options.token !== null && options.token !== undefined)
    call.set('Authorization', `Bearer ${options.token}`);
  return call;
}

/**
 * Bậc chính sách huỷ cho gói của seed dùng chung (`inventory-seed` chỉ tạo `cancellation_policies`).
 * `POST /bookings` (HB-077) đòi **ít nhất một bậc** — đúng dữ liệu thật của seed sản phẩm (FLEX7).
 */
async function seedCancellationTiers(): Promise<void> {
  const policyId = String(
    (await rows('SELECT id FROM cancellation_policies ORDER BY created_at, id LIMIT 1'))[0]!.id,
  );
  await rows(
    `INSERT INTO cancellation_tiers(policy_id,offset_hours,refund_percent,charge_first_night,label,sort_order)
     VALUES ($1::uuid,168,100,false,'Từ 168 giờ',1),
            ($1::uuid,24,50,false,'Từ 24 giờ',2),
            ($1::uuid,-1,0,true,'Bậc bắt tất',3)`,
    [policyId],
  );
}

export {
  clock,
  rows,
  propertyId,
  otherPropertyId,
  typeId,
  otherTypeId,
  userId,
  secondUserId,
  password,
};

beforeAll(async () => {
  if (!process.env.REDIS_URL)
    throw new Error('HB-096 requires PostgreSQL16 + Redis7; no skip fallback');
  const url = new URL(process.env.REDIS_URL);
  url.pathname = '/13';
  redis = new Redis(url.href);
  await redis.ping();
  const registered = AppModule.register({
    DATABASE_URL: new URL(databaseUrl).href,
    REDIS_URL: url.href,
    JWT_ACCESS_SECRET: secrets.access,
    JWT_REFRESH_SECRET: secrets.refresh,
    BUSINESS_TIMEZONE: 'Asia/Ho_Chi_Minh',
    IDEMPOTENCY_TTL_HOURS: 24,
    LOG_LEVEL: 'error',
    HOST: '127.0.0.1',
    PORT: 0,
  });
  app = await NestFactory.create<NestFastifyApplication>(
    {
      ...registered,
      providers: [
        ...(registered.providers ?? []).filter(
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
  await rows('UPDATE channels SET hold_minutes=$1 WHERE code=$2', [WEB_HOLD_MINUTES, 'WEB']);
  await seedCancellationTiers();
  const guest = await issueGuest('+84900000096', 'HB-096 Guest');
  guestToken = guest.token;
  const other = await issueGuest('+84900000097', 'HB-096 Other guest');
  otherGuestToken = other.token;
}, 120000);

afterAll(async () => {
  await app?.close();
  await redis?.quit();
}, 30000);

beforeEach(async () => {
  await rows('DELETE FROM user_pins');
  await rows('DELETE FROM pin_grants');
  await rows('UPDATE users SET failed_login_count=0, locked_until=null WHERE id=ANY($1::uuid[])', [
    [userId, secondUserId],
  ]);
  await rows('DELETE FROM user_property_scopes WHERE user_id=ANY($1::uuid[])', [
    [userId, secondUserId],
  ]);
  await rows(
    'INSERT INTO user_property_scopes(user_id,property_id) VALUES($1::uuid,$3::uuid),($2::uuid,$3::uuid)',
    [userId, secondUserId, propertyId],
  );
});
