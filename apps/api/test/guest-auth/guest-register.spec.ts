import { test, expect } from 'vitest';
import { tokenPairSchema, userMeSchema } from '@pinehill/contracts';
import {
  http,
  clock,
  password,
  phone,
  legacyPhone,
  register,
  registerBody,
  pair,
  error,
  rows,
} from './guest-oracle.fixture.js';
import {
  profile,
  credentials,
  assertPrincipal,
  assertPassword,
  seedGuest,
  totals,
  assertRegistrationAudit,
} from './guest-data.js';

// HB-017/QĐ-03 T11: no OTP means no claiming an existing profile, even with exact phone/name/email.
test('control: real health and staff auth work before exercising missing guest endpoints', async () => {
  expect((await http().get('/api/v1/system/health')).status).toBe(200);
  const response = await http()
    .post('/api/v1/auth/login')
    .send({ username: 'h017-staff', password });
  expect(response.status).toBe(200);
  const staff = tokenPairSchema.parse(response.body);
  const me = await http()
    .get('/api/v1/auth/me')
    .set('Authorization', `Bearer ${staff.accessToken}`);
  expect(me.status).toBe(200);
  expect(userMeSchema.parse(me.body).username).toBe('h017-staff');
});
for (const input of [phone, legacyPhone])
  test(`register normalizes ${input.startsWith('+') ? 'international' : 'local'} phone to one canonical identity`, async () => {
    const response = await register(registerBody({ phone: input }));
    expect(response.status).toBe(201);
    const guest = await profile();
    expect(guest).toBeDefined();
    expect(guest!.phone).toBe('+84912345678');
    expect(await rows('SELECT id FROM guests')).toHaveLength(1);
    await assertPassword(String(guest!.id));
    const tokens = pair(response.body);
    await assertPrincipal(tokens, String(guest!.id));
    await assertRegistrationAudit(String(guest!.id), true, [
      tokens.accessToken,
      tokens.refreshToken,
    ]);
  });
for (const consent of [true, false])
  test(`registration persists consent ${consent}, its version/time, and a real safe audit snapshot`, async () => {
    const response = await register(registerBody({ consentMarketing: consent }));
    expect(response.status).toBe(201);
    const guest = await profile();
    expect(guest!.consent_marketing).toBe(consent);
    expect(guest!.consent_at).toEqual(clock.now());
    expect(guest!.consent_version).toBe('hb017-v1');
    const tokens = pair(response.body);
    await assertRegistrationAudit(String(guest!.id), consent, [
      tokens.accessToken,
      tokens.refreshToken,
    ]);
  });
for (const surface of ['GUEST_WEB', 'GUEST_ANDROID'])
  test(`registration uses the requested ${surface} and guest-only principal`, async () => {
    const response = await register(registerBody({ clientSurface: surface }));
    expect(response.status).toBe(201);
    const guest = await profile();
    await assertPrincipal(pair(response.body), String(guest!.id), surface);
  });
for (const invalid of ['', '12345', '+14155552671', '+849123456789', '091234567x'])
  test(`malformed phone sample ${invalid.length} is 422 and creates no profile, credential or session`, async () => {
    const before = await totals();
    error(await register(registerBody({ phone: invalid })), 422, 'E_CRM_PHONE_INVALID');
    expect(await totals()).toEqual(before);
  });
test('registration cannot mass-assign privilege, loyalty, blacklist or password hash', async () => {
  const before = await totals();
  error(
    await register(
      registerBody({
        role: 'OWNER',
        loyaltyPoints: 99999,
        blacklisted: false,
        passwordHash: 'synthetic forbidden field',
      }),
    ),
    400,
    'E_GEN_VALIDATION_FAILED',
  );
  expect(await totals()).toEqual(before);
});
test('pre-existing guest without credentials cannot be claimed or overwritten', async () => {
  const id = await seedGuest(false, { blacklisted: true }),
    before = await profile();
  error(
    await register(
      registerBody({
        fullName: 'Synthetic takeover attempt',
        email: 'other@example.invalid',
        consentMarketing: false,
      }),
    ),
    409,
    'E_AUTH_PHONE_REGISTERED',
  );
  expect(await profile()).toEqual(before);
  expect(await credentials(id)).toBeUndefined();
  expect(await rows("SELECT id FROM auth_sessions WHERE principal_type='GUEST'")).toHaveLength(0);
});
test('existing account keeps profile and credential after normalized duplicate registration', async () => {
  const id = await seedGuest(),
    before = await profile(),
    credential = await credentials(id);
  error(
    await register(registerBody({ phone: legacyPhone, fullName: 'Synthetic takeover attempt' })),
    409,
    'E_AUTH_PHONE_REGISTERED',
  );
  expect(await profile()).toEqual(before);
  expect(await credentials(id)).toEqual(credential);
  expect(await rows("SELECT id FROM auth_sessions WHERE principal_type='GUEST'")).toHaveLength(0);
});
test('concurrent canonical/local registrations yield one identity, credential and session', async () => {
  const results = await Promise.all([
    register(registerBody()),
    register(registerBody({ phone: legacyPhone })),
  ]);
  expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
  error(
    results.find((r) => r.status === 409)!,
    409,
    'E_AUTH_PHONE_REGISTERED',
  );
  const guest = await profile();
  expect(await rows('SELECT id FROM guests')).toHaveLength(1);
  expect(await rows('SELECT guest_id FROM guest_credentials')).toHaveLength(1);
  expect(await rows("SELECT id FROM auth_sessions WHERE principal_type='GUEST'")).toHaveLength(1);
  await assertPassword(String(guest!.id));
  const tokens = pair(results.find((r) => r.status === 201)!.body);
  await assertRegistrationAudit(String(guest!.id), true, [tokens.accessToken, tokens.refreshToken]);
});
for (const table of ['guest_credentials', 'auth_sessions', 'audit_logs'])
  test(`${table} insert failure rolls back registration as one transaction`, async () => {
    const before = await totals();
    const predicate =
      table === 'audit_logs'
        ? 'false'
        : table === 'auth_sessions'
          ? "principal_type <> 'GUEST'"
          : 'false';
    await rows(`ALTER TABLE ${table} ADD CONSTRAINT hb017_fault CHECK(${predicate}) NOT VALID`);
    try {
      expect((await register()).status).toBe(500);
      expect(await totals()).toEqual(before);
      expect(await profile()).toBeUndefined();
    } finally {
      await rows(`ALTER TABLE ${table} DROP CONSTRAINT hb017_fault`);
    }
  });
