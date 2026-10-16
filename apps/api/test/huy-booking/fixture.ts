/**
 * HB-097 fixture — CSDL riêng cho file test (tạo mới + migrate), app HTTP thật, Redis DB riêng `/12`,
 * clock giả điều khiển được (đổi mốc giờ giữa xem trước và xác nhận cho AC1).
 * Dữ liệu nền phòng/loại phòng dùng lại `../room-blocks/inventory-seed.js`.
 */
import 'reflect-metadata';
import { randomBytes, randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, expect } from 'vitest';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { Redis } from 'ioredis';
import request from 'supertest';
import { errorBodySchema, tokenPairSchema } from '@pinehill/contracts';
import { AppModule } from '../../src/app.module.js';
import { CLOCK } from '../../src/infrastructure/ports.js';
import { BookingLedger } from '../../src/modules/pay/ledger/service.js';
import { databaseUrl, password } from '../idempotency/database.js';
import {
  rows,
  roomId,
  room2Id,
  userId,
  propertyId,
  db,
  clock,
  stay,
} from '../room-blocks/inventory-seed.js';

export { rows, roomId, room2Id, userId, propertyId, db, clock, stay };
export { booking, pay, assign, flexPolicy } from './seed.js';
export type { BookingInput, PolicySnapshot } from './seed.js';
export const ledger = new BookingLedger(clock);

let app: NestFastifyApplication;
let redis: Redis;

export const http = () => request(app.getHttpServer());

export async function login(role = 'FRONT_DESK'): Promise<string> {
  await rows("UPDATE users SET role=$1,is_active=true WHERE username='h029-first'", [role]);
  const response = await http()
    .post('/api/v1/auth/login')
    .send({ username: 'h029-first', password });
  expect(response.status).toBe(200);
  return tokenPairSchema.parse(response.body).accessToken;
}

beforeAll(async () => {
  if (!process.env.REDIS_URL) throw new Error('HB097 requires Redis7; no skip fallback');
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
}, 90000);

beforeEach(async () => {
  await redis.flushdb();
  await rows("DELETE FROM system_settings WHERE key='refund.feeAmount'");
});

afterAll(async () => {
  await app?.close();
  await redis?.quit();
}, 30000);

export const errorCode = (body: unknown) => errorBodySchema.parse(body).code;
export const guestCancel = { reason: 'GUEST_REQUEST', isForceMajeure: false };
export const setFee = (amount: number) =>
  rows(
    `INSERT INTO system_settings(key,value,value_type) VALUES('refund.feeAmount',$1,'NUMBER')
     ON CONFLICT(key) DO UPDATE SET value=excluded.value`,
    [amount.toString()],
  );
export const bookingRow = async (id: string) =>
  (
    await rows(
      `SELECT status,version,total_amount,paid_amount,balance_due,penalty_amount,cancel_reason,cancelled_at
         FROM bookings WHERE id=$1`,
      [id],
    )
  )[0]!;
export const auditCount = async (id: string, action: string) =>
  Number(
    (
      await rows('SELECT count(*) AS n FROM audit_logs WHERE entity_id=$1 AND action=$2', [
        id,
        action,
      ])
    )[0]!.n,
  );
export const refundRequests = (id: string) =>
  rows('SELECT * FROM refund_requests WHERE booking_id=$1', [id]);
export const heldAmount = async (id: string) =>
  (
    await rows(
      `SELECT coalesce(sum(amount),0)::text AS held FROM refund_allocations
        WHERE refund_request_id IN (SELECT id FROM refund_requests WHERE booking_id=$1)`,
      [id],
    )
  )[0]!.held;

/** `rooms` gửi bằng query vì thân lệnh preview của hợp đồng chỉ có `reason`/`isForceMajeure`. */
export const preview = (
  token: string,
  id: string,
  body: object = { reason: 'GUEST_REQUEST', isForceMajeure: false },
  rooms?: readonly string[],
) => {
  const pending = http()
    .post(`/api/v1/bookings/${id}/cancel-preview`)
    .set('Authorization', `Bearer ${token}`);
  if (rooms?.length) pending.query({ bookingRoomIds: rooms.join(',') });
  return pending.send(body);
};

export const cancel = (
  token: string,
  id: string,
  body: object,
  options: { tag?: string; key?: string } = {},
) => {
  const pending = http()
    .post(`/api/v1/bookings/${id}/cancel`)
    .set('Authorization', `Bearer ${token}`)
    .set('Idempotency-Key', options.key ?? randomUUID());
  if (options.tag !== undefined) pending.set('If-Match', options.tag);
  return pending.send(body);
};

/**
 * Luồng hai bước của hợp đồng: xem trước (cùng tập phòng) rồi xác nhận bằng `If-Match` lấy từ `ETag`.
 * Lệnh huỷ **bắt buộc** neo nên mọi ca dương tính phải đi qua đây.
 */
export async function anchoredCancel(
  token: string,
  id: string,
  body: { reason: string; isForceMajeure: boolean; bookingRoomIds?: string[]; note?: string },
  options: { rooms?: readonly string[]; key?: string } = {},
) {
  const previewed = await preview(
    token,
    id,
    { reason: body.reason, isForceMajeure: body.isForceMajeure },
    options.rooms,
  );
  expect(previewed.status).toBe(200);
  return cancel(token, id, body, {
    tag: previewed.headers.etag!,
    ...(options.key === undefined ? {} : { key: options.key }),
  });
}
