import 'reflect-metadata';
import { Controller, Get } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { hash } from '@node-rs/argon2';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { createConnection } from 'node:net';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, expect } from 'vitest';
import { errorBodySchema, tokenPairSchema, type TokenPair } from '@pinehill/contracts';
import type { Clock } from '@pinehill/domain';
import type { FastifyInstance } from 'fastify';
import { AppModule } from '../../src/app.module.js';
import { CLOCK } from '../../src/infrastructure/ports.js';
import type { ApiConfig } from '../../src/config/env.js';

// Phase A fixture is pinned alongside the oracle. Phase B must not edit either file.
// HB-014 bootstrap convention: pinehill.permission = published auth.me (all signed-in staff).
// This route deliberately has no @Public(). HB-014 must consume the same metadata key.
@Controller('hb013-probe')
class ProtectedProbe {
  @Get('protected') guarded() {
    return { ok: true };
  }
}
Reflect.defineMetadata('pinehill.permission', 'auth.me', ProtectedProbe.prototype.guarded);
const root = fileURLToPath(new URL('../../../../', import.meta.url));
const initialTime = Date.UTC(2026, 9, 7, 8);
class TestClock implements Clock {
  value = initialTime;
  now() {
    return new Date(this.value);
  }
  advance(ms: number) {
    this.value += ms;
  }
}
const clock = new TestClock();
const password = 'Synthetic-password-013!';
const secret = randomBytes(32).toString('hex');
let admin: pg.Client | undefined,
  db: pg.Client | undefined,
  app: NestFastifyApplication | undefined;
let server: FastifyInstance['server'],
  redisUrl: URL,
  database = '',
  runtimeRole = '';
let sequence = 0,
  username = '',
  userId = '',
  propertyId = '',
  passwordHash = '';
