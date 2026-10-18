/**
 * HB-015 — PIN: `POST /auth/pin/verify` (một lần, TTL 5 phút, gắn purpose/booking),
 * `PUT /auth/pin`, `DELETE /users/{userId}/pin`, và hàm dùng chung `requirePinToken`.
 *
 * Test tích hợp thật trên PostgreSQL16 + Redis7 (DB `/9`) dùng lại seed dùng chung
 * `test/idempotency/database.ts` + `test/room-blocks/inventory-seed.ts` (không dựng bộ seed thứ hai).
 * Clock đóng băng qua `CLOCK` để kiểm TTL và khoá 15 phút.
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
import { afterAll, beforeAll, beforeEach, expect, test } from 'vitest';
import { errorBodySchema, pinTokenSchema, tokenPairSchema } from '@pinehill/contracts';
import { AppModule } from '../../src/app.module.js';
import { CLOCK } from '../../src/infrastructure/ports.js';
import { PRISMA } from '../../src/infrastructure/prisma/prisma.module.js';
import { requirePinToken, PIN_PURPOSE_FINANCIAL } from '../../src/modules/auth/pin/consume.js';
import { hashPinToken } from '../../src/modules/auth/pin/token.js';
import {
  clock,
  databaseUrl,
  otherPropertyId,
  password,
  propertyId,
  rows,
  secondUserId,
  userId,
} from '../idempotency/database.js';
import { booking, otherTypeId } from '../room-blocks/inventory-seed.js';

const PIN = '123456';
const UNKNOWN_ID = '00000000-0000-4000-8000-000000000000';
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
  await rows('DELETE FROM user_property_scopes WHERE user_id=ANY($1::uuid[])', [
    [userId, secondUserId],
  ]);
  await rows(
    'INSERT INTO user_property_scopes(user_id,property_id) VALUES($1::uuid,$3::uuid),($2::uuid,$3::uuid)',
    [userId, secondUserId, propertyId],
  );
});

const http = () => request(app.getHttpServer());
const businessDb = () => app.get<PrismaClient>(PRISMA);
const errorCode = (response: { body: unknown }) => errorBodySchema.parse(response.body).code;

async function staffToken(username = 'h029-first', role = 'FRONT_DESK'): Promise<string> {
  const id = username === 'h029-first' ? userId : secondUserId;
  await rows('UPDATE users SET role=$1 WHERE id=$2::uuid', [role, id]);
  const response = await http().post('/api/v1/auth/login').send({ username, password });
  expect(response.status).toBe(200);
  return tokenPairSchema.parse(response.body).accessToken;
}

function setPin(token: string, pin = PIN, currentPassword = password) {
  return http()
    .put('/api/v1/auth/pin')
    .set('Authorization', `Bearer ${token}`)
    .send({ pin, currentPassword });
}

function verify(token: string, body: object = { pin: PIN }) {
  return http().post('/api/v1/auth/pin/verify').set('Authorization', `Bearer ${token}`).send(body);
}

function consume(pinToken: unknown, bookingId: string | null, actingUser = userId) {
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

test('PIN chưa đặt → verify trả E_AUTH_PIN_REQUIRED', async () => {
  const response = await verify(await staffToken());
  expect(response.status).toBe(401);
  expect(errorCode(response)).toBe('E_AUTH_PIN_REQUIRED');
});

test('đặt PIN cần currentPassword; đúng thì verify trả pinToken 32 byte + ghi audit', async () => {
  const token = await staffToken();
  const rejected = await setPin(token, PIN, 'Wrong-password-123');
  expect(rejected.status).toBe(401);
  expect(errorCode(rejected)).toBe('E_AUTH_INVALID_CREDENTIALS');
  const saved = await setPin(token);
  expect(saved.status).toBe(204);

  const response = await verify(token);
  expect(response.status).toBe(200);
  const grant = pinTokenSchema.parse(response.body);
  expect(grant.pinToken).toHaveLength(64);
  expect(Date.parse(grant.expiresAt)).toBeGreaterThan(clock.now().getTime());

  const audited = await rows(
    "SELECT count(*)::int AS n FROM audit_logs WHERE action='AUTH_PIN_SET' AND entity_id=$1::uuid",
    [userId],
  );
  expect(Number(audited[0]!.n)).toBeGreaterThan(0);
});

test('sai PIN 3 lần → E_AUTH_PIN_LOCKED + retryAfterSeconds; mở lại sau 15 phút', async () => {
  let token = await staffToken();
  expect((await setPin(token)).status).toBe(204);
  for (let attempt = 0; attempt < 2; attempt++) {
    const wrong = await verify(token, { pin: '000000' });
    expect(wrong.status).toBe(401);
    expect(errorCode(wrong)).toBe('E_AUTH_PIN_REQUIRED');
  }
  const locked = await verify(token, { pin: '000000' });
  expect(locked.status).toBe(403);
  const body = errorBodySchema.parse(locked.body);
  expect(body.code).toBe('E_AUTH_PIN_LOCKED');
  expect(body.retryAfterSeconds).toBeGreaterThan(0);

  // Thao tác không cần PIN vẫn dùng được trong lúc khoá (QĐ-03 quyết định 4).
  const me = await http().get('/api/v1/auth/me').set('Authorization', `Bearer ${token}`);
  expect(me.status).toBe(200);

  // Đúng PIN vẫn bị khoá tới khi hết hạn.
  const stillLocked = await verify(token, { pin: PIN });
  expect(stillLocked.status).toBe(403);
  expect(errorCode(stillLocked)).toBe('E_AUTH_PIN_LOCKED');

  clock.value += 16 * 60_000;
  token = await staffToken();
  const reopened = await verify(token, { pin: PIN });
  expect(reopened.status).toBe(200);
});

test('PIN không xuất hiện trong audit_logs', async () => {
  const token = await staffToken();
  await setPin(token);
  await verify(token, { pin: '000000' });
  const leaked = await rows(
    "SELECT count(*)::int AS n FROM audit_logs WHERE after_json::text LIKE '%123456%' OR before_json::text LIKE '%123456%'",
  );
  expect(leaked[0]!.n).toBe(0);
});

test('HOUSEKEEPING và SYSADMIN bị 403 ở pin/verify', async () => {
  const housekeeping = await verify(await staffToken('h029-first', 'HOUSEKEEPING'));
  expect(housekeeping.status).toBe(403);
  expect(errorCode(housekeeping)).toBe('E_RBAC_FORBIDDEN');
  const sysadmin = await verify(await staffToken('h029-second', 'SYSADMIN'));
  expect(sysadmin.status).toBe(403);
  expect(errorCode(sysadmin)).toBe('E_RBAC_FORBIDDEN');
});

test('verify gắn booking trong cơ sở; booking ngoài cơ sở 403; booking lạ 404', async () => {
  const token = await staffToken();
  await setPin(token);
  const mine = await booking();
  expect((await verify(token, { pin: PIN, bookingId: mine.id })).status).toBe(200);
  const foreign = await booking({ property: otherPropertyId, type: otherTypeId });
  const denied = await verify(token, { pin: PIN, bookingId: foreign.id });
  expect(denied.status).toBe(403);
  expect(errorCode(denied)).toBe('E_AUTH_OUT_OF_SCOPE');
  const unknown = await verify(token, { pin: PIN, bookingId: UNKNOWN_ID });
  expect(unknown.status).toBe(404);
  expect(errorCode(unknown)).toBe('E_GEN_NOT_FOUND');
});

test('PUT /auth/pin: thân sai → 400', async () => {
  const token = await staffToken();
  const response = await setPin(token, '12', password);
  expect(response.status).toBe(400);
  expect(errorCode(response)).toBe('E_GEN_VALIDATION_FAILED');
});

test('requirePinToken: dùng một lần, đúng booking, đúng người, token lạ bị từ chối', async () => {
  const token = await staffToken();
  await setPin(token);
  const first = await booking();
  const second = await booking();
  const issued = pinTokenSchema.parse(
    (await verify(token, { pin: PIN, bookingId: first.id })).body,
  );

  // Token cấp cho booking A không tiêu thụ được cho booking B.
  await expect(consume(issued.pinToken, second.id)).rejects.toMatchObject({
    code: 'E_AUTH_PIN_REQUIRED',
  });
  // Không phải chủ token.
  await expect(consume(issued.pinToken, first.id, secondUserId)).rejects.toMatchObject({
    code: 'E_AUTH_PIN_REQUIRED',
  });
  // Token rác.
  await expect(consume('not-a-real-pin-token-000000000000', first.id)).rejects.toMatchObject({
    code: 'E_AUTH_PIN_REQUIRED',
  });
  // Lần đầu thành công, lần hai cùng token phải hỏng.
  await consume(issued.pinToken, first.id);
  await expect(consume(issued.pinToken, first.id)).rejects.toMatchObject({
    code: 'E_AUTH_PIN_REQUIRED',
  });
});

test('requirePinToken: token hết hạn bị từ chối', async () => {
  await staffToken();
  const sessionId = String(
    (
      await rows(
        'SELECT id FROM auth_sessions WHERE user_id=$1::uuid ORDER BY created_at DESC, id LIMIT 1',
        [userId],
      )
    )[0]!.id,
  );
  const expired = 'expired-pin-token-0000000000000000';
  const created = new Date(clock.now().getTime() - 10 * 60_000);
  const expires = new Date(clock.now().getTime() - 5 * 60_000);
  await rows(
    `INSERT INTO pin_grants(token_hash,user_id,session_id,purpose,booking_id,created_at,expires_at)
     VALUES($1,$2::uuid,$3::uuid,'FINANCIAL',NULL,$4,$5)`,
    [hashPinToken(expired), userId, sessionId, created, expires],
  );
  await expect(consume(expired, null)).rejects.toMatchObject({
    code: 'E_AUTH_PIN_REQUIRED',
  });
});

test('DELETE /users/{id}/pin: MANAGER cùng cơ sở xoá được, audit ghi', async () => {
  const target = await staffToken('h029-second', 'FRONT_DESK');
  await setPin(target);
  const manager = await staffToken('h029-first', 'MANAGER');
  const removed = await http()
    .delete(`/api/v1/users/${secondUserId}/pin`)
    .set('Authorization', `Bearer ${manager}`);
  expect(removed.status).toBe(204);

  const again = await staffToken('h029-second', 'FRONT_DESK');
  expect((await verify(again)).status).toBe(401);
  const audited = await rows(
    "SELECT count(*)::int AS n FROM audit_logs WHERE action='AUTH_PIN_DELETED' AND entity_id=$1::uuid",
    [secondUserId],
  );
  expect(audited[0]!.n).toBeGreaterThan(0);
});

test('DELETE /users/{id}/pin: MANAGER cơ sở khác → 403 E_AUTH_OUT_OF_SCOPE', async () => {
  await rows('DELETE FROM user_property_scopes WHERE user_id=$1::uuid', [secondUserId]);
  await rows('INSERT INTO user_property_scopes(user_id,property_id) VALUES($1::uuid,$2::uuid)', [
    secondUserId,
    otherPropertyId,
  ]);
  const manager = await staffToken('h029-first', 'MANAGER');
  const response = await http()
    .delete(`/api/v1/users/${secondUserId}/pin`)
    .set('Authorization', `Bearer ${manager}`);
  expect(response.status).toBe(403);
  expect(errorCode(response)).toBe('E_AUTH_OUT_OF_SCOPE');
});

test('DELETE /users/{id}/pin: SYSADMIN xoá không giới cơ sở → 204', async () => {
  const sysadmin = await staffToken('h029-first', 'SYSADMIN');
  const response = await http()
    .delete(`/api/v1/users/${secondUserId}/pin`)
    .set('Authorization', `Bearer ${sysadmin}`);
  expect(response.status).toBe(204);
});

test('DELETE /users/{id}/pin: người dùng lạ → 404; FRONT_DESK → 403', async () => {
  const sysadmin = await staffToken('h029-first', 'SYSADMIN');
  const missing = await http()
    .delete(`/api/v1/users/${UNKNOWN_ID}/pin`)
    .set('Authorization', `Bearer ${sysadmin}`);
  expect(missing.status).toBe(404);
  expect(errorCode(missing)).toBe('E_GEN_NOT_FOUND');
  const frontDesk = await staffToken('h029-first', 'FRONT_DESK');
  const denied = await http()
    .delete(`/api/v1/users/${secondUserId}/pin`)
    .set('Authorization', `Bearer ${frontDesk}`);
  expect(denied.status).toBe(403);
  expect(errorCode(denied)).toBe('E_RBAC_FORBIDDEN');
});
