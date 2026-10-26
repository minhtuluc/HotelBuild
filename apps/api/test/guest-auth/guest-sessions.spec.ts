import { test, expect } from 'vitest';
import { errorBodySchema } from '@pinehill/contracts';
import {
  http,
  clock,
  password,
  phone,
  legacyPhone,
  login,
  loginRequest,
  refresh,
  pair,
  error,
  rows,
  clearAttempts,
} from './guest-oracle.fixture.js';
import {
  seedGuest,
  guestSession,
  assertPrincipal,
  assertAccessToken,
  credentials,
  profile,
  underCredentialLocks,
  underSessionLocks,
} from './guest-data.js';

// HB-017, QĐ-03 §1.2/3, T2/T4/T10: shared staff/guest auth protections, separate guest identity.
for (const surface of [undefined, 'GUEST_WEB', 'GUEST_ANDROID'])
  test(`guest login uses ${surface ?? 'default GUEST_WEB'} and keeps seven-day lifetime`, async () => {
    const id = await seedGuest(),
      tokens = await login(phone, surface);
    await assertPrincipal(tokens, id, surface ?? 'GUEST_WEB');
  });
test('blacklisted guest can authenticate without clearing the blacklist', async () => {
  const id = await seedGuest(true, { blacklisted: true });
  await assertPrincipal(await login(), id);
  expect((await profile())!.blacklisted).toBe(true);
});
test('local/international phone forms authenticate the same guest', async () => {
  const id = await seedGuest();
  await assertPrincipal(await login(legacyPhone), id);
});
for (const surface of ['GUEST_WEB', 'GUEST_ANDROID'])
  test(`${surface} survives 15 minutes idle but refresh expires at exactly seven days`, async () => {
    await seedGuest();
    const first = await login(phone, surface),
      original = await guestSession(first.refreshToken);
    clock.value += 900001;
    const response = await refresh(first.refreshToken);
    expect(response.status).toBe(200);
    const second = pair(response.body);
    const rotated = await guestSession(second.refreshToken);
    expect(rotated.expires_at).toEqual(original.expires_at);
    await assertAccessToken(second.accessToken, String(rotated.id));
    clock.value = Number(new Date(String(original.expires_at))) - 1;
    const almost = await refresh(second.refreshToken);
    expect(almost.status).toBe(200);
    clock.value += 1;
    error(await refresh(pair(almost.body).refreshToken), 401, 'E_AUTH_INVALID_CREDENTIALS');
  });
