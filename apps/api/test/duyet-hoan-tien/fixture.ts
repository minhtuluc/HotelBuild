/**
 * Fixture HB-099: PostgreSQL16 riêng cho file + app HTTP thật + Redis DB `/15`, dùng lại bộ seed
 * chung (`test/idempotency/database.ts` + `test/room-blocks/inventory-seed.js`) và chuỗi tiền của
 * HB-097. Clock đóng băng qua `CLOCK` để hai lệnh liên tiếp dùng một mốc giờ xác định.
 */
import 'reflect-metadata';
import { randomBytes } from 'node:crypto';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { z } from 'zod';
import { Redis } from 'ioredis';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, expect } from 'vitest';
import { errorBodySchema, tokenPairSchema } from '@pinehill/contracts';
import { AppModule } from '../../src/app.module.js';
import { CLOCK } from '../../src/infrastructure/ports.js';
import { databaseUrl, password } from '../idempotency/database.js';
import {
  rows,
  roomId,
  userId,
  secondUserId,
  propertyId,
  db,
  clock,
  stay,
} from '../room-blocks/inventory-seed.js';

export { rows, roomId, userId, secondUserId, propertyId, db, clock, stay };
export { booking, pay, assign, flexPolicy } from '../huy-booking/seed.js';

const PIN = '123456';

let app: NestFastifyApplication;
let redis: Redis;

export const http = () => request(app.getHttpServer());

export async function login(username: string, role = 'FRONT_DESK'): Promise<string> {
  await rows('UPDATE users SET role=$1 WHERE username=$2', [role, username]);
  const response = await http().post('/api/v1/auth/login').send({ username, password });
  expect(response.status).toBe(200);
  return tokenPairSchema.parse(response.body).accessToken;
}

export async function pinToken(token: string, bookingId: string | null = null): Promise<string> {
  expect(
    (
      await http()
        .put('/api/v1/auth/pin')
        .set('Authorization', `Bearer ${token}`)
        .send({ pin: PIN, currentPassword: password })
    ).status,
  ).toBe(204);
  const verified = await http()
    .post('/api/v1/auth/pin/verify')
    .set('Authorization', `Bearer ${token}`)
    .send(bookingId === null ? { pin: PIN } : { pin: PIN, bookingId });
  expect(verified.status).toBe(200);
  const granted = z.object({ pinToken: z.string() }).parse(verified.body);
  return granted.pinToken;
}

beforeAll(async () => {
  if (!process.env.REDIS_URL) throw new Error('HB099 requires Redis7; no skip fallback');
  const url = new URL(process.env.REDIS_URL);
  url.pathname = '/15';
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
}, 90000);

beforeEach(async () => {
  await redis.flushdb();
  await rows(
    "DELETE FROM system_settings WHERE key='refund.feeAmount';DELETE FROM system_settings WHERE key='deal.threshold.minor';",
  );
});

afterAll(async () => {
  await app?.close();
  await redis?.quit();
}, 30000);

export const errorCode = (body: unknown) => errorBodySchema.parse(body).code;

/** Tiền **đang giữ hạn mức** theo BR-CANCEL-17: chỉ hồ sơ PENDING/APPROVED/PAID (đã nhả thì thôi). */
export const heldAmount = async (id: string) =>
  (
    await rows(
      `SELECT coalesce(sum(a.amount),0)::text AS held FROM refund_allocations a
         JOIN refund_requests r ON r.id = a.refund_request_id
        WHERE r.booking_id = $1 AND r.status IN ('PENDING','APPROVED','PAID')`,
      [id],
    )
  )[0]!.held;

/** Thu chứng từ thành công mà **không** phân bổ vào nghĩa vụ: hàng `available` > 0 để giữ hạn mức. */
export async function unallocatedPayment(bookingId: string, amount: bigint): Promise<string> {
  return String(
    (
      await rows(
        `INSERT INTO payments(booking_id,type,method,amount,status,idempotency_key,paid_at,created_by)
         VALUES($1::uuid,'DEPOSIT','BANK_TRANSFER',$2,'SUCCEEDED',$3,clock_timestamp(),$4::uuid)
         RETURNING id`,
        [bookingId, amount.toString(), randomBytes(16).toString('hex'), userId],
      )
    )[0]!.id,
  );
}

export const refundRequests = (bookingId: string) =>
  rows('SELECT * FROM refund_requests WHERE booking_id=$1', [bookingId]);
