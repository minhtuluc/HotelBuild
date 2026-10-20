/**
 * Fixture tích hợp HB-151: app thật (`AppModule.register`) + CSDL tách riêng của
 * `test/idempotency/database.js` (migrate sạch) + **Redis DB `/12`** theo phân DB của main-agent.
 *
 * Dữ kiện nền lấy từ `test/room-blocks/inventory-seed.js` (cơ sở `H029-A`, loại `STD`, gói `FLEX7`, 7
 * kênh) — không dựng bộ seed thứ hai. Fixture chỉ đưa kênh `WALKIN` về đúng cấu hình thật của
 * `prisma/seed/reference-data.ts` (hệ số 1,10; `hold_minutes = 0`) trước mỗi ca, vì mỗi ca có quyền
 * sửa cấu hình kênh để kiểm "kênh do cấu hình quyết định".
 *
 * Phiên nhân viên dùng đường thật `POST /auth/login` (HB-013); `pinToken` dùng đường thật
 * `PUT /auth/pin` + `POST /auth/pin/verify` (HB-015). Booking sinh ra từ chính lệnh walk-in nên không
 * dựng tay hàng CSDL nào.
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
import { AppModule } from '../../src/app.module.js';
import { CLOCK } from '../../src/infrastructure/ports.js';
import {
  databaseUrl,
  clock,
  otherPropertyId,
  password,
  rows,
  userId,
} from '../idempotency/database.js';
import { propertyId, typeId } from '../room-blocks/inventory-seed.js';

let app: NestFastifyApplication;
let redis: Redis;

export const http = () => request(app.getHttpServer());
export { clock, databaseUrl, otherPropertyId, rows, userId, propertyId, typeId };

/** PIN tổng hợp cho mọi ca — không phải PIN thật của người dùng nào. */
export const PIN = '123456';

/** Hình dạng phản hồi `POST /walk-in` (oracle của test, không import schema của module). */
export const walkInResponseSchema = z.object({
  created: z.boolean(),
  quote: quoteSchema,
  booking: bookingSummarySchema,
});
export type WalkInResponse = z.infer<typeof walkInResponseSchema>;

const civil = (value: number | Date): string => new Date(value).toISOString().slice(0, 10);

/** Ngày nghiệp vụ theo `Clock` tiêm (2026-10-09 UTC = 07:00 cùng ngày ở Asia/Ho_Chi_Minh). */
export const today = (): string => civil(clock.value);
export const nextDay = (date: string): string =>
  civil(Date.parse(`${date}T00:00:00.000Z`) + 86_400_000);

let phoneSequence = 0;
/** SĐT tổng hợp khác nhau mỗi lần gọi (BR-BOOK-16 chỉ nghi trùng khi cùng SĐT + kỳ). */
export const uniquePhone = (): string => `090000${String(++phoneSequence).padStart(4, '0')}`;

export function walkInBody(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const checkIn = today();
  return {
    propertyId,
    roomTypeId: typeId,
    ratePlanCode: 'FLEX7',
    checkIn,
    checkOut: nextDay(checkIn),
    adults: 2,
    children: 0,
    roomCount: 1,
    guest: { fullName: 'Khách Vãng Lai', phone: uniquePhone() },
    ...overrides,
  };
}

export function walkInRequest(
  body: object,
  options: { token: string; key?: string; omitKey?: boolean },
): request.Test {
  const call = http().post('/api/v1/walk-in').set('Authorization', `Bearer ${options.token}`);
  if (options.omitKey !== true) call.set('Idempotency-Key', options.key ?? randomUUID());
  return call.send(body);
}

/** Phiên nhân viên thật; đổi vai trò trước khi đăng nhập để `RbacGuard` đọc lại từ CSDL. */
export async function staffToken(role = 'FRONT_DESK'): Promise<string> {
  await rows('UPDATE users SET role=$1 WHERE id=$2::uuid', [role, userId]);
  const response = await http()
    .post('/api/v1/auth/login')
    .send({ username: 'h029-first', password });
  expect(response.status, JSON.stringify(response.body)).toBe(200);
  return tokenPairSchema.parse(response.body).accessToken;
}

/** `pinToken` một lần gắn đúng `bookingId` (HB-015) — điều kiện bắt buộc của `POST /payments`. */
export async function pinTokenFor(token: string, bookingId: string): Promise<string> {
  const saved = await http()
    .put('/api/v1/auth/pin')
    .set('Authorization', `Bearer ${token}`)
    .send({ pin: PIN, currentPassword: password });
  expect(saved.status, JSON.stringify(saved.body)).toBe(204);
  const opened = await http()
    .post('/api/v1/auth/pin/verify')
    .set('Authorization', `Bearer ${token}`)
    .send({ pin: PIN, bookingId });
  expect(opened.status, JSON.stringify(opened.body)).toBe(200);
  return pinTokenSchema.parse(opened.body).pinToken;
}

/** Thân `POST /payments` của bước thu cọc (HB-096) — phải giữ nguyên từng byte khi replay. */
export function depositBody(bookingId: string, amount: number, pinToken: string) {
  return { bookingId, type: 'DEPOSIT' as const, method: 'CASH' as const, amount, pinToken };
}

export function paymentRequest(body: object, token: string, key = randomUUID()): request.Test {
  return http()
    .post('/api/v1/payments')
    .set('Authorization', `Bearer ${token}`)
    .set('Idempotency-Key', key)
    .send(body);
}

export interface ChannelConfig {
  readonly id: string;
  readonly status: string;
  readonly hold_minutes: number;
}

/** Cấu hình kênh `WALKIN` đọc từ CSDL — nguồn của mọi quyết định kênh trong lệnh. */
export async function channelConfig(): Promise<ChannelConfig> {
  const [row] = await rows("SELECT id, status, hold_minutes FROM channels WHERE code='WALKIN'");
  return z
    .object({ id: z.string(), status: z.string(), hold_minutes: z.number().int() })
    .parse(row);
}

export async function count(sql: string, values: unknown[] = []): Promise<number> {
  return Number((await rows(`SELECT count(*)::int AS total FROM (${sql}) t`, values))[0]?.total);
}

beforeAll(async () => {
  if (!process.env.REDIS_URL) throw new Error('HB-151 requires Redis7; no skip fallback');
  // `inventory-seed` tạo `cancellation_policies` nhưng **không** tạo bậc; engine HB-074 đòi ít nhất một
  // bậc (BR-CANCEL-01). Dùng đúng thang FLEX7 của seed sản phẩm, như fixture HB-077/HB-096.
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
  const url = new URL(process.env.REDIS_URL);
  url.pathname = '/12';
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
}, 60000);

beforeEach(async () => {
  // Cấu hình thật của kênh WALKIN (prisma/seed/reference-data.ts); mỗi ca được quyền sửa rồi tự khôi phục.
  await rows(
    "UPDATE channels SET status='ACTIVE', hold_minutes=0, multiplier=1.100 WHERE code='WALKIN'",
  );
});

afterAll(async () => {
  await app?.close();
  await redis?.quit();
}, 30000);