test('refresh rotates and replay revokes the complete family, while a separate login survives', async () => {
  const id = await seedGuest();
  const first = await login(),
    independent = await login();
  const original = await guestSession(first.refreshToken);
  const response = await refresh(first.refreshToken);
  expect(response.status).toBe(200);
  const second = pair(response.body),
    next = await guestSession(second.refreshToken);
  expect(second.refreshToken === first.refreshToken).toBe(false);
  expect(next.family_id).toBe(original.family_id);
  await assertAccessToken(second.accessToken, String(next.id));
  expect((await guestSession(first.refreshToken)).rotated_at).not.toBeNull();
  error(await refresh(first.refreshToken), 401, 'E_AUTH_INVALID_CREDENTIALS');
  error(await refresh(second.refreshToken), 401, 'E_AUTH_INVALID_CREDENTIALS');
  const family = await rows('SELECT guest_id,revoked_at FROM auth_sessions WHERE family_id=$1', [
    original.family_id,
  ]);
  expect(family).toHaveLength(2);
  expect(family.every((r) => r.guest_id === id && r.revoked_at !== null)).toBe(true);
  expect((await refresh(independent.refreshToken)).status).toBe(200);
});
test('concurrent refresh of one guest token has one winner then revokes its family on reuse', async () => {
  await seedGuest();
  const first = await login();
  const current = await guestSession(first.refreshToken);
  const responses = await underSessionLocks(String(current.id), () => [
    Promise.resolve(refresh(first.refreshToken)),
    Promise.resolve(refresh(first.refreshToken)),
  ]);
  expect(responses.map((r) => r.status).sort()).toEqual([200, 401]);
  error(
    await refresh(pair(responses.find((r) => r.status === 200)!.body).refreshToken),
    401,
    'E_AUTH_INVALID_CREDENTIALS',
  );
});
test('guest token cannot call existing staff-only endpoints', async () => {
  await seedGuest();
  const tokens = await login();
  for (const route of ['/auth/me', '/rate-plans/admin', '/cancellation-policies']) {
    const response = await http()
      .get('/api/v1' + route)
      .set('Authorization', `Bearer ${tokens.accessToken}`);
    expect([403, 404]).toContain(response.status);
  }
});
test('staff and guest refresh tokens cannot cross principal endpoints', async () => {
  const staffResponse = await http()
    .post('/api/v1/auth/login')
    .send({ username: 'h017-staff', password });
  expect(staffResponse.status).toBe(200);
  const staff = pair(staffResponse.body);
  error(await refresh(staff.refreshToken), 401, 'E_AUTH_INVALID_CREDENTIALS');
  await seedGuest();
  const guest = await login();
  error(
    await http().post('/api/v1/auth/refresh').send({ refreshToken: guest.refreshToken }),
    401,
    'E_AUTH_INVALID_CREDENTIALS',
  );
  expect(
    (await http().post('/api/v1/auth/refresh').send({ refreshToken: staff.refreshToken })).status,
  ).toBe(200);
  expect((await refresh(guest.refreshToken)).status).toBe(200);
});
test('revoked or forged refresh tokens cannot create guest sessions', async () => {
  await seedGuest();
  const tokens = await login();
  const session = await guestSession(tokens.refreshToken);
  await rows('UPDATE auth_sessions SET revoked_at=$2 WHERE id=$1', [session.id, clock.now()]);
  const before = Number((await rows('SELECT count(*) AS n FROM auth_sessions'))[0]!.n);
  error(await refresh(tokens.refreshToken), 401, 'E_AUTH_INVALID_CREDENTIALS');
  error(await refresh('synthetic-forged-refresh-token-017'), 401, 'E_AUTH_INVALID_CREDENTIALS');
  expect(Number((await rows('SELECT count(*) AS n FROM auth_sessions'))[0]!.n)).toBe(before);
});
for (const known of [true, false])
  test(`${known ? 'known' : 'unknown'} guest locks on fifth wrong password and unlocks at15 minutes`, async () => {
    const id = known ? await seedGuest() : undefined;
    for (let i = 0; i < 4; i++)
      error(
        await loginRequest(i % 2 ? legacyPhone : phone, 'Synthetic wrong password!'),
        401,
        'E_AUTH_INVALID_CREDENTIALS',
      );
    error(
      await loginRequest(phone, 'Synthetic wrong password!'),
      401,
      'E_AUTH_INVALID_CREDENTIALS',
    );
    const fifth = error(await loginRequest(legacyPhone), 401, 'E_AUTH_ACCOUNT_LOCKED');
    expect(fifth.retryAfterSeconds).toBe(900);
    error(await loginRequest(legacyPhone), 401, 'E_AUTH_ACCOUNT_LOCKED');
    if (id) {
      const saved = await credentials(id);
      expect(saved!.failed_login_count).toBe(5);
      expect(saved!.locked_until).toEqual(new Date(clock.value + 900000));
    }
    clock.value += 899999;
    error(await loginRequest(), 401, 'E_AUTH_ACCOUNT_LOCKED');
    clock.value += 1;
    if (known) expect((await loginRequest()).status).toBe(200);
    else error(await loginRequest(), 401, 'E_AUTH_INVALID_CREDENTIALS');
  });
