import { beforeAll, test, expect } from 'vitest';
import request from 'supertest';
import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { AuthService } from '../../src/modules/auth/auth.service.js';
import { AuditWriter } from '../../src/infrastructure/audit/audit-writer.js';
import type { ApiConfig } from '../../src/config/env.js';
import { Redis } from 'ioredis';
import { LoginAttempts } from '../../src/modules/auth/login-attempts.js';
import { errorBodySchema, tokenPairSchema } from '@pinehill/contracts';
import {
  clock,
  username,
  userId,
  password,
  secret,
  server,
  rows,
  loginRequest,
  login,
  refresh,
  error,
  probe,
  session,
} from './staff-auth.locked.fixture.js';

// Bind once: concurrent Supertest requests must share one listening HTTP server.
beforeAll(async () => {
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      server.removeListener('error', reject);
      resolve();
    });
  });
});

// Additional regression oracle; published phase A files stay byte-for-byte unchanged.
async function waitForLocks(count: number, table: string) {
  const until = performance.now() + 5000;
  while (performance.now() < until) {
    await rows('SELECT pg_stat_clear_snapshot()');
    const result = await rows(
      `SELECT count(*)::int AS n FROM pg_stat_activity
       WHERE datname=current_database() AND pid<>pg_backend_pid()
       AND wait_event_type='Lock' AND query ILIKE $1`,
      [`%${table}%`],
    );
    if (Number(result[0]?.n) >= count) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`Concurrency barrier not reached for ${table}`);
}

test('all successful login attempts consume the ten-per-minute IP quota', async () => {
  for (let i = 0; i < 10; i++) expect((await loginRequest()).status).toBe(200);
  error(await loginRequest(), 429, 'E_GEN_RATE_LIMITED');
});

test('locked account attempts also consume the IP quota', async () => {
  for (let i = 0; i < 5; i++)
    error(await loginRequest(username, 'Wrong-password!'), 401, 'E_AUTH_INVALID_CREDENTIALS');
  for (let i = 0; i < 5; i++) error(await loginRequest(), 401, 'E_AUTH_ACCOUNT_LOCKED');
  error(await loginRequest(), 429, 'E_GEN_RATE_LIMITED');
});

test('concurrent successful requests atomically admit at most ten logins per IP', async () => {
  const responses = await Promise.all(
    Array.from({ length: 16 }, () => loginRequest().then((r) => r)),
  );
  expect(responses.filter((r) => r.status === 200)).toHaveLength(10);
  expect(responses.filter((r) => r.status === 429)).toHaveLength(6);
});

test('five simultaneous wrong passwords persist five failures and lock the next attempt', async () => {
  await rows('BEGIN');
  await rows('SELECT id FROM users WHERE id=$1::uuid FOR UPDATE', [userId]);
  const pending = Array.from({ length: 5 }, () =>
    loginRequest(username, 'Wrong-password!').then((r) => r),
  );
  try {
    await waitForLocks(2, 'users');
  } finally {
    await rows('ROLLBACK');
  }
  const responses = await Promise.all(pending);
  expect(responses.every((r) => r.status === 401)).toBe(true);
  expect(
    (await rows('SELECT failed_login_count FROM users WHERE id=$1::uuid', [userId]))[0]
      ?.failed_login_count,
  ).toBe(5);
  error(await loginRequest(), 401, 'E_AUTH_ACCOUNT_LOCKED');
}, 15000);

test('after lock expiry known and missing accounts restart the same five-failure progression', async () => {
  const missing = 'missing-lock-expiry-review';
  for (let i = 0; i < 5; i++) {
    clock.advance(61000);
    error(await loginRequest(username, 'Wrong-password!'), 401, 'E_AUTH_INVALID_CREDENTIALS');
    error(await loginRequest(missing, 'Wrong-password!'), 401, 'E_AUTH_INVALID_CREDENTIALS');
  }
  clock.advance(900001);
  for (let i = 0; i < 5; i++) {
    error(await loginRequest(username, 'Wrong-password!'), 401, 'E_AUTH_INVALID_CREDENTIALS');
    error(await loginRequest(missing, 'Wrong-password!'), 401, 'E_AUTH_INVALID_CREDENTIALS');
  }
  clock.advance(61000);
  error(await loginRequest(), 401, 'E_AUTH_ACCOUNT_LOCKED');
  error(await loginRequest(missing), 401, 'E_AUTH_ACCOUNT_LOCKED');
});

for (const revocation of ['logout', 'replay'] as const) {
  test(`${revocation} racing a paused refresh revokes every committed descendant`, async () => {
    const first = await login();
    const current =
      revocation === 'replay'
        ? tokenPairSchema.parse((await refresh(first.refreshToken)).body)
        : first;
    await rows(`CREATE OR REPLACE FUNCTION hb013_pause_child() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        IF EXISTS(SELECT 1 FROM auth_sessions WHERE family_id=NEW.family_id AND rotated_at IS NOT NULL) THEN
          PERFORM pg_advisory_xact_lock(14130);
        END IF;
        RETURN NEW;
      END $$`);
    await rows(
      'CREATE TRIGGER hb013_pause_child BEFORE INSERT ON auth_sessions FOR EACH ROW EXECUTE FUNCTION hb013_pause_child()',
    );
    await rows('SELECT pg_advisory_lock(14130)');
    try {
      const rotation = refresh(current.refreshToken).then((r) => r);
      let revoke: Promise<Awaited<typeof rotation>> | undefined;
      try {
        await waitForLocks(1, 'auth_sessions');
        revoke =
          revocation === 'logout'
            ? request(server)
                .post('/api/v1/auth/logout')
                .set('Authorization', `Bearer ${first.accessToken}`)
                .then((r) => r)
            : refresh(first.refreshToken).then((r) => r);
        await waitForLocks(2, '');
      } finally {
        await rows('SELECT pg_advisory_unlock(14130)');
      }
      const rotated = await rotation;
      expect(rotated.status).toBe(200);
      expect((await revoke)?.status).toBe(revocation === 'logout' ? 204 : 401);
      const pair = tokenPairSchema.parse(rotated.body);
      const family = (await session(pair.refreshToken)).family_id;
      expect(
        await rows('SELECT id FROM auth_sessions WHERE family_id=$1::uuid AND revoked_at IS NULL', [
          family,
        ]),
      ).toHaveLength(0);
      error(await probe(pair.accessToken), 401, 'E_AUTH_INVALID_CREDENTIALS');
      error(await refresh(pair.refreshToken), 401, 'E_AUTH_INVALID_CREDENTIALS');
    } finally {
      await rows('DROP TRIGGER hb013_pause_child ON auth_sessions');
      await rows('DROP FUNCTION hb013_pause_child()');
    }
  }, 20000);
}

