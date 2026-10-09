import 'reflect-metadata';
import { randomBytes, randomUUID } from 'node:crypto';
import { beforeAll, beforeEach, afterAll, expect } from 'vitest';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { Redis } from 'ioredis';
import request from 'supertest';
import { tokenPairSchema } from '@pinehill/contracts';
import { AppModule } from '../../../src/app.module.js';
import { CLOCK } from '../../../src/infrastructure/ports.js';
import { databaseUrl, password } from '../../idempotency/database.js';
import { rows, clock, userId, secondUserId, version } from './seed.js';
let app: NestFastifyApplication, redis: Redis;
export const application = () => app;
export const http = () => request(app.getHttpServer());
export async function login(role = 'OWNER', second = false) {
  await rows('UPDATE users SET role=$1 WHERE id=$2', [role, second ? secondUserId : userId]);
  const response = await http()
    .post('/api/v1/auth/login')
    .send({ username: second ? 'h029-second' : 'h029-first', password });
  expect(response.status).toBe(200);
  return tokenPairSchema.parse(response.body).accessToken;
}
export async function put(
  id: string,
  body: object,
  options: { kind?: string; token?: string; key?: string; match?: string } = {},
) {
  const kind = options.kind ?? 'policy',
    token = options.token ?? (await login());
  return http()
    .put(`/api/v1/${kind === 'policy' ? 'cancellation-policies' : 'rate-plans'}/${id}`)
    .set('Authorization', `Bearer ${token}`)
    .set('Idempotency-Key', options.key ?? randomUUID())
    .set('If-Match', options.match ?? (await version(id, kind)))
    .send(body);
}
beforeAll(async () => {
  if (!process.env.REDIS_URL) throw new Error('HB057 requires Redis7; no skips');
  const url = new URL(process.env.REDIS_URL);
  url.pathname = '/14';
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