const redisLeaseId = randomUUID();
let redisLeased = false;
async function rows(sql: string, parameters: unknown[] = []) {
  if (!db) throw new Error('HB013 database not initialized');
  return (await db.query<Record<string, unknown>>(sql, parameters)).rows;
}
async function redis(command: string, args: string[] = [], databaseIndex = '14'): Promise<string> {
  return new Promise((resolve, reject) => {
    const socket = createConnection({
      host: redisUrl.hostname,
      port: Number(redisUrl.port || 6379),
    });
    let response = '',
      selected = false;
    const send = (parts: string[]) =>
      socket.write(
        `*${parts.length}\r\n${parts.map((p) => `$${Buffer.byteLength(p)}\r\n${p}\r\n`).join('')}`,
      );
    socket.setTimeout(5000, () => socket.destroy(new Error('HB013 Redis timeout')));
    socket.on('error', reject);
    socket.on('connect', () => send(['SELECT', databaseIndex]));
    socket.on('data', (bytes) => {
      response += bytes.toString();
      if (!response.endsWith('\r\n')) return;
      if (response.startsWith('-')) {
        socket.destroy();
        reject(new Error('HB013 Redis rejected fixture command'));
        return;
      }
      if (!selected) {
        selected = true;
        response = '';
        send([command, ...args]);
      } else {
        socket.end();
        resolve(response.trim());
      }
    });
  });
}
function isFastify(value: unknown): value is FastifyInstance {
  return typeof value === 'object' && value !== null && 'server' in value && 'ready' in value;
}
beforeAll(async () => {
  const owner = process.env.DATABASE_MIGRATION_URL,
    redisSource = process.env.REDIS_URL;
  if (!owner || !redisSource)
    throw new Error(
      'HB013 requires dedicated real PostgreSQL16 owner and Redis7; no skip fallback',
    );
  redisUrl = new URL(redisSource);
  if (redisUrl.protocol !== 'redis:' || redisUrl.password)
    throw new Error('HB013 fixture requires dedicated plain Redis without authentication');
  redisUrl.pathname = '/14'; // Suite owns only DB14 on the explicitly supplied ephemeral test service.
  expect(await redis('PING')).toBe('+PONG');
  // DB15 lease survives DB14 FLUSHDB and refuses overlapping invocations on this service.
  const lease = await redis('SET', ['hb013:fixture:lease', redisLeaseId, 'NX', 'EX', '1800'], '15');
  if (lease !== '+OK')
    throw new Error('HB013 Redis fixture already leased; use a separate service');
  redisLeased = true;
  admin = new pg.Client({ connectionString: owner });
  await admin.connect();
  expect(
    (await admin.query<{ server_version_num: string }>('SHOW server_version_num')).rows[0]
      ?.server_version_num,
  ).toMatch(/^16/);
  const suffix = randomUUID().replaceAll('-', '');
  database = `hb013_${suffix}`;
  runtimeRole = `hb013_role_${suffix}`;
  await admin.query(`CREATE DATABASE "${database}"`);
  const connection = new URL(owner);
  connection.pathname = `/${database}`;
  const migrated = spawnSync(process.execPath, [`${root}scripts/migrate.mjs`], {
    cwd: root,
    env: { ...process.env, DATABASE_MIGRATION_URL: connection.href, DATABASE_URL: '' },
    encoding: 'utf8',
    timeout: 60000,
  });
  expect(migrated.status, 'HB013 published migration fixture must succeed').toBe(0);
  db = new pg.Client({ connectionString: connection.href });
  await db.connect();
  const runtimePassword = randomBytes(24).toString('hex');
  const quoted = await admin.query<{ literal: string }>(
    'SELECT quote_literal($1::text) AS literal',
    [runtimePassword],
  );
  await admin.query(
    `CREATE ROLE "${runtimeRole}" LOGIN INHERIT PASSWORD ${quoted.rows[0]!.literal}`,
  );
  await admin.query(`GRANT app_rw TO "${runtimeRole}"`);
  connection.username = runtimeRole;
  connection.password = runtimePassword;
  passwordHash = await hash(password, {
    memoryCost: 19456,
    timeCost: 2,
    parallelism: 1,
  });
  expect(passwordHash).toMatch(/^\$argon2id\$v=19\$m=19456,t=2,p=1\$/);
  const config: ApiConfig = {
    DATABASE_URL: connection.href,
    REDIS_URL: redisUrl.href,
    JWT_ACCESS_SECRET: secret,
    JWT_REFRESH_SECRET: randomBytes(32).toString('hex'),
    BUSINESS_TIMEZONE: 'Asia/Ho_Chi_Minh',
    IDEMPOTENCY_TTL_HOURS: 24,
    LOG_LEVEL: 'silent',
    PORT: 0,
    HOST: '127.0.0.1',
  };
  const registered = AppModule.register(config);
  const providers = (registered.providers ?? []).filter(
    (p) => typeof p !== 'object' || p === null || !('provide' in p) || p.provide !== CLOCK,
  );
  app = await NestFactory.create<NestFastifyApplication>(
    {
      ...registered,
      controllers: [...(registered.controllers ?? []), ProtectedProbe],
      providers: [...providers, { provide: CLOCK, useValue: clock }],
    },
    new FastifyAdapter(),
    { logger: false },
  );
  app.setGlobalPrefix('api/v1');
  await app.init();
  const instance: unknown = app.getHttpAdapter().getInstance();
  if (!isFastify(instance)) throw new Error('HB013 requires real Fastify');
  await instance.ready();
  server = instance.server;
  expect(app.get<Clock>(CLOCK)).toBe(clock);
}, 60000);
beforeEach(async () => {
  clock.value = initialTime;
  await redis('FLUSHDB');
  sequence++;
  username = `synthetic-staff-${sequence}`;
  userId = String(
    (
      await rows(
        'INSERT INTO users(username,password_hash,full_name,role) VALUES($1,$2,$3,$4) RETURNING id',
        [username, passwordHash, 'Synthetic staff', 'MANAGER'],
      )
    )[0]!.id,
  );
  propertyId = String(
    (
      await rows(
        'INSERT INTO properties(code,name,address,phone,latitude,longitude) VALUES($1,$2,$3,$4,0,0) RETURNING id',
        [`H013-${sequence}`, 'Synthetic property', 'Synthetic address', '+84900000013'],
      )
    )[0]!.id,
  );
  await rows('INSERT INTO user_property_scopes(user_id,property_id) VALUES($1::uuid,$2::uuid)', [
    userId,
    propertyId,
  ]);
});
afterAll(async () => {
  try {
    await app?.close();
    await db?.end();
    if (admin) {
      try {
        if (database) await admin.query(`DROP DATABASE IF EXISTS "${database}" WITH (FORCE)`);
        if (runtimeRole) await admin.query(`DROP ROLE IF EXISTS "${runtimeRole}"`);
      } finally {
        await admin.end();
      }
    }
  } finally {
    if (redisLeased) {
      await redis(
        'EVAL',
        [
          "if redis.call('GET',KEYS[1]) == ARGV[1] then return redis.call('DEL',KEYS[1]) else return 0 end",
          '1',
          'hb013:fixture:lease',
          redisLeaseId,
        ],
        '15',
      );
      redisLeased = false;
    }
  }
}, 30000);
const loginRequest = (name = username, pass = password, surface = 'OPS_WEB') =>
  request(server)
    .post('/api/v1/auth/login')
    .send({ username: name, password: pass, clientSurface: surface });
