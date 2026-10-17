/**
 * Fixture tích hợp HB-076: app thật (`AppModule.register`) + CSDL tách riêng của
 * `test/idempotency/database.js` (migrate sạch) + **Redis DB `/15`** theo phân DB của main-agent
 * (HB-076 → `/15`).
 *
 * Không `flushdb`: khoá `hold:*` chỉ sống theo `hold_minutes` và mỗi test dùng định danh mới, còn
 * `quote:*` hết hạn sau 900 giây — xoá cả DB sẽ phá tiến trình khác đang dùng chung DB Redis.
 *
 * Dữ kiện nền lấy từ `test/room-blocks/inventory-seed.js` (cơ sở `H029-A`, loại phòng `STD` với hai
 * phòng `R1`/`R2`, `DOR`, gói `FLEX7`, 7 kênh) để không dựng bộ seed thứ hai; fixture này chỉ nâng
 * `WEB.hold_minutes` theo `prisma/seed/reference-data.ts` (20 phút) và cấp **phiên khách** cho journey.
 *
 * Phiên khách: `POST /holds` là tuyến của khách (api.md §2.5) nhưng `/guest-auth` thuộc HB-017, nên
 * fixture phát hành đúng loại token mà HB-017 sẽ phát (cùng `signAccessToken`, vai trò ngoài thang
 * nhân viên) — `rate/quotes/principal.ts` của HB-074 đã định nghĩa sẵn nhánh `GUEST` cho token này.
 */
