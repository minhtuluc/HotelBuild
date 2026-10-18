/**
 * Fixture tích hợp HB-015: app thật (`AppModule.register`) trên PostgreSQL16 + Redis7 (DB `/9`),
 * dùng lại seed dùng chung `test/idempotency/database.ts` + `test/room-blocks/inventory-seed.ts`
 * (không dựng bộ seed thứ hai). Clock đóng băng qua `CLOCK` để kiểm TTL và khoá 15 phút.
 *
 * Ticket HB-015 khai `locked: apps/api/test/pin/pin.locked.spec.ts` nhưng **thiếu `locked_sha`** và
 * giai đoạn A (Codex viết test khoá) chưa bàn giao — nên đây là spec thường, không giả làm test khoá.
 */
import 'reflect-metadata';
import { randomBytes } from 'node:crypto';
import type { PrismaClient } from '@prisma/client';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { Redis } from 'ioredis';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, expect } from 'vitest';
import { errorBodySchema, tokenPairSchema } from '@pinehill/contracts';
import { AppModule } from '../../src/app.module.js';
import { CLOCK } from '../../src/infrastructure/ports.js';
import { PRISMA } from '../../src/infrastructure/prisma/prisma.module.js';
import { requirePinToken, PIN_PURPOSE_FINANCIAL } from '../../src/modules/auth/pin/consume.js';
import {
  clock,
  databaseUrl,
  password,
  propertyId,
  rows,
  secondUserId,
  userId,
} from '../idempotency/database.js';

export const PIN = '123456';
export const UNKNOWN_ID = '00000000-0000-4000-8000-000000000000';

let app: NestFastifyApplication;
let redis: Redis;

beforeAll(async () => {
  if (!process.env.REDIS_URL)
    throw new Error('HB-015 requires PostgreSQL16 + Redis7; no skip fallback');
  const redisUrl = new URL(process.env.REDIS_URL);
  redisUrl.pathname = '/9';
  redis = new Redis(redisUrl.href);
  await redis.ping();
  const registered = AppModule.register({
    DATABASE_URL: new URL(databaseUrl).href,
    REDIS_URL: redisUrl.href,
    JWT_ACCESS_SECRET: randomBytes(32).toString('hex'),
    JWT_REFRESH_SECRET: randomBytes(32).toString('hex'),
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
}, 60000);

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

export const http = () => request(app.getHttpServer());
export const businessDb = () => app.get<PrismaClient>(PRISMA);
export const errorCode = (response: { body: unknown }) => errorBodySchema.parse(response.body).code;

export async function staffToken(username = 'h029-first', role = 'FRONT_DESK'): Promise<string> {
  const id = username === 'h029-first' ? userId : secondUserId;
  await rows('UPDATE users SET role=$1 WHERE id=$2::uuid', [role, id]);
  const response = await http().post('/api/v1/auth/login').send({ username, password });
  expect(response.status).toBe(200);
  return tokenPairSchema.parse(response.body).accessToken;
}

export function setPin(token: string, pin = PIN, currentPassword = password) {
  return http()
    .put('/api/v1/auth/pin')
    .set('Authorization', `Bearer ${token}`)
    .send({ pin, currentPassword });
}

export function verify(token: string, body: object = { pin: PIN }) {
  return http().post('/api/v1/auth/pin/verify').set('Authorization', `Bearer ${token}`).send(body);
}

export function consume(pinToken: unknown, bookingId: string | null, actingUser = userId) {
  return businessDb().$transaction((tx) =>
    requirePinToken(tx, {
      userId: actingUser,
      token: pinToken,
      purpose: PIN_PURPOSE_FINANCIAL,
      bookingId,
      now: clock.now(),
    }),
  );
}

export async function latestSessionId(user: string): Promise<string> {
  const found = await rows(
    'SELECT id FROM auth_sessions WHERE user_id=$1::uuid ORDER BY created_at DESC, id LIMIT 1',
    [user],
  );
  return String(found[0]!.id);
}
