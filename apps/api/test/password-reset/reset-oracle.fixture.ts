import 'reflect-metadata';
import { randomBytes, randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import type { PrismaClient } from '@prisma/client';
import { hash } from '@node-rs/argon2';
import pg from 'pg';
import { Redis } from 'ioredis';
import request from 'supertest';
import { beforeAll, beforeEach, afterAll, expect } from 'vitest';
import { tokenPairSchema, errorBodySchema, type TokenPair } from '@pinehill/contracts';
import { AppModule } from '../../src/app.module.js';
import { CLOCK } from '../../src/infrastructure/ports.js';
import { Logger, LoggerModule } from 'nestjs-pino';
import {
  startMail,
  clearLogs,
  resetMail,
  closeMail,
  smtpUrl,
  guestBase,
  captureLogger,
} from './reset-mail.js';
import { PRISMA } from '../../src/infrastructure/prisma/prisma.module.js';

const root = fileURLToPath(new URL('../../../../', import.meta.url));
const database = `hb028_${randomUUID().replaceAll('-', '')}`;
export const role = `hb028_${randomUUID().replaceAll('-', '')}`;
const lease = randomUUID(),
  leaseKey = 'hb028:redis6:lease';
export const password = 'Synthetic-HB028-password!';
export const phone = '+84912345678';
export const accessSecret = randomBytes(32).toString('hex');
export const legacyPhone = '0912345678';
export const clock = {
  value: Date.UTC(2026, 9, 9, 8),
  now() {
    return new Date(this.value);
  },
};
let app: NestFastifyApplication | undefined,
  admin: pg.Client | undefined,
  owner: pg.Client | undefined;
let redis: Redis | undefined, leases: Redis | undefined;
let leased = false,
  createdDatabase = false,
  createdRole = false;
export const http = () => {
  if (!app) throw new Error('HB028 app unavailable');
  return request(app.getHttpServer());
};
export const businessDb = () => {
  if (!app) throw new Error('HB028 app unavailable');
  return app.get<PrismaClient>(PRISMA);
};
export async function rows(sql: string, values: unknown[] = []) {
  if (!owner) throw new Error('HB028 database unavailable');
  return (await owner.query<Record<string, unknown>>(sql, values)).rows;
}
export const loginRequest = (value = phone, secret = password, surface?: string) =>
  http()
    .post('/api/v1/guest-auth/login')
    .set('Idempotency-Key', randomUUID())
    .send({ phone: value, password: secret, ...(surface ? { clientSurface: surface } : {}) });
export async function login(value = phone, surface?: string) {
  const response = await loginRequest(value, password, surface);
  expect(response.status).toBe(200);
  return pair(response.body);
}
export const refresh = (token: string) =>
  http()
    .post('/api/v1/guest-auth/refresh')
    .set('Idempotency-Key', randomUUID())
    .send({ refreshToken: token });
export const requestReset = (value = phone) =>
  http()
    .post('/api/v1/guest-auth/password-reset/request')
    .set('Idempotency-Key', randomUUID())
    .send({ phone: value });
export const newPassword = 'New-synthetic-HB028-password!';
export const confirm = (token: string, secret = newPassword) =>
  http()
    .post('/api/v1/guest-auth/password-reset/confirm')
    .set('Idempotency-Key', randomUUID())
    .send({ token, newPassword: secret });
export function pair(value: unknown): TokenPair {
  const json = JSON.stringify(value);
  expect(/password_hash|passwordHash|token_hash|tokenHash|\$argon2id\$/.test(json)).toBe(false);
  expect(json.includes(password)).toBe(false);
  return tokenPairSchema.parse(value);
}
export function error(response: { status: number; body: unknown }, status: number, code: string) {
  expect(response.status).toBe(status);
  const result = errorBodySchema.parse(response.body);
  expect(result.code).toBe(code);
  return result;
}
beforeAll(async () => {
  const migrationUrl = process.env.DATABASE_MIGRATION_URL,
    redisUrl = process.env.REDIS_URL;
  if (!migrationUrl || !redisUrl) throw new Error('HB028 requires owned PG16/Redis7; no skips');
  const leaseUrl = new URL(redisUrl);
  leaseUrl.pathname = '/15';
  leases = new Redis(leaseUrl.href, { maxRetriesPerRequest: 1 });
  expect(await leases.ping()).toBe('PONG');
  expect((await leases.info('server')).includes('redis_version:7.')).toBe(true);
  if ((await leases.set(leaseKey, lease, 'EX', 1800, 'NX')) !== 'OK')
    throw new Error('HB028 Redis6 already leased');
  leased = true;
  const runtimeRedis = new URL(redisUrl);
  runtimeRedis.pathname = '/6';
  redis = new Redis(runtimeRedis.href, { maxRetriesPerRequest: 1 });
  admin = new pg.Client({ connectionString: migrationUrl });
  await admin.connect();
  const version = Number(
    (await admin.query<{ server_version_num: string }>('SHOW server_version_num')).rows[0]!
      .server_version_num,
  );
  expect(version).toBeGreaterThanOrEqual(160000);
  expect(version).toBeLessThan(170000);
  await admin.query(`CREATE DATABASE "${database}"`);
  createdDatabase = true;
  const ownerUrl = new URL(migrationUrl);
  ownerUrl.pathname = `/${database}`;
  const migrated = spawnSync(process.execPath, [`${root}scripts/migrate.mjs`], {
    cwd: root,
    env: { ...process.env, DATABASE_MIGRATION_URL: ownerUrl.href, DATABASE_URL: '' },
    encoding: 'utf8',
  });
  expect(migrated.status).toBe(0);
  owner = new pg.Client({ connectionString: ownerUrl.href });
  await owner.connect();
  const secret = randomBytes(24).toString('hex');
  const quoted = (
    await admin.query<{ literal: string }>('SELECT quote_literal($1) AS literal', [secret])
  ).rows[0]!.literal;
  await admin.query(`CREATE ROLE "${role}" LOGIN INHERIT PASSWORD ${quoted}`);
  createdRole = true;
  await admin.query(`GRANT app_rw TO "${role}"`);
  const runtime = new URL(ownerUrl);
  runtime.username = role;
  runtime.password = secret;
  await rows(
    "INSERT INTO users(username,password_hash,full_name,role) VALUES('h028-staff',$1,'Synthetic HB028 control','OWNER')",
    [await hash(password, { memoryCost: 19456, timeCost: 2, parallelism: 1 })],
  );
  await startMail();
  const configuration = {
    DATABASE_URL: runtime.href,
    REDIS_URL: runtimeRedis.href,
    JWT_ACCESS_SECRET: accessSecret,
    JWT_REFRESH_SECRET: randomBytes(32).toString('hex'),
    BUSINESS_TIMEZONE: 'Asia/Ho_Chi_Minh',
    IDEMPOTENCY_TTL_HOURS: 24,
    LOG_LEVEL: 'info' as const,
    SMTP_URL: smtpUrl,
    GUEST_WEB_BASE_URL: guestBase,
    HOST: '127.0.0.1',
    PORT: 0,
  };
  const registered = AppModule.register(configuration);
  app = await NestFactory.create<NestFastifyApplication>(
    {
      ...registered,
      imports: (registered.imports ?? []).map((module) =>
        typeof module === 'object' &&
        module !== null &&
        'module' in module &&
        module.module === LoggerModule
          ? captureLogger(module)
          : module,
      ),
      providers: [
        ...(registered.providers ?? []).filter(
          (p) => typeof p !== 'object' || p === null || !('provide' in p) || p.provide !== CLOCK,
        ),
        { provide: CLOCK, useValue: clock },
      ],
    },
    new FastifyAdapter(),
    { logger: false, abortOnError: false },
  );
  app.useLogger(app.get(Logger));
  app.setGlobalPrefix('api/v1');
  await app.listen(0, '127.0.0.1');
}, 60000);
export async function clearAttempts() {
  if (!leased || !leases || (await leases.get(leaseKey)) !== lease)
    throw new Error('HB028 lease lost');
  await redis!.flushdb();
}
beforeEach(async () => {
  clock.value += 61000;
  await clearAttempts();
  await resetMail();
  clearLogs();
  await rows('TRUNCATE guests CASCADE');
  await rows("UPDATE users SET failed_login_count=0,locked_until=NULL WHERE username='h028-staff'");
});
afterAll(async () => {
  const failures: string[] = [];
  const attempt = async (name: string, job: () => Promise<unknown>) => {
    try {
      await job();
    } catch {
      failures.push(name);
    }
  };
  await attempt('app', async () => app?.close());
  await attempt('redis6', async () => redis?.quit());
  await attempt('owner', async () => owner?.end());
  if (admin) {
    if (createdDatabase)
      await attempt('database', () => admin!.query(`DROP DATABASE "${database}" WITH(FORCE)`));
    if (createdRole) await attempt('role', () => admin!.query(`DROP ROLE "${role}"`));
    await attempt('admin', () => admin!.end());
  }
  if (leased && leases)
    await attempt('lease', () =>
      leases!.eval(
        "if redis.call('GET',KEYS[1])==ARGV[1] then return redis.call('DEL',KEYS[1]) else return 0 end",
        1,
        leaseKey,
        lease,
      ),
    );
  await attempt('redis15', async () => leases?.quit());
  await attempt('mailpit', async () => closeMail());
  if (failures.length) throw new Error(`HB028 cleanup failed: ${failures.join(',')}`);
}, 30000);