import 'reflect-metadata';
import { randomBytes, randomUUID } from 'node:crypto';
import { afterAll, beforeAll, expect } from 'vitest';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { Redis } from 'ioredis';
import request from 'supertest';
import { z } from 'zod';
import { holdSchema, quoteSchema } from '@pinehill/contracts';
import type { AccessTokenClaims, Hold, Quote } from '@pinehill/contracts';
import { AppModule } from '../../src/app.module.js';
import { CLOCK } from '../../src/infrastructure/ports.js';
import { signAccessToken } from '../../src/infrastructure/crypto/access-tokens.js';
import { databaseUrl } from '../idempotency/database.js';
import {
  clock,
  rows,
  propertyId,
  typeId,
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
export const holdRedis = () => redis;
export { clock, rows, propertyId, typeId, roomId, room2Id, stay, userId };

/** `WEB.hold_minutes = 20` (prisma/seed/reference-data.ts); `WALKIN` giữ 0 để kiểm `E_BOOK_INVALID_STATE`. */
export const WEB_HOLD_MINUTES = 20;

export let guestId = '';
export let guestToken = '';
export let otherGuestId = '';
export let otherGuestToken = '';

/**
 * Vai trò phiên khách do HB-017 phát hành. `GUEST` **không** nằm trong `userRoleSchema` hiện hành nên
 * không thể viết thẳng vào `AccessTokenInput`; lấy giá trị qua zod (`z.custom`, QT §2 cấm `as`) —
 * `verifyAccessToken` trả `role: string` nên token vẫn qua được `holdCaller`.
 */
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

/**
 * Token phiên khách cho một `guests.id` đã có. HB-017 sẽ phát hành đúng loại này (`/guest-auth`);
 * fixture tự ký bằng cùng khoá/đồng hồ để kiểm tuyến trước khi HB-017 có mặt.
 */
export async function guestTokenFor(id: string): Promise<string> {
  const { token } = await signAccessToken(
    { userId: id, role: GUEST_ROLE, propertyScope: [], sessionId: randomUUID() },
    secrets.access,
    clock.now(),
  );
  return token;
}

export const holdBody = (overrides: object = {}): Record<string, unknown> => ({
  propertyId,
  roomTypeId: typeId,
  channelCode: 'WEB',
  checkIn: stay.checkIn,
  checkOut: stay.checkOut,
  adults: 2,
  children: 0,
  roomCount: 1,
  ...overrides,
});

/** `POST /quotes` (HB-074) bằng chính phiên khách gọi hold — fingerprint gắn principal. */
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

/**
 * `POST /holds` bằng phiên khách (mặc định) — `token: null` để gửi lệnh **không** có Bearer.
 * `Idempotency-Key` mới cho mỗi lệnh; `key: null` để bỏ hẳn header.
 */
export function holdRequest(
  body: object,
  options: { token?: string | null; key?: string | null } = {},
): request.Test {
  const call = http().post('/api/v1/holds');
  const token = options.token === undefined ? guestToken : options.token;
  if (token !== null) call.set('Authorization', `Bearer ${token}`);
  if (options.key !== null) call.set('Idempotency-Key', options.key ?? randomUUID());
  return call.send(body);
}

/** `DELETE /holds/{holdId}?reason=` — mặc định là phiên khách; truyền token để kiểm nhánh nhân viên. */
export function releaseRequest(
  holdId: string,
  options: { reason?: string | null; token?: string | null; key?: string | null } = {},
): request.Test {
  const call = http().delete(`/api/v1/holds/${holdId}`);
  const token = options.token === undefined ? guestToken : options.token;
  if (token !== null) call.set('Authorization', `Bearer ${token}`);
  if (options.key !== null) call.set('Idempotency-Key', options.key ?? randomUUID());
  const reason = options.reason === undefined ? 'Khách rút giữ chỗ' : options.reason;
  return reason === null ? call : call.query({ reason });
}

/** Tạo hold hợp lệ và trả về phản hồi đã parse (dùng lại cho các ca giải phóng/tranh chấp). */
export async function createHold(
  body: Record<string, unknown> = holdBody(),
  token = guestToken,
): Promise<Hold> {
  const quote = await issueQuote(
    { channelCode: body['channelCode'] ?? 'WEB', roomCount: body['roomCount'] ?? 1 },
    token,
  );
  const response = await holdRequest({ ...body, quoteId: quote.quoteId }, { token });
  expect(response.status).toBe(201);
  return holdSchema.parse(response.body);
}

export async function count(sql: string, values: unknown[] = []): Promise<number> {
  return Number((await rows(`SELECT count(*)::int AS total FROM (${sql}) t`, values))[0]?.total);
}

/**
 * Đọc hàng CSDL và **parse zod** theo lược đồ do test khai (QT §2: không `as`): `rows()` của fixture
 * dùng chung trả `Record<string, unknown>` nên đây là ranh giới duy nhất khai kiểu cột (số, ngày, cột
 * nullable) và cũng là chỗ bắt lỗi lệch hình dạng khi câu truy vấn đổi.
 */
export async function rowsOf<S extends z.ZodType>(
  sql: string,
  schema: S,
  values: unknown[] = [],
): Promise<z.infer<S>[]> {
  return z.array(schema).parse(await rows(sql, values));
}

beforeAll(async () => {
  if (!process.env.REDIS_URL) throw new Error('HB-076 requires Redis7; no skip fallback');
  const url = new URL(process.env.REDIS_URL);
  url.pathname = '/15';
  redis = new Redis(url.href);
  await redis.ping();
  // AC4 chạy 200 yêu cầu song song: pool Prisma ≥ 50 như ticket yêu cầu (nền `hb008` cũng dùng 50).
  const runtime = new URL(databaseUrl);
  runtime.searchParams.set('connection_limit', '50');
  runtime.searchParams.set('pool_timeout', '30');
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
  const guest = await issueGuest('+84900000076', 'HB-076 Guest');
  guestId = guest.id;
  guestToken = guest.token;
  const other = await issueGuest('+84900000086', 'HB-076 Other guest');
  otherGuestId = other.id;
  otherGuestToken = other.token;
}, 120000);

afterAll(async () => {
  await app?.close();
  await redis?.quit();
}, 30000);
