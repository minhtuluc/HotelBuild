import { verify } from '@node-rs/argon2';
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import request from 'supertest';
import { expect, test } from 'vitest';
import { accessTokenClaimsSchema, tokenPairSchema, userMeSchema } from '@pinehill/contracts';
import {
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
} from './staff-auth.locked.fixture.js';

// Both this oracle and its fixture must retain their published SHA-256 through phase B.
test('control: real PG16/Redis7 health succeeds without authentication', async () => {
  const response = await request(server).get('/api/v1/system/health');
  expect(response.status).toBe(200);
  expect(response.body).toEqual({ status: 'ok' });
});
test('login signs HS256 claims for15minutes and stores only SHA256 of32byte refresh', async () => {
  const pair = await login();
  expect(pair.expiresInSeconds).toBe(900);
  expect(pair.refreshExpiresInSeconds).toBe(604800);
  const [header, payload, signature] = pair.accessToken.split('.');
  expect([header, payload, signature].every(Boolean)).toBe(true);
  const jwtHeader: unknown = JSON.parse(Buffer.from(header!, 'base64url').toString());
  expect(jwtHeader).toMatchObject({ alg: 'HS256' });
  const actual = Buffer.from(signature!, 'base64url'),
    expected = createHmac('sha256', secret).update(`${header}.${payload}`).digest();
  expect(actual.length).toBe(32);
  expect(timingSafeEqual(actual, expected)).toBe(true);
  const body: unknown = JSON.parse(Buffer.from(payload!, 'base64url').toString());
  const claims = accessTokenClaimsSchema.parse(body);
  expect(claims).toMatchObject({
    userId,
    role: 'MANAGER',
    propertyScope: [propertyId],
    expiresAt: new Date(clock.value + 900000).toISOString(),
  });
  expect(body).toMatchObject({ exp: clock.value / 1000 + 900 });
  expect(
    Buffer.from(pair.refreshToken, /^[a-f\d]{64}$/i.test(pair.refreshToken) ? 'hex' : 'base64url')
      .length,
  ).toBe(32);
  const row = await session(pair.refreshToken);
  expect(row).toMatchObject({
    user_id: userId,
    principal_type: 'USER',
    surface: 'OPS_WEB',
    revoked_at: null,
    rotated_at: null,
  });
  expect(JSON.stringify(row)).not.toContain(pair.refreshToken);
  expect(Number(new Date(String(row.expires_at))) - clock.value).toBe(604800000);
  expect((await probe(pair.accessToken)).status).toBe(200);
});
test('five failed passwords lock the sixth even correct password; Clock+15min unlocks', async () => {
  for (let i = 0; i < 5; i++)
    error(await loginRequest(username, 'Wrong-password-013!'), 401, 'E_AUTH_INVALID_CREDENTIALS');
  const locked = error(await loginRequest(), 401, 'E_AUTH_ACCOUNT_LOCKED');
  expect(locked.retryAfterSeconds).toBe(900);
  expect(
    (
      await rows('SELECT failed_login_count,locked_until FROM users WHERE id=$1::uuid', [userId])
    )[0],
  ).toMatchObject({ failed_login_count: 5, locked_until: new Date(clock.value + 900000) });
  clock.advance(900001);
  await login();
  expect(
    (
      await rows('SELECT failed_login_count,locked_until FROM users WHERE id=$1::uuid', [userId])
    )[0],
  ).toMatchObject({ failed_login_count: 0, locked_until: null });
});
test('a successful login resets consecutive wrong attempts', async () => {
  for (let i = 0; i < 4; i++)
    error(await loginRequest(username, 'Wrong-password-013!'), 401, 'E_AUTH_INVALID_CREDENTIALS');
  await login();
  for (let i = 0; i < 4; i++)
    error(await loginRequest(username, 'Wrong-password-013!'), 401, 'E_AUTH_INVALID_CREDENTIALS');
  await login();
});
test('unknown account has the same error and lock progression as wrong password', async () => {
  for (let i = 0; i < 5; i++) {
    clock.advance(61000);
    const known = error(
      await loginRequest(username, 'Wrong-password-013!'),
      401,
      'E_AUTH_INVALID_CREDENTIALS',
    );
    const missing = error(
      await loginRequest('missing-synthetic-user', 'Wrong-password-013!'),
      401,
      'E_AUTH_INVALID_CREDENTIALS',
    );
    expect(missing.message).toBe(known.message);
  }
  const known = error(await loginRequest(), 401, 'E_AUTH_ACCOUNT_LOCKED'),
    missing = error(await loginRequest('missing-synthetic-user'), 401, 'E_AUTH_ACCOUNT_LOCKED');
  expect(missing.message).toBe(known.message);
  expect(missing.retryAfterSeconds).toBe(known.retryAfterSeconds);
});
test('unknown-account response time is comparable to a real wrong-password hash check', async () => {
  const known: number[] = [],
    missing: number[] = [];
  for (let i = 0; i < 12; i++) {
    await redis('FLUSHDB');
    await rows('UPDATE users SET failed_login_count=0,locked_until=NULL WHERE id=$1::uuid', [
      userId,
    ]);
    for (const kind of i % 2 ? ['missing', 'known'] : ['known', 'missing']) {
      const started = performance.now();
      const response = await loginRequest(
        kind === 'known' ? username : 'missing-timing-user',
        'Wrong-password-013!',
      );
      const elapsed = performance.now() - started;
      error(response, 401, 'E_AUTH_INVALID_CREDENTIALS');
      (kind === 'known' ? known : missing).push(elapsed);
    }
  }
  const ratio = median(missing) / median(known);
  expect(ratio).toBeGreaterThanOrEqual(0.5);
  expect(ratio).toBeLessThanOrEqual(2);
}, 30000);
test('IP limit is shared across usernames and ignores untrusted forwarded-for spoofing', async () => {
  for (let i = 0; i < 10; i++)
    error(
      await loginRequest(`missing-rate-${i}`).set('X-Forwarded-For', `192.0.2.${i + 1}`),
      401,
      'E_AUTH_INVALID_CREDENTIALS',
    );
  const response = await loginRequest('missing-rate-eleventh').set(
    'X-Forwarded-For',
    '192.0.2.200',
  );
  const limited = error(response, 429, 'E_GEN_RATE_LIMITED');
  expect(limited.retryAfterSeconds).toBeGreaterThan(0);
  expect(limited.retryAfterSeconds).toBeLessThanOrEqual(60);
  expect(response.headers['retry-after']).toBe(String(limited.retryAfterSeconds));
});
test('inactive users cannot log in', async () => {
  await rows('UPDATE users SET is_active=false WHERE id=$1::uuid', [userId]);
  error(await loginRequest(), 401, 'E_AUTH_INVALID_CREDENTIALS');
});
test('a route with no Public annotation denies missing and forged access tokens', async () => {
  error(await probe(), 401, 'E_AUTH_INVALID_CREDENTIALS');
  error(await probe('forged-synthetic-access-token'), 401, 'E_AUTH_INVALID_CREDENTIALS');
});
test('refresh rotates rows in one family; replay revokes the entire family including newest access', async () => {
  const first = await login(),
    before = await session(first.refreshToken);
  const response = await refresh(first.refreshToken);
  expect(response.status).toBe(200);
  const next = tokenPairSchema.parse(response.body);
  expect(next.refreshToken).not.toBe(first.refreshToken);
  const after = await session(next.refreshToken);
  expect(after.family_id).toBe(before.family_id);
  expect((await session(first.refreshToken)).rotated_at).not.toBeNull();
  error(await refresh(first.refreshToken), 401, 'E_AUTH_INVALID_CREDENTIALS');
  error(await refresh(next.refreshToken), 401, 'E_AUTH_INVALID_CREDENTIALS');
  error(await probe(next.accessToken), 401, 'E_AUTH_INVALID_CREDENTIALS');
  expect(
    (
      await rows('SELECT revoked_at FROM auth_sessions WHERE family_id=$1::uuid', [after.family_id])
    ).every((row) => row.revoked_at !== null),
  ).toBe(true);
});
test('concurrent refresh of one token has one winner then invalidates that winner on reuse', async () => {
  const first = await login();
  const responses = await Promise.all([refresh(first.refreshToken), refresh(first.refreshToken)]);
  expect(responses.map((r) => r.status).sort()).toEqual([200, 401]);
  const winner = responses.find((r) => r.status === 200);
  if (!winner) throw new Error('No refresh winner');
  const pair = tokenPairSchema.parse(winner.body);
  error(await refresh(pair.refreshToken), 401, 'E_AUTH_INVALID_CREDENTIALS');
  error(await probe(pair.accessToken), 401, 'E_AUTH_INVALID_CREDENTIALS');
});
test('logout revokes the family and access token; missing bearer cannot revoke another session', async () => {
  const pair = await login();
  error(await request(server).post('/api/v1/auth/logout'), 401, 'E_AUTH_INVALID_CREDENTIALS');
  expect((await probe(pair.accessToken)).status).toBe(200);
  const response = await request(server)
    .post('/api/v1/auth/logout')
    .set('Authorization', `Bearer ${pair.accessToken}`);
  expect(response.status).toBe(204);
  error(await refresh(pair.refreshToken), 401, 'E_AUTH_INVALID_CREDENTIALS');
  error(await probe(pair.accessToken), 401, 'E_AUTH_INVALID_CREDENTIALS');
});
test('OPS_WEB expires at15 idle minutes; authenticated activity extends idle and throttles last_seen to60s', async () => {
  const pair = await login();
  clock.advance(59000);
  expect((await probe(pair.accessToken)).status).toBe(200);
  expect(new Date(String((await session(pair.refreshToken)).last_seen_at)).getTime()).toBe(
    initialTime,
  );
  clock.advance(1000);
  expect((await probe(pair.accessToken)).status).toBe(200);
  expect(new Date(String((await session(pair.refreshToken)).last_seen_at)).getTime()).toBe(
    clock.value,
  );
  clock.advance(840000);
  const refreshed = await refresh(pair.refreshToken);
  expect(refreshed.status).toBe(200);
  const current = tokenPairSchema.parse(refreshed.body);
  clock.advance(900000);
  error(await refresh(current.refreshToken), 401, 'E_AUTH_INVALID_CREDENTIALS');
});
test('OPS_ANDROID survives web idle timeout but expires after7days', async () => {
  const pair = await login('OPS_ANDROID');
  clock.advance(900001);
  const response = await refresh(pair.refreshToken);
  expect(response.status).toBe(200);
  const current = tokenPairSchema.parse(response.body);
  clock.advance(604800001);
  error(await refresh(current.refreshToken), 401, 'E_AUTH_INVALID_CREDENTIALS');
});
test('expired or tampered access tokens cannot access protected routes', async () => {
  // Android has no 15-minute idle expiry, so idle rejection cannot hide a missing JWT exp check.
  const pair = await login('OPS_ANDROID');
  const [header, payload] = pair.accessToken.split('.');
  const forged = `${header}.${payload}.${randomBytes(32).toString('base64url')}`;
  error(await probe(forged), 401, 'E_AUTH_INVALID_CREDENTIALS');
  clock.advance(899999);
  expect((await probe(pair.accessToken)).status).toBe(200);
  clock.advance(1);
  error(await probe(pair.accessToken), 401, 'E_AUTH_INVALID_CREDENTIALS');
});
test('mustChangePassword permits only password/logout; changing password hashes it and unblocks new login', async () => {
  await rows('UPDATE users SET must_change_password=true WHERE id=$1::uuid', [userId]);
  const pair = await login();
  expect(pair.mustChangePassword).toBe(true);
  error(await probe(pair.accessToken), 403, 'E_AUTH_PASSWORD_CHANGE_REQUIRED');
  error(
    await request(server).get('/api/v1/auth/me').set('Authorization', `Bearer ${pair.accessToken}`),
    403,
    'E_AUTH_PASSWORD_CHANGE_REQUIRED',
  );
  const unchanged = (
    await rows('SELECT password_hash,must_change_password FROM users WHERE id=$1::uuid', [userId])
  )[0]!;
  error(
    await request(server)
      .post('/api/v1/auth/password')
      .send({ currentPassword: password, newPassword: 'New-synthetic-password-013!' }),
    401,
    'E_AUTH_INVALID_CREDENTIALS',
  );
  error(
    await request(server)
      .post('/api/v1/auth/password')
      .set('Authorization', `Bearer ${pair.accessToken}`)
      .send({ currentPassword: 'Wrong-password-013!', newPassword: 'New-synthetic-password-013!' }),
    401,
    'E_AUTH_INVALID_CREDENTIALS',
  );
  expect(
    (
      await rows('SELECT password_hash,must_change_password FROM users WHERE id=$1::uuid', [userId])
    )[0],
  ).toEqual(unchanged);
  expect((await login()).mustChangePassword).toBe(true);
  const changed = await request(server)
    .post('/api/v1/auth/password')
    .set('Authorization', `Bearer ${pair.accessToken}`)
    .send({ currentPassword: password, newPassword: 'New-synthetic-password-013!' });
  expect(changed.status).toBe(204);
  const stored = (
    await rows('SELECT password_hash,must_change_password FROM users WHERE id=$1::uuid', [userId])
  )[0]!;
  expect(stored.must_change_password).toBe(false);
  expect(typeof stored.password_hash).toBe('string');
  if (typeof stored.password_hash !== 'string') throw new Error('Missing password hash');
  expect(stored.password_hash).toMatch(/^\$argon2id\$/);
  expect(await verify(stored.password_hash, 'New-synthetic-password-013!')).toBe(true);
  const next = await loginRequest(username, 'New-synthetic-password-013!');
  expect(next.status).toBe(200);
  expect(tokenPairSchema.parse(next.body).mustChangePassword).not.toBe(true);
});
test('mustChangePassword still permits logout', async () => {
  await rows('UPDATE users SET must_change_password=true WHERE id=$1::uuid', [userId]);
  const pair = await login();
  expect(
    (
      await request(server)
        .post('/api/v1/auth/logout')
        .set('Authorization', `Bearer ${pair.accessToken}`)
    ).status,
  ).toBe(204);
});
test('auth/me reads role, scope and PIN from current DB instead of trusting stale JWT claims or body', async () => {
  const pair = await login();
  await rows('UPDATE users SET role=$1 WHERE id=$2::uuid', ['FRONT_DESK', userId]);
  await rows('DELETE FROM user_property_scopes WHERE user_id=$1::uuid', [userId]);
  await rows('INSERT INTO user_pins(user_id,pin_hash) VALUES($1::uuid,$2)', [userId, passwordHash]);
  const response = await request(server)
    .get('/api/v1/auth/me')
    .set('Authorization', `Bearer ${pair.accessToken}`);
  expect(response.status).toBe(200);
  expect(userMeSchema.parse(response.body)).toEqual({
    userId,
    username,
    fullName: 'Synthetic staff',
    role: 'FRONT_DESK',
    propertyScope: [],
    hasPin: true,
    mustChangePassword: false,
  });
});
test('success/failure/lock/password-change each leave durable audit without credentials or tokens', async () => {
  const before = await auditSequence();
  const pair = await login();
  await expectAudit(before, 'AUTH_LOGIN_SUCCESS', true, 'OPS_WEB');
  const success = await auditSequence();
  error(await loginRequest(username, 'Wrong-password-013!'), 401, 'E_AUTH_INVALID_CREDENTIALS');
  await expectAudit(success, 'AUTH_LOGIN_FAILURE', false, 'OPS_WEB');
  for (let i = 0; i < 4; i++)
    error(await loginRequest(username, 'Wrong-password-013!'), 401, 'E_AUTH_INVALID_CREDENTIALS');
  const beforeLocked = await auditSequence();
  error(await loginRequest(), 401, 'E_AUTH_ACCOUNT_LOCKED');
  await expectAudit(beforeLocked, 'AUTH_LOGIN_LOCKED', false, 'OPS_WEB');
  clock.advance(900001);
  const unlocked = await login();
  const beforePassword = await auditSequence();
  const changed = await request(server)
    .post('/api/v1/auth/password')
    .set('Authorization', `Bearer ${unlocked.accessToken}`)
    .send({ currentPassword: password, newPassword: 'New-synthetic-password-013!' });
  expect(changed.status).toBe(204);
  await expectAudit(beforePassword, 'AUTH_PASSWORD_CHANGED', true);
  const logs = JSON.stringify(await rows('SELECT * FROM audit_logs'));
  for (const value of [
    password,
    'Wrong-password-013!',
    pair.accessToken,
    pair.refreshToken,
    unlocked.accessToken,
    unlocked.refreshToken,
    'New-synthetic-password-013!',
    passwordHash,
  ])
    expect(logs).not.toContain(value);
});