test('an access bearer with trailing credential material is rejected', async () => {
  const pair = await login();
  error(await probe(`${pair.accessToken} extra`), 401, 'E_AUTH_INVALID_CREDENTIALS');
});

test('missing-username concurrent counter updates are atomic in real Redis', async () => {
  const url = new URL(process.env.REDIS_URL!);
  url.pathname = '/14';
  const redis = new Redis(url.href);
  try {
    const attempts = new LoginAttempts(redis, clock);
    const states = await Promise.all(
      Array.from({ length: 5 }, () =>
        attempts.recordUsernameFailure('missing-atomic-review', 5, 900000),
      ),
    );
    expect(states.map((s) => s.failures).sort()).toEqual([1, 2, 3, 4, 5]);
    expect(await attempts.usernameLock('missing-atomic-review')).toBe(900);
  } finally {
    await redis.quit();
  }
});

test('rotated refresh advertises the remaining absolute family lifetime', async () => {
  const pair = await login('OPS_ANDROID');
  clock.advance(6 * 86400000);
  const response = await refresh(pair.refreshToken);
  expect(response.status).toBe(200);
  expect(tokenPairSchema.parse(response.body).refreshExpiresInSeconds).toBe(86400);
});

test('login session and family identifiers both use the injected IdGenerator', async () => {
  const url = new URL(process.env.DATABASE_MIGRATION_URL!);
  url.pathname = `/${String((await rows('SELECT current_database() AS name'))[0]?.name)}`;
  const redisUrl = new URL(process.env.REDIS_URL!);
  redisUrl.pathname = '/14';
  const prisma = new PrismaClient({ datasourceUrl: url.href });
  const redis = new Redis(redisUrl.href);
  const familyId = randomUUID(),
    sessionId = randomUUID();
  const generated = [familyId, sessionId];
  const config: ApiConfig = {
    DATABASE_URL: url.href,
    REDIS_URL: redisUrl.href,
    JWT_ACCESS_SECRET: secret,
    JWT_REFRESH_SECRET: secret,
    BUSINESS_TIMEZONE: 'Asia/Ho_Chi_Minh',
    IDEMPOTENCY_TTL_HOURS: 24,
    LOG_LEVEL: 'silent',
    PORT: 0,
    HOST: '127.0.0.1',
  };
  const service = new AuthService(
    config,
    clock,
    { generate: () => generated.shift() ?? randomUUID() },
    prisma,
    new LoginAttempts(redis, clock),
    new AuditWriter(clock),
  );
  try {
    const pair = await service.login(
      { username, password },
      { ip: '192.0.2.14', correlationId: 'synthetic-generator' },
    );
    expect(await session(pair.refreshToken)).toMatchObject({ id: sessionId, family_id: familyId });
  } finally {
    await prisma.$disconnect();
    await redis.quit();
  }
});

test('missing username failures do not expire independently of persisted real-account counters', async () => {
  const url = new URL(process.env.REDIS_URL!);
  url.pathname = '/14';
  const redis = new Redis(url.href);
  try {
    const attempts = new LoginAttempts(redis, clock);
    for (let i = 0; i < 4; i++)
      await attempts.recordUsernameFailure('missing-persistent-review', 5, 900000);
    expect(await redis.pttl('auth:user:missing-persistent-review')).toBe(-1);
    clock.advance(31 * 60000);
    expect(
      (await attempts.recordUsernameFailure('missing-persistent-review', 5, 900000)).failures,
    ).toBe(5);
  } finally {
    await redis.quit();
  }
});

test('six simultaneous failures have the same lock responses for real and missing users', async () => {
  for (const name of [username, 'missing-concurrent-sixth']) {
    clock.advance(61000);
    const responses = await Promise.all(
      Array.from({ length: 6 }, () => loginRequest(name, 'Wrong-password!').then((r) => r)),
    );
    expect(responses.map((r) => r.status)).toEqual([401, 401, 401, 401, 401, 401]);
    const codes = responses.map((r) => errorBodySchema.parse(r.body).code);
    expect(codes.filter((code) => code === 'E_AUTH_INVALID_CREDENTIALS')).toHaveLength(5);
    expect(codes.filter((code) => code === 'E_AUTH_ACCOUNT_LOCKED')).toHaveLength(1);
  }
});

test('a valid final subsecond of refresh lifetime still produces a contract-valid positive TTL', async () => {
  const pair = await login('OPS_ANDROID');
  clock.advance(7 * 86400000 - 500);
  const response = await refresh(pair.refreshToken);
  expect(response.status).toBe(200);
  expect(tokenPairSchema.parse(response.body).refreshExpiresInSeconds).toBe(1);
});
