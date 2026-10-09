import 'reflect-metadata';
import { randomBytes } from 'node:crypto';
import { beforeAll, beforeEach, afterAll, expect } from 'vitest';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { Redis } from 'ioredis';
import request from 'supertest';
import { tokenPairSchema } from '@pinehill/contracts';
import { AppModule } from '../../src/app.module.js';
import { CLOCK } from '../../src/infrastructure/ports.js';
import { databaseUrl, password } from '../idempotency/database.js';
import { rows, clock, userId } from './inventory-seed.js';
let app: NestFastifyApplication, redis: Redis;
export const http = () => request(app.getHttpServer());
export async function login(role = 'MANAGER') {
  await rows('UPDATE users SET role=$1 WHERE id=$2', [role, userId]);
  const response = await http()
    .post('/api/v1/auth/login')
    .send({ username: 'h029-first', password });
  expect(response.status).toBe(200);
  return tokenPairSchema.parse(response.body).accessToken;
}
beforeAll(async () => {
  if (!process.env.REDIS_URL) throw new Error('HB034 requires Redis7; no skip fallback');
  const url = new URL(process.env.REDIS_URL);
  url.pathname = '/13';
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
          (p) => typeof p !== 'object' || p === null || !('provide' in p) || p.provide !== CLOCK,
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
  await redis.flushdb();
});
afterAll(async () => {
  await app?.close();
  await redis?.quit();
}, 30000);
