/**
 * Fixture HB-100: PostgreSQL16 riêng cho file + app HTTP thật + Redis DB `/15`, dùng lại seed chung
 * (`test/idempotency/database.ts`, `test/room-blocks/inventory-seed.ts`, `test/huy-booking/seed.ts`).
 * Thêm ba nhân viên của luồng chi (người lập / người duyệt / kế toán) và helper chạy job thật.
 */
import 'reflect-metadata';
import { randomBytes, randomUUID } from 'node:crypto';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { z } from 'zod';
import { Redis } from 'ioredis';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, expect } from 'vitest';
import { errorBodySchema, refundRequestSchema, tokenPairSchema } from '@pinehill/contracts';
import { AppModule } from '../../src/app.module.js';
import { CLOCK } from '../../src/infrastructure/ports.js';
import type { JobContext } from '../../../../apps/worker/src/jobs/types.js';
import type { WorkerConfig } from '../../../../apps/worker/src/config/env.js';
import { loadWorkerConfig } from '../../../../apps/worker/src/config/env.js';
import { createRefundPayoutJob } from '../../../../apps/worker/src/jobs/refund-payout/refund-payout.job.js';
import { databaseUrl, password } from '../idempotency/database.js';
import { rows, userId, propertyId, db, clock } from '../room-blocks/inventory-seed.js';
import { booking, flexPolicy } from '../huy-booking/seed.js';

export { rows, userId, propertyId, db, clock, booking, flexPolicy };

const PIN = '123456';
const maker = 'h100-maker';
const checker = 'h100-checker';
const cashier = 'h100-cashier';

let app: NestFastifyApplication;
let redis: Redis;

export const http = () => request(app.getHttpServer());

export async function login(username: string, role: string): Promise<string> {
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
  return z.object({ pinToken: z.string() }).parse(verified.body).pinToken;
}

beforeAll(async () => {
  if (!process.env.REDIS_URL) throw new Error('HB100 requires Redis7; no skip fallback');
  const url = new URL(process.env.REDIS_URL);
  url.pathname = '/15';
  redis = new Redis(url.href);
  await redis.ping();
  // Ba nhân viên luồng chi dùng chung mật khẩu seed; scope cơ sở của booking test.
  for (const username of [maker, checker, cashier]) {
    const inserted = await rows(
      `INSERT INTO users(username,password_hash,full_name,role)
       SELECT $1, password_hash, 'Synthetic HB100', $2 FROM users WHERE username='h029-first'
       RETURNING id`,
      [username, 'FRONT_DESK'],
    );
    await rows('INSERT INTO user_property_scopes(user_id,property_id) VALUES($1::uuid,$2::uuid)', [
      inserted[0]!.id,
      propertyId,
    ]);
  }
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
  // Sổ PSP mô phỏng không có FK tới booking nên phải dọn riêng giữa các ca.
  await rows('DELETE FROM refund_payout_simulator_transfers');
  await rows(
    "DELETE FROM system_settings WHERE key='refund.feeAmount';DELETE FROM system_settings WHERE key='deal.threshold.minor';",
  );
});

afterAll(async () => {
  await app?.close();
  await redis?.quit();
}, 30000);

export const errorCode = (body: unknown) => errorBodySchema.parse(body).code;

/** Bậc duy nhất ở mốc ≥7 ngày quyết định `refundPercent` của mọi hồ sơ trong file này. */
async function setTier(percent: number): Promise<void> {
  const policy = String(
    (await rows("SELECT cancellation_policy_id AS id FROM rate_plans WHERE code='FLEX7'"))[0]!.id,
  );
  await rows(
    'UPDATE cancellation_tiers SET refund_percent=$2 WHERE policy_id=$1::uuid AND offset_hours=168',
    [policy, percent],
  );
}

export interface Source {
  readonly bookingId: string;
  readonly paymentId: string;
  readonly amount: number;
}

/** Booking CONFIRMED + chứng từ thu SUCCEEDED **chưa phân bổ** (đủ quỹ để giữ hạn mức hoàn). */
export async function source(
  amount = 2_000_000,
  method: 'VNPAY' | 'MOMO' | 'CASH' = 'VNPAY',
): Promise<Source> {
  const created = await booking({ status: 'CONFIRMED', price: amount, nights: 3 });
  const paymentId = String(
    (
      await rows(
        `INSERT INTO payments(booking_id,type,method,amount,status,idempotency_key,paid_at,created_by)
         VALUES($1::uuid,'DEPOSIT',$2,$3,'SUCCEEDED',$4,clock_timestamp(),$5::uuid)
         RETURNING id`,
        [created.id, method, amount, randomBytes(16).toString('hex'), userId],
      )
    )[0]!.id,
  );
  return { bookingId: created.id, paymentId, amount };
}

