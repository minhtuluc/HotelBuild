import { randomBytes } from 'node:crypto';
import { test, expect } from 'vitest';
import {
  http,
  requestReset,
  confirm,
  newPassword,
  password,
  phone,
  loginRequest,
  clock,
  error,
  rows,
  businessDb,
} from './reset-oracle.fixture.js';
import { tokenFromMail } from './reset-mail.js';
import {
  seed,
  seedSession,
  digest,
  snapshot,
  passwordMatches,
  privacy,
  savedReset,
  concurrentConfirm,
} from './reset-data.js';
async function issue(id: string) {
  expect((await requestReset()).status).toBe(202);
  const value = await tokenFromMail();
  const reset = await savedReset(value.token, id);
  return { ...value, resetId: String(reset.id) };
}
test('reset204 consumes token, changes Argon2id password, revokes all guest families and permits only new password', async () => {
  const id = await seed();
  const web = await seedSession(id, 'GUEST_WEB'),
    android = await seedSession(id, 'GUEST_ANDROID'),
    rotated = await seedSession(id, 'GUEST_WEB', true);
  await businessDb().auth_sessions.create({
    data: {
      guest_id: id,
      principal_type: 'GUEST',
      surface: 'GUEST_WEB',
      family_id: rotated.family_id,
      token_hash: digest(randomBytes(32).toString('hex')),
      created_at: clock.now(),
      expires_at: rotated.expires_at,
    },
  });
  const other = await seed(true, null, '+84911111111'),
    otherSession = await seedSession(other, 'GUEST_WEB');
  const otherBefore = await snapshot(other);
  const staff = await http().post('/api/v1/auth/login').send({ username: 'h028-staff', password });
  expect(staff.status).toBe(200);
  const before = await rows("SELECT id,revoked_at FROM auth_sessions WHERE principal_type='USER'");
  const issued = await issue(id);
  expect((await confirm(issued.token)).status).toBe(204);
  const reset = await rows('SELECT consumed_at FROM guest_password_resets WHERE id=$1', [
    issued.resetId,
  ]);
  expect(reset[0]!.consumed_at).toEqual(clock.now());
  await passwordMatches(id);
  expect(await snapshot(other)).toEqual(otherBefore);
  const sessions = await rows('SELECT id,revoked_at FROM auth_sessions WHERE guest_id=$1', [id]);
  expect(sessions).toHaveLength(4);
  expect(sessions.every((value) => value.revoked_at !== null)).toBe(true);
  expect(sessions.some((value) => value.id === web.id)).toBe(true);
  expect(sessions.some((value) => value.id === android.id)).toBe(true);
  expect(
    (await rows('SELECT revoked_at FROM auth_sessions WHERE id=$1', [otherSession.id]))[0]!
      .revoked_at,
  ).toBeNull();
  expect(await rows("SELECT id,revoked_at FROM auth_sessions WHERE principal_type='USER'")).toEqual(
    before,
  );
  error(await loginRequest(phone, password), 401, 'E_AUTH_INVALID_CREDENTIALS');
  expect((await loginRequest(phone, newPassword)).status).toBe(200);
  error(await confirm(issued.token), 400, 'E_AUTH_RESET_TOKEN_INVALID');
  await privacy([issued.token, issued.link]);
});
for (const kind of ['forged', 'tampered', 'expired', 'consumed'])
  test(`${kind} token400 leaves password and sessions unchanged`, async () => {
    const id = await seed();
    await seedSession(id, 'GUEST_ANDROID');
    const issued = await issue(id);
    if (kind === 'expired') clock.value += 1800000;
    if (kind === 'consumed')
      await rows('UPDATE guest_password_resets SET consumed_at=$2 WHERE id=$1', [
        issued.resetId,
        clock.now(),
      ]);
    const before = await snapshot(id);
    const token =
      kind === 'forged'
        ? randomBytes(32).toString('hex')
        : kind === 'tampered'
          ? (issued.token[0] === 'a' ? 'b' : 'a') + issued.token.slice(1)
          : issued.token;
    error(await confirm(token), 400, 'E_AUTH_RESET_TOKEN_INVALID');
    expect(await snapshot(id)).toEqual(before);
    await privacy([token, issued.token, issued.link]);
  });
for (const [elapsed, status] of [
  [1799999, 204],
  [1800000, 400],
] as const)
  test(`token expiry boundary${elapsed}ms yields${status}`, async () => {
    const id = await seed(),
      issued = await issue(id);
    clock.value += elapsed;
    const response = await confirm(issued.token);
    expect(response.status).toBe(status);
    if (status === 400) error(response, 400, 'E_AUTH_RESET_TOKEN_INVALID');
  });
test('concurrent confirm of the same token has one204 and one invalid400', async () => {
  const id = await seed(),
    issued = await issue(id);
  const reset = await savedReset(issued.token, id);
  const responses = await concurrentConfirm(String(reset.id), () => [
    Promise.resolve(confirm(issued.token, newPassword)),
    Promise.resolve(confirm(issued.token, 'Other-synthetic-HB028-password!')),
  ]);
  expect(responses.map((value) => value.status).sort()).toEqual([204, 400]);
  error(
    responses.find((value) => value.status === 400)!,
    400,
    'E_AUTH_RESET_TOKEN_INVALID',
  );
  const winner = responses[0]!.status === 204 ? newPassword : 'Other-synthetic-HB028-password!';
  await passwordMatches(id, winner);
  error(await confirm(issued.token), 400, 'E_AUTH_RESET_TOKEN_INVALID');
  await privacy([issued.token, issued.link, 'Other-synthetic-HB028-password!']);
});
for (const invalid of ['short', 'x'.repeat(129)])
  test(`invalid new password length${invalid.length} cannot consume valid token`, async () => {
    const id = await seed(),
      issued = await issue(id),
      before = await snapshot(id);
    error(await confirm(issued.token, invalid), 400, 'E_GEN_VALIDATION_FAILED');
    expect(await snapshot(id)).toEqual(before);
    expect((await confirm(issued.token)).status).toBe(204);
  });
test('confirm ignores no injected identity/role: strict schema rejects account takeover fields', async () => {
  const id = await seed(),
    issued = await issue(id),
    before = await snapshot(id);
  error(
    await http().post('/api/v1/guest-auth/password-reset/confirm').send({
      token: issued.token,
      newPassword,
      guestId: '00000000-0000-4000-8000-000000000001',
      role: 'OWNER',
    }),
    400,
    'E_GEN_VALIDATION_FAILED',
  );
  expect(await snapshot(id)).toEqual(before);
});
for (const table of ['guest_credentials', 'auth_sessions', 'audit_logs'])
  test(`${table} write failure rolls back password, token consumption and all revocations`, async () => {
    const id = await seed();
    await seedSession(id, 'GUEST_WEB');
    await seedSession(id, 'GUEST_ANDROID');
    const issued = await issue(id),
      before = await snapshot(id);
    const predicate = table === 'auth_sessions' ? 'revoked_at IS NULL' : 'false';
    await rows(`ALTER TABLE ${table} ADD CONSTRAINT hb028_fault CHECK(${predicate}) NOT VALID`);
    try {
      expect((await confirm(issued.token)).status).toBe(500);
      expect(await snapshot(id)).toEqual(before);
    } finally {
      await rows(`ALTER TABLE ${table} DROP CONSTRAINT hb028_fault`);
    }
    expect((await confirm(issued.token)).status).toBe(204);
    await passwordMatches(id);
  });
