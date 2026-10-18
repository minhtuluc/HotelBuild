/**
 * Fixture tích hợp HB-077: app thật (`AppModule.register`) + CSDL tách riêng của
 * `test/idempotency/database.js` (migrate sạch) + **Redis DB `/4`** theo phân DB của main-agent
 * (HB-077 → `/4`).
 *
 * Dữ kiện nền lấy từ `test/room-blocks/inventory-seed.js` (cơ sở `H029-A`, loại phòng `STD` hai phòng
 * `R1`/`R2`, gói `FLEX7`, 7 kênh) — không dựng bộ seed thứ hai. Fixture nâng `WEB.hold_minutes` lên 20
 * phút (giá trị thật của kênh WEB trong `apps/api/prisma/seed/reference-data.ts`) vì seed dùng chung chỉ
 * khai `code/name/multiplier`.
 *
 * Phiên khách: ba tuyến của journey đặt phòng là tuyến khách (api.md §2.5) nhưng `/guest-auth` thuộc
 * HB-017, nên fixture phát hành đúng loại token mà HB-017 sẽ phát (cùng `signAccessToken`, vai trò ngoài
 * thang nhân viên) — `principal.ts` của module đã có nhánh `GUEST` cho token này. Phiên nhân viên dùng
 * đường thật `POST /auth/login` của hai người dùng do fixture CSDL tạo.
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
import { databaseUrl, password } from '../idempotency/database.js';
import {
  booking,
  clock,
  rows,
  propertyId,
  otherPropertyId,
  typeId,
  otherTypeId,
  roomId,
  room2Id,
  stay,
  userId,
} from '../room-blocks/inventory-seed.js';

let app: NestFastifyApplication;
let redis: Redis;
const secrets = {
  access: randomBytes(32).toString('hex'),
  refresh: randomBytes(32).toString('hex'),
};

export const http = () => request(app.getHttpServer());
/** Hạn giữ chỗ thật của kênh WEB (seed `reference-data.ts`); seed dùng chung để mặc định 0. */
export const WEB_HOLD_MINUTES = 20;
export {
  booking,
  clock,
  rows,
  propertyId,
  otherPropertyId,
  typeId,
  otherTypeId,
  roomId,
  room2Id,
  stay,
  userId,
};

export let guestId = '';
export let guestToken = '';
export let otherGuestId = '';
export let otherGuestToken = '';

/** SĐT của phiên khách chính (dạng nội địa để chứng minh chuẩn hoá `+84…` ở biên vào). */
export const GUEST_PHONE = '0900000077';
export const OTHER_GUEST_PHONE = '0900000087';

/**
 * Vai trò phiên khách do HB-017 phát hành. `GUEST` **không** nằm trong `userRoleSchema` hiện hành nên
 * không viết thẳng vào `AccessTokenInput` được; lấy giá trị qua zod (`z.custom`, QT §2 cấm `as`).
 */
const GUEST_ROLE = z.custom<AccessTokenClaims['role']>((value) => value === 'GUEST').parse('GUEST');

/** Token phiên khách cho một `guests.id` đã có — HB-017 sẽ phát hành đúng loại này. */
export async function guestTokenFor(id: string): Promise<string> {
  const { token } = await signAccessToken(
    { userId: id, role: GUEST_ROLE, propertyScope: [], sessionId: randomUUID() },
    secrets.access,
    clock.now(),
  );
  return token;
}

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

/** Phiên nhân viên thật qua `POST /auth/login` (HB-013); đổi vai trò người dùng trước khi đăng nhập. */
export async function staffToken(role = 'FRONT_DESK'): Promise<string> {
  await rows('UPDATE users SET role=$1 WHERE id=$2::uuid', [role, userId]);
  const response = await http()
    .post('/api/v1/auth/login')
    .send({ username: 'h029-first', password });
  expect(response.status).toBe(200);
  return tokenPairSchema.parse(response.body).accessToken;
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
  guest: { fullName: 'HB-077 Guest', phone: GUEST_PHONE },
  ...overrides,
});

/**
 * `POST /bookings` — `token: null` để gửi lệnh **không** có Bearer, `key: null` để bỏ `Idempotency-Key`.
 */
export function bookingRequest(
  body: object,
  options: { token?: string | null; key?: string | null } = {},
): request.Test {
  const call = http().post('/api/v1/bookings');
  const token = options.token === undefined ? guestToken : options.token;
  if (token !== null) call.set('Authorization', `Bearer ${token}`);
  if (options.key !== null) call.set('Idempotency-Key', options.key ?? randomUUID());
  return call.send(body);
}

