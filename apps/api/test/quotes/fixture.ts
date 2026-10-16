/**
 * Fixture tích hợp HB-074: app thật (`AppModule.register`) + CSDL tách riêng của
 * `test/idempotency/database.ts` (migrate sạch) + **Redis DB `/11`** riêng của ticket này
 * (main phân DB theo ticket để các worktree chạy song song không đạp lên nhau).
 *
 * Không `flushdb`: mỗi quote dùng `quoteId` ngẫu nhiên và khoá tự hết hạn sau 900 giây nên không có
 * khoá nào chồng lấn giữa các lần chạy; xoá cả DB sẽ phá test của tiến trình khác dùng chung DB Redis.
 */
import 'reflect-metadata';
import { randomBytes } from 'node:crypto';
import { beforeAll, afterAll, expect } from 'vitest';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { Redis } from 'ioredis';
import request from 'supertest';
import { tokenPairSchema } from '@pinehill/contracts';
import { AppModule } from '../../src/app.module.js';
import { CLOCK } from '../../src/infrastructure/ports.js';
import { RateQuoteService } from '../../src/modules/rate/quotes/service.js';
import { databaseUrl, password } from '../idempotency/database.js';
import { clock, rows, userId } from '../room-blocks/inventory-seed.js';

let app: NestFastifyApplication, redis: Redis;

export { clock, rows, userId };
export { propertyId, secondUserId } from '../idempotency/database.js';
export { stay, nights, dlxTypeId } from './seed.js';

export const http = () => request(app.getHttpServer());
export const quoteRedis = () => redis;
export const quoteService = () => app.get(RateQuoteService);

export async function login(role = 'MANAGER'): Promise<string> {
  await rows('UPDATE users SET role=$1 WHERE id=$2', [role, userId]);
  const response = await http()
    .post('/api/v1/auth/login')
    .send({ username: 'h029-first', password });
  expect(response.status).toBe(200);
  return tokenPairSchema.parse(response.body).accessToken;
}

beforeAll(async () => {
  if (!process.env.REDIS_URL) throw new Error('HB-074 requires Redis7; no skip fallback');
  const url = new URL(process.env.REDIS_URL);
  url.pathname = '/11';
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

afterAll(async () => {
  await app?.close();
  await redis?.quit();
}, 30000);