async function login(surface = 'OPS_WEB'): Promise<TokenPair> {
  const response = await loginRequest(username, password, surface);
  expect(response.status).toBe(200);
  const body: unknown = response.body;
  return tokenPairSchema.parse(body);
}
const refresh = (token: string) =>
  request(server).post('/api/v1/auth/refresh').send({ refreshToken: token });
const probe = (token?: string) => {
  const r = request(server).get('/api/v1/hb013-probe/protected');
  return token ? r.set('Authorization', `Bearer ${token}`) : r;
};
function error(response: { status: number; body: unknown }, status: number, code: string) {
  expect(response.status).toBe(status);
  const body = errorBodySchema.parse(response.body);
  expect(body.code).toBe(code);
  return body;
}
async function session(token: string) {
  const found = await rows('SELECT * FROM auth_sessions WHERE token_hash=$1', [
    createHash('sha256').update(token).digest('hex'),
  ]);
  expect(found).toHaveLength(1);
  return found[0]!;
}
const median = (values: number[]) =>
  [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)]!;

// Stable technical audit vocabulary for B; User is the target, unauthenticated attempts use SYSTEM.
async function auditSequence() {
  return String((await rows('SELECT COALESCE(max(chain_seq),0) AS seq FROM audit_logs'))[0]!.seq);
}
async function expectAudit(
  sequence: string,
  action: string,
  authenticated: boolean,
  surface?: string,
) {
  const inserted = await rows(
    'SELECT * FROM audit_logs WHERE chain_seq > $1::bigint ORDER BY chain_seq',
    [sequence],
  );
  const events = inserted.filter((row) => row.action === action);
  expect(events.length, `Missing durable ${action} audit`).toBeGreaterThan(0);
  for (const event of events) {
    expect(event).toMatchObject({
      actor_id: authenticated ? userId : null,
      actor_role: authenticated ? 'MANAGER' : 'SYSTEM',
      entity_type: 'User',
      entity_id: userId,
      at: new Date(clock.value),
    });
    expect(event.ip_address).toMatch(/^(127\.0\.0\.1|::1|::ffff:127\.0\.0\.1)$/);
    if (surface) expect(event.after_json).toMatchObject({ clientSurface: surface });
  }
}
export {
  clock,
  initialTime,
  password,
  passwordHash,
  secret,
  server,
  username,
  userId,
  propertyId,
  rows,
  redis,
  loginRequest,
  login,
  refresh,
  probe,
  error,
  session,
  median,
  auditSequence,
  expectAudit,
};