export function confirmRequest(
  bookingId: string,
  paymentId: string,
  options: { token?: string | null; key?: string | null } = {},
): request.Test {
  const call = http().post(`/api/v1/bookings/${bookingId}/confirm`);
  const token = options.token === undefined ? guestToken : options.token;
  if (token !== null) call.set('Authorization', `Bearer ${token}`);
  if (options.key !== null) call.set('Idempotency-Key', options.key ?? randomUUID());
  return call.send({ paymentId });
}

export function listRequest(
  query: Record<string, string | number> = {},
  options: { token?: string | null } = {},
): request.Test {
  const call = http().get('/api/v1/bookings');
  const token = options.token === undefined ? guestToken : options.token;
  if (token !== null) call.set('Authorization', `Bearer ${token}`);
  return call.query(query);
}

export function getRequest(
  bookingId: string,
  options: { token?: string | null } = {},
): request.Test {
  const call = http().get(`/api/v1/bookings/${bookingId}`);
  const token = options.token === undefined ? guestToken : options.token;
  if (token !== null) call.set('Authorization', `Bearer ${token}`);
  return call;
}

/** `POST /quotes` (HB-074) bằng chính chủ thể sẽ gọi đặt phòng — fingerprint gắn principal. */
export async function issueQuote(overrides: object = {}, token = guestToken): Promise<Quote> {
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
  expect(response.status).toBe(201);
  return quoteSchema.parse(response.body);
}

export interface CreatedBooking {
  readonly quote: Quote;
  readonly booking: BookingSummary;
  readonly key: string;
}

/** Tạo booking hợp lệ (quote mới + lệnh mới) và trả cả quote để ca sau dùng lại. */
export async function createBooking(
  overrides: object = {},
  options: { token?: string | null; quote?: Quote; checkIn?: string; checkOut?: string } = {},
): Promise<CreatedBooking> {
  const token = options.token === undefined ? guestToken : options.token;
  const checkIn = options.checkIn ?? stay.checkIn;
  const checkOut = options.checkOut ?? stay.checkOut;
  // Quote phải cùng kỳ với lệnh: fingerprint của HB-074 băm cả `checkIn`/`checkOut`.
  const quote = options.quote ?? (await issueQuote({ checkIn, checkOut }, token ?? undefined));
  const key = randomUUID();
  const response = await bookingRequest(
    { ...bookingBody({ checkIn, checkOut }), ...overrides, quoteId: quote.quoteId },
    { token, key },
  );
  expect(response.status, JSON.stringify(response.body)).toBe(201);
  return { quote, booking: bookingSummarySchema.parse(response.body), key };
}

/**
 * Khoản thu đã ghi nhận cho booking — thay cho đường `POST /payments` của HB-096 (ngoài phạm vi HB-077).
 * `method` khác `CASH` để không vướng `ck_payments_cash_shift` (khoản CASH phải gắn `created_by`).
 */
export async function seedPayment(
  bookingId: string,
  amount: number | bigint,
  options: { status?: string; type?: string } = {},
): Promise<string> {
  const id = String(
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
  return id;
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

/**
 * Bậc chính sách huỷ cho gói của seed dùng chung (`test/room-blocks/inventory-seed.js` chỉ tạo
 * `cancellation_policies` mà không tạo `cancellation_tiers`). Bản chốt `policy_snapshot_json` (HB-077) và
 * `CancelBookingUseCase` (HB-097) đều đòi **ít nhất một bậc** — đúng dữ liệu thật của seed sản phẩm
 * (`apps/api/prisma/seed/reference-data.ts`) với thang BR-CANCEL-01 của FLEX7.
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

beforeAll(async () => {
  if (!process.env.REDIS_URL) throw new Error('HB-077 requires Redis7; no skip fallback');
  const url = new URL(process.env.REDIS_URL);
  url.pathname = '/4';
  redis = new Redis(url.href);
  await redis.ping();
  const runtime = new URL(databaseUrl);
  const module = AppModule.register({
    DATABASE_URL: runtime.href,
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
  await rows('UPDATE channels SET hold_minutes=$1 WHERE code=$2', [WEB_HOLD_MINUTES, 'WEB']);
  await seedCancellationTiers();
  const guest = await issueGuest('+84900000077', 'HB-077 Guest');
  guestId = guest.id;
  guestToken = guest.token;
  const other = await issueGuest('+84900000087', 'HB-077 Other guest');
  otherGuestId = other.id;
  otherGuestToken = other.token;
}, 120000);

afterAll(async () => {
  await app?.close();
  await redis?.quit();
}, 30000);