test('successful guest login resets consecutive failure counter', async () => {
  const id = await seedGuest();
  for (let i = 0; i < 4; i++)
    error(
      await loginRequest(phone, 'Synthetic wrong password!'),
      401,
      'E_AUTH_INVALID_CREDENTIALS',
    );
  expect((await loginRequest()).status).toBe(200);
  expect((await credentials(id))!.failed_login_count).toBe(0);
  for (let i = 0; i < 4; i++)
    error(
      await loginRequest(phone, 'Synthetic wrong password!'),
      401,
      'E_AUTH_INVALID_CREDENTIALS',
    );
  expect((await credentials(id))!.failed_login_count).toBe(4);
  expect((await credentials(id))!.locked_until).toBeNull();
});
test('concurrent guest failures do not lose increments under the credential lock', async () => {
  const id = await seedGuest();
  const responses = await underCredentialLocks(id, () =>
    Array.from({ length: 5 }, () =>
      Promise.resolve(loginRequest(phone, 'Synthetic wrong password!')),
    ),
  );
  expect(responses.map((r) => r.status)).toEqual([401, 401, 401, 401, 401]);
  expect(responses.map((r) => errorBodySchema.parse(r.body).code).sort()).toEqual([
    'E_AUTH_INVALID_CREDENTIALS',
    'E_AUTH_INVALID_CREDENTIALS',
    'E_AUTH_INVALID_CREDENTIALS',
    'E_AUTH_INVALID_CREDENTIALS',
    'E_AUTH_INVALID_CREDENTIALS',
  ]);
  expect((await credentials(id))!.failed_login_count).toBe(5);
  expect((await credentials(id))!.locked_until).toEqual(new Date(clock.value + 900000));
});
test('IP quota10 is shared by guest/staff login and ignores spoofed forwarded headers', async () => {
  for (let i = 0; i < 10; i++) {
    const value = `+849${String(10000000 + i).padStart(8, '0')}`;
    const command =
      i % 2
        ? http()
            .post('/api/v1/auth/login')
            .send({ username: `h017-missing-${i}`, password })
        : loginRequest(value);
    error(
      await command.set('X-Forwarded-For', `192.0.2.${i + 1}`),
      401,
      'E_AUTH_INVALID_CREDENTIALS',
    );
  }
  const response = await loginRequest('+84999999999').set('X-Forwarded-For', '192.0.2.200');
  const limited = error(response, 429, 'E_GEN_RATE_LIMITED');
  expect(limited.retryAfterSeconds).toBeGreaterThan(0);
  expect(limited.retryAfterSeconds).toBeLessThanOrEqual(60);
  expect(response.headers['retry-after']).toBe(String(limited.retryAfterSeconds));
  clock.value += 60000;
  error(await loginRequest('+84999999999'), 401, 'E_AUTH_INVALID_CREDENTIALS');
});

// Same anti-enumeration timing bounds as the published HB-013 oracle; real Argon2id only.
test('unknown guest error and timing match a real wrong-password hash check', async () => {
  const id = await seedGuest(),
    known: number[] = [],
    missing: number[] = [];
  for (let i = 0; i < 12; i++) {
    await clearAttempts();
    await rows(
      'UPDATE guest_credentials SET failed_login_count=0,locked_until=NULL WHERE guest_id=$1',
      [id],
    );
    const messages: string[] = [];
    for (const kind of i % 2 ? ['missing', 'known'] : ['known', 'missing']) {
      const started = performance.now();
      const response = await loginRequest(
        kind === 'known' ? phone : '+84987654321',
        'Synthetic wrong password!',
      );
      const elapsed = performance.now() - started;
      messages.push(error(response, 401, 'E_AUTH_INVALID_CREDENTIALS').message);
      (kind === 'known' ? known : missing).push(elapsed);
    }
    expect(messages[0]).toBe(messages[1]);
  }
  const median = (values: number[]) =>
    [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)]!;
  const ratio = median(missing) / median(known);
  expect(ratio).toBeGreaterThanOrEqual(0.5);
  expect(ratio).toBeLessThanOrEqual(2);
}, 30000);