/** Lập hồ sơ hoàn PENDING bằng HTTP thật (người lập FRONT_DESK). */
export async function openRefund(amount = 2_000_000, method: 'VNPAY' | 'MOMO' | 'CASH' = 'VNPAY') {
  await flexPolicy();
  await setTier(100);
  const src = await source(amount, method);
  const makerToken = await login(maker, 'FRONT_DESK');
  const created = await http()
    .post('/api/v1/refund-requests')
    .set('Authorization', `Bearer ${makerToken}`)
    .set('Idempotency-Key', randomUUID())
    .send({
      bookingId: src.bookingId,
      paymentId: src.paymentId,
      reason: 'GUEST_REQUEST',
      isForceMajeure: false,
    });
  expect(created.status).toBe(201);
  const view = refundRequestSchema.parse(created.body);
  return { ...src, refundId: view.id, netRefund: view.netRefund ?? 0 };
}

/** Lập + duyệt hồ sơ hoàn tới `APPROVED` bằng HTTP thật (maker–checker khác người). */
export async function approvedRefund(
  amount = 2_000_000,
  method: 'VNPAY' | 'MOMO' | 'CASH' = 'VNPAY',
) {
  const opened = await openRefund(amount, method);
  const checkerToken = await login(checker, 'MANAGER');
  const approvePin = await pinToken(checkerToken, opened.bookingId);
  const approved = await http()
    .post(`/api/v1/refund-requests/${opened.refundId}/approve`)
    .set('Authorization', `Bearer ${checkerToken}`)
    .set('Idempotency-Key', randomUUID())
    .send({ approvedAmount: opened.netRefund, pinToken: approvePin });
  expect(approved.status).toBe(200);
  return opened;
}

/** Gọi `POST /refund-requests/{id}/pay` bằng token + pinToken của kế toán. */
export async function pay(token: string, refundId: string, body: object, key = randomUUID()) {
  return http()
    .post(`/api/v1/refund-requests/${refundId}/pay`)
    .set('Authorization', `Bearer ${token}`)
    .set('Idempotency-Key', key)
    .send(body);
}

/** Kế toán + PIN gắn booking của hồ sơ. */
export async function cashierFor(bookingId: string): Promise<{ token: string; pin: string }> {
  const token = await login(cashier, 'ACCOUNTANT');
  return { token, pin: await pinToken(token, bookingId) };
}

/** Ngữ cảnh job thật của worker (trừ handler do test chọn). */
export function jobContext(overrides: Partial<WorkerConfig> = {}): JobContext {
  const config = loadWorkerConfig({
    ...process.env,
    DATABASE_URL: databaseUrl,
    REDIS_URL: process.env.REDIS_URL ?? '',
    LOG_LEVEL: 'silent',
    REFUND_PAYOUT_SIMULATOR: 'true',
  });
  return { db, config: { ...config, ...overrides }, clock, log: () => {} };
}

export const runPayoutJob = (
  deps?: Parameters<typeof createRefundPayoutJob>[0],
  overrides: Partial<WorkerConfig> = {},
) => createRefundPayoutJob(deps)({}, jobContext(overrides));

export const operations = (refundId: string) =>
  rows(
    `SELECT * FROM refund_payout_operations WHERE refund_request_id=$1::uuid ORDER BY created_at`,
    [refundId],
  );

export const refundRow = async (refundId: string) =>
  (await rows('SELECT * FROM refund_requests WHERE id=$1::uuid', [refundId]))[0]!;

export const refundPayments = (bookingId: string) =>
  rows("SELECT * FROM payments WHERE booking_id=$1::uuid AND type='REFUND'", [bookingId]);

export const heldAmount = async (bookingId: string) =>
  String(
    (
      await rows(
        `SELECT coalesce(sum(a.amount),0)::text AS held FROM refund_allocations a
         JOIN refund_requests r ON r.id = a.refund_request_id
        WHERE r.booking_id = $1 AND r.status IN ('PENDING','APPROVED','PAID')`,
        [bookingId],
      )
    )[0]!.held,
  );

export const simulatorTransfers = () =>
  rows('SELECT * FROM refund_payout_simulator_transfers ORDER BY created_at');
