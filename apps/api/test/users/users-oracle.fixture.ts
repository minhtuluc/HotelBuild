import 'reflect-metadata';
import { randomBytes, randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { hash, verify } from '@node-rs/argon2';
import pg from 'pg';
import type { PrismaClient } from '@prisma/client';
import { PRISMA } from '../../src/infrastructure/prisma/prisma.module.js';
import { Redis } from 'ioredis';
import request from 'supertest';
import { beforeAll, beforeEach, afterAll, expect } from 'vitest';
import { tokenPairSchema, userSummarySchema, listResponseSchema } from '@pinehill/contracts';
import { AppModule } from '../../src/app.module.js';
import { CLOCK } from '../../src/infrastructure/ports.js';

// Oracle fixture: actual AppModule, PG16 with app_rw privileges, Argon2id and leased Redis7.
const root = fileURLToPath(new URL('../../../../', import.meta.url));
const database = `hb016_${randomUUID().replaceAll('-', '')}`;
const runtimeRole = `hb016_${randomUUID().replaceAll('-', '')}`;
const lease = randomUUID(),
  leaseKey = 'hb016:redis9:lease';
const password = 'Synthetic-HB016-password!';
export const clock = {
  value: Date.UTC(2026, 9, 9, 8),
  now() {
    return new Date(this.value);
  },
};
export const identities = new Map<string, string>();
let sequence = 0;
export const username = (name: string) => `h016-${sequence}-${name}`;
export let propertyA = '',
  propertyB = '';
let admin: pg.Client | undefined, owner: pg.Client | undefined;
let app: NestFastifyApplication | undefined, redis: Redis | undefined, leases: Redis | undefined;
let leased = false,
  createdDatabase = false,
  createdRole = false;
export const http = () => {
  if (!app) throw new Error('HB016 app unavailable');
  return request(app.getHttpServer());
};
export function businessDb() {
  if (!app) throw new Error('HB016 app unavailable');
  return app.get<PrismaClient>(PRISMA);
}
export async function rows(sql: string, values: unknown[] = []) {
  if (!owner) throw new Error('HB016 database unavailable');
  return (await owner.query<Record<string, unknown>>(sql, values)).rows;
}
export const id = (name: string) => {
  const value = identities.get(name);
  if (!value) throw new Error('HB016 fixture identity unavailable');
  return value;
};
export async function login(name = 'owner-a', surface = 'OPS_WEB') {
  const response = await http()
    .post('/api/v1/auth/login')
    .send({
      username: username(name),
      password,
      clientSurface: surface,
    });
  expect(response.status).toBe(200);
  return tokenPairSchema.parse(response.body);
}
export async function listed(token: string, query: object = {}) {
  const response = await http()
    .get('/api/v1/users')
    .set('Authorization', `Bearer ${token}`)
    .query(query);
  expect(response.status).toBe(200);
  expect(response.headers.etag).toMatch(/^"[^"\r\n]+"$/);
  // Check the raw JSON too: decoder stripping unknown fields must not hide secrets.
  expect(JSON.stringify(response.body)).not.toMatch(
    /password_hash|passwordHash|pin_hash|pinHash|token_hash|tokenHash|temporaryPassword/,
  );
  return listResponseSchema(userSummarySchema).parse(response.body);
}
export async function match(token: string, name: string) {
  const result = await listed(token, { q: username(name), limit: 100 });
  const target = result.data.find((u) => u.id === id(name));
  expect(target).toBeDefined();
  return `"${target!.version}"`;
}
export function access(token: string, target: string, body: object, version?: string) {
  const command = http()
    .put(`/api/v1/users/${id(target)}/access`)
    .set('Authorization', `Bearer ${token}`)
    .set('Idempotency-Key', randomUUID());
  if (version !== undefined) command.set('If-Match', version);
  return command.send(body);
}
export function create(token: string, body: object, key = randomUUID()) {
  return http()
    .post('/api/v1/users')
    .set('Authorization', `Bearer ${token}`)
    .set('Idempotency-Key', key)
    .send(body);
}
export const newUser = (name = 'new-person', role = 'FRONT_DESK') => ({
  username: username(name),
  fullName: 'Synthetic HB016',
  role,
  propertyScope: [propertyA],
  temporaryPassword: password,
});
export const changes = (role = 'FRONT_DESK', active = true, properties = [propertyA]) => ({
  role,
  isActive: active,
  propertyScope: properties,
});
export async function state(name: string) {
  const user = (
    await rows(
      "SELECT role,is_active,updated_at,to_jsonb(users)->'version' AS optional_version,must_change_password,encode(digest(password_hash,'sha256'),'hex') AS password_fingerprint FROM users WHERE id=$1",
      [id(name)],
    )
  )[0]!;
  const scopes = await rows(
    'SELECT property_id FROM user_property_scopes WHERE user_id=$1 ORDER BY property_id',
    [id(name)],
  );
  const sessions = await rows(
    'SELECT id,revoked_at FROM auth_sessions WHERE user_id=$1 ORDER BY id',
    [id(name)],
  );
  return { user, scopes, sessions };
}
export async function assertAccess(name: string, expected: ReturnType<typeof changes>) {
  const saved = await state(name);
  expect(saved.user.role).toBe(expected.role);
  expect(saved.user.is_active).toBe(expected.isActive);
  expect(saved.scopes.map((s) => s.property_id)).toEqual([...expected.propertyScope].sort());
  return saved;
}
export async function auditCount() {
  return Number(
    (
      await rows(
        "SELECT count(*) AS n FROM audit_logs WHERE entity_type='User' AND action NOT IN ('AUTH_LOGIN_SUCCESS','AUTH_LOGIN_FAILURE','AUTH_LOGIN_LOCKED','AUTH_PASSWORD_CHANGED')",
      )
    )[0]!.n,
  );
}
export async function assertPassword(username: string, plain: string) {
  const stored = String(
    (await rows('SELECT password_hash FROM users WHERE username=$1', [username]))[0]!.password_hash,
  );
  expect(stored.startsWith('$argon2id$')).toBe(true);
  expect(stored.includes(plain)).toBe(false);
  expect(await verify(stored, plain)).toBe(true);
}
export async function assertAudit(
  target: string,
  before: object | null,
  after: object,
  actorName = 'owner-a',
) {
  const audits = await rows(
    "SELECT actor_id,actor_role,before_json,after_json FROM audit_logs WHERE entity_type='User' AND action NOT IN ('AUTH_LOGIN_SUCCESS','AUTH_LOGIN_FAILURE','AUTH_LOGIN_LOCKED','AUTH_PASSWORD_CHANGED') AND entity_id=$1 ORDER BY chain_seq DESC LIMIT 1",
    [target],
  );
  expect(audits).toHaveLength(1);
  expect(audits[0]!.actor_id).toBe(id(actorName));
  expect(audits[0]!.actor_role).toBe(actorName === 'admin' ? 'SYSADMIN' : 'OWNER');
  if (before === null) expect(audits[0]!.before_json).toBeNull();
  else expect(audits[0]!.before_json).toMatchObject(before);
  expect(audits[0]!.after_json).toMatchObject(after);
  expect(JSON.stringify(audits)).not.toContain(password);
  expect(JSON.stringify(audits)).not.toMatch(/\$argon2id\$|password_hash|token_hash/);
}

beforeAll(async () => {
  const migrationUrl = process.env.DATABASE_MIGRATION_URL,
    redisUrl = process.env.REDIS_URL;
  if (!migrationUrl || !redisUrl)
    throw new Error('HB016 requires owned PG16/Redis7; no skip fallback');
  const leaseUrl = new URL(redisUrl);
  leaseUrl.pathname = '/15';
  leases = new Redis(leaseUrl.href, { maxRetriesPerRequest: 1 });
  expect(await leases.ping()).toBe('PONG');
  expect((await leases.info('server')).match(/redis_version:7\./)).not.toBeNull();
  if ((await leases.set(leaseKey, lease, 'EX', 1800, 'NX')) !== 'OK')
    throw new Error('HB016 Redis9 already leased; use another owned service');
  leased = true;
  const runtimeRedis = new URL(redisUrl);
  runtimeRedis.pathname = '/9';
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
  const migration = spawnSync(process.execPath, [`${root}scripts/migrate.mjs`], {
    cwd: root,
    env: { ...process.env, DATABASE_MIGRATION_URL: ownerUrl.href, DATABASE_URL: '' },
    encoding: 'utf8',
  });
  expect(migration.status).toBe(0);
  owner = new pg.Client({ connectionString: ownerUrl.href });
  await owner.connect();
  const runtimePassword = randomBytes(24).toString('hex');
  const quoted = (
    await admin.query<{ literal: string }>('SELECT quote_literal($1) AS literal', [runtimePassword])
  ).rows[0]!.literal;
  await admin.query(`CREATE ROLE "${runtimeRole}" LOGIN INHERIT PASSWORD ${quoted}`);
  createdRole = true;
  await admin.query(`GRANT app_rw TO "${runtimeRole}"`);
  const runtime = new URL(ownerUrl);
  runtime.username = runtimeRole;
  runtime.password = runtimePassword;
  const registered = AppModule.register({
    DATABASE_URL: runtime.href,
    REDIS_URL: runtimeRedis.href,
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
      ...registered,
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
  app.setGlobalPrefix('api/v1');
  await app.listen(0, '127.0.0.1');
}, 60000);
beforeEach(async () => {
  clock.value += 61000;
  if (!leased || !leases || (await leases.get(leaseKey)) !== lease)
    throw new Error('HB016 lease lost');
  await redis!.flushdb();
  // Owner-only reset of this disposable database; never production privileges.
  await rows('UPDATE users SET is_active=false');
  sequence += 1;
  identities.clear();
  for (const code of [`H016-${sequence}-A`, `H016-${sequence}-B`]) {
    const prop = String(
      (
        await rows(
          'INSERT INTO properties(code,name,address,phone,latitude,longitude) VALUES($1,$1,$1,$1,0,0) RETURNING id',
          [code],
        )
      )[0]!.id,
    );
    if (code.endsWith('A')) propertyA = prop;
    else propertyB = prop;
  }
  const encoded = await hash(password, { memoryCost: 19456, timeCost: 2, parallelism: 1 });
  for (const [name, role, property] of [
    ['owner-a', 'OWNER', null],
    ['owner-b', 'OWNER', null],
    ['admin', 'SYSADMIN', null],
    ['manager', 'MANAGER', propertyA],
    ['staff-a', 'FRONT_DESK', propertyA],
    ['staff-b', 'FRONT_DESK', propertyB],
  ] as const) {
    const principal = String(
      (
        await rows(
          'INSERT INTO users(username,password_hash,full_name,role,updated_at) VALUES($1,$2,$1,$3,$4) RETURNING id',
          [username(name), encoded, role, clock.now()],
        )
      )[0]!.id,
    );
    identities.set(name, principal);
    if (property)
      await rows('INSERT INTO user_property_scopes(user_id,property_id) VALUES($1,$2)', [
        principal,
        property,
      ]);
  }
}, 30000);
afterAll(async () => {
  const failures: unknown[] = [];
  const attempt = async (job: () => Promise<unknown>) => {
    try {
      await job();
    } catch (error) {
      failures.push(error);
    }
  };
  await attempt(async () => app?.close());
  await attempt(async () => redis?.quit());
  await attempt(async () => owner?.end());
  if (admin) {
    if (createdDatabase)
      await attempt(() => admin!.query(`DROP DATABASE "${database}" WITH(FORCE)`));
    if (createdRole) await attempt(() => admin!.query(`DROP ROLE "${runtimeRole}"`));
    await attempt(() => admin!.end());
  }
  if (leased && leases)
    await attempt(() =>
      leases!.eval(
        "if redis.call('GET',KEYS[1]) == ARGV[1] then return redis.call('DEL',KEYS[1]) else return 0 end",
        1,
        leaseKey,
        lease,
      ),
    );
  await attempt(async () => leases?.quit());
  if (failures.length) throw new Error(`HB016 cleanup failed in ${failures.length} operations`);
}, 30000);

/** Hold both target rows until both production transactions are blocked in PostgreSQL.
 * Prevents a scheduling accident (second auth sees revoked session) from hiding a lost-owner race. */
export async function underUserLocks<T>(names: string[], commands: () => Promise<T>[]) {
  await rows('BEGIN');
  let finished = 0;
  let requests: Promise<PromiseSettledResult<T>[]> | undefined;
  try {
    await rows('SELECT id FROM users WHERE id=ANY($1::uuid[]) ORDER BY id FOR UPDATE', [
      names.map(id),
    ]);
    requests = Promise.allSettled(
      commands().map(async (command) => {
        try {
          return await command;
        } finally {
          finished++;
        }
      }),
    );
    const deadline = Date.now() + 5000;
    while (finished === 0) {
      // PG caches stats inside our holding transaction; refresh before observing new waiters.
      await rows('SELECT pg_stat_clear_snapshot()');
      const waiting = Number(
        (
          await rows(
            "SELECT count(*) AS n FROM pg_stat_activity WHERE usename=$1 AND wait_event_type='Lock'",
            [runtimeRole],
          )
        )[0]!.n,
      );
      if (waiting >= 2) break;
      if (Date.now() >= deadline)
        throw new Error('HB016 race barrier: two requests did not reach DB locks');
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  } finally {
    await rows('ROLLBACK');
    // Drain HTTP work even if the barrier fails, before fixture teardown touches the DB.
    await requests;
  }
  if (requests === undefined) throw new Error('HB016 race commands unavailable');
  return (await requests).map((result) => {
    if (result.status === 'fulfilled') return result.value;
    throw result.reason instanceof Error ? result.reason : new Error('HB016 race request failed');
  });
}
