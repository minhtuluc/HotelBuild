import { test, expect } from 'vitest';
import { z } from 'zod';
import { loadConfig } from '../../src/config/env.js';
import { smtpUrl, guestBase } from './reset-mail.js';
import { http, requestReset, phone, rows, error, clock } from './reset-oracle.fixture.js';
import { email, mailCount, tokenFromMail, resetMail, stopSmtp, logs } from './reset-mail.js';
import {
  seed,
  seedSession,
  savedReset,
  snapshot,
  privacy,
  auditCount,
  beforeCommit,
  assertDeliveryFailure,
  isDeliveryFailure,
} from './reset-data.js';

// HB028/QĐ03 T7: public requests cannot reveal whether a guest account/email exists.
test('known credential/email receives202 and exactly one configured reset link with hash-only storage', async () => {
  const id = await seed();
  const response = await requestReset();
  expect(response.status).toBe(202);
  const issued = await tokenFromMail();
  await savedReset(issued.token, id);
  expect(JSON.stringify(response.body).includes(issued.token)).toBe(false);
  expect(await mailCount()).toBe(1);
  await privacy([issued.token, issued.link]);
});
for (const kind of ['unknown', 'no-email', 'no-credential'])
  test(`${kind} returns the same202 body as a known account and sends no mail`, async () => {
    await seed();
    const known = await requestReset();
    expect(known.status).toBe(202);
    await tokenFromMail();
    await resetMail();
    const target = '+84911111111';
    const id =
      kind === 'unknown'
        ? undefined
        : await seed(kind !== 'no-credential', kind === 'no-email' ? null : email, target);
    const response = await requestReset(target);
    expect(response.status).toBe(202);
    expect(response.body).toEqual(known.body);
    expect(await mailCount()).toBe(0);
    if (id)
      expect(
        await rows('SELECT id FROM guest_password_resets WHERE guest_id=$1', [id]),
      ).toHaveLength(0);
    await privacy([target]);
  });
for (const value of ['12345', '+14155552671', '+849123456789', '09123x5678'])
  test(`invalid phone length${value.length}422 leaves no reset/mail`, async () => {
    await seed();
    error(await requestReset(value), 422, 'E_CRM_PHONE_INVALID');
    expect(await mailCount()).toBe(0);
    expect(await rows('SELECT id FROM guest_password_resets')).toHaveLength(0);
  });
test('request rejects forged recipient/guest identity instead of sending to attacker email', async () => {
  await seed();
  error(
    await http().post('/api/v1/guest-auth/password-reset/request').send({
      phone,
      email: 'attacker@example.invalid',
      guestId: '00000000-0000-4000-8000-000000000001',
    }),
    400,
    'E_GEN_VALIDATION_FAILED',
  );
  expect(await mailCount()).toBe(0);
  expect(await rows('SELECT id FROM guest_password_resets')).toHaveLength(0);
});
for (const kind of ['known', 'unknown', 'no-email'])
  test(`three requests/hour apply to ${kind}, fourth429, another phone independent`, async () => {
    if (kind !== 'unknown') await seed(true, kind === 'no-email' ? null : email);
    const tokens: string[] = [];
    for (let i = 0; i < 3; i++) {
      expect((await requestReset()).status).toBe(202);
      if (kind === 'known') {
        tokens.push((await tokenFromMail()).token);
        await resetMail();
      }
    }
    if (kind === 'known') expect(new Set(tokens).size).toBe(3);
    const limited = await requestReset();
    const result = error(limited, 429, 'E_GEN_RATE_LIMITED');
    expect(result.retryAfterSeconds).toBeGreaterThan(0);
    expect(result.retryAfterSeconds).toBeLessThanOrEqual(3600);
    expect(limited.headers['retry-after']).toBe(String(result.retryAfterSeconds));
    expect((await requestReset('+84922222222')).status).toBe(202);
    expect(await mailCount()).toBe(0);
    clock.value += 3600001;
    expect((await requestReset()).status).toBe(202);
    if (kind === 'known') {
      const issued = await tokenFromMail();
      tokens.push(issued.token, issued.link);
    }
    await privacy([...tokens, '+84922222222']);
  });
test('request cannot alter existing guest credential or active sessions', async () => {
  const id = await seed();
  await seedSession(id, 'GUEST_WEB');
  await seedSession(id, 'GUEST_ANDROID');
  const before = await snapshot(id);
  expect((await requestReset()).status).toBe(202);
  const after = await snapshot(id);
  expect(after.credential).toEqual(before.credential);
  expect(after.sessions).toEqual(before.sessions);
});
test('SMTP remains empty while token creation is held before commit', async () => {
  const id = await seed();
  const response = await beforeCommit(
    () => Promise.resolve(requestReset()),
    async () => {
      expect(await mailCount()).toBe(0);
    },
  );
  expect(response.status).toBe(202);
  const issued = await tokenFromMail();
  await savedReset(issued.token, id);
});
for (const table of ['guest_password_resets', 'audit_logs'])
  test(`${table} insert failure sends no email and commits no reset`, async () => {
    await seed();
    const audits = await auditCount();
    await rows(`ALTER TABLE ${table} ADD CONSTRAINT hb028_fault CHECK(false) NOT VALID`);
    try {
      expect((await requestReset()).status).toBe(500);
      expect(await rows('SELECT id FROM guest_password_resets')).toHaveLength(0);
      expect(await auditCount()).toBe(audits);
      expect(await mailCount()).toBe(0);
    } finally {
      await rows(`ALTER TABLE ${table} DROP CONSTRAINT hb028_fault`);
    }
  });
test('real SMTP refusal keeps202 and committed token, with failure log and durable audit', async () => {
  const id = await seed(),
    before = await auditCount();
  stopSmtp();
  const response = await requestReset();
  expect(response.status).toBe(202);
  expect(await rows('SELECT id FROM guest_password_resets WHERE guest_id=$1', [id])).toHaveLength(
    1,
  );
  const audit = await rows(
    'SELECT after_json,action,reason FROM audit_logs ORDER BY chain_seq DESC LIMIT 1',
  );
  expect(await auditCount()).toBeGreaterThan(before);
  // Failure must be observable independently of the generic HTTP202 access log; event names are internal.
  expect(audit).toHaveLength(1);
  assertDeliveryFailure(audit[0]);
  const entries = logs()
    .split('\n')
    .filter(Boolean)
    .map((line) => z.object({ level: z.number() }).passthrough().parse(JSON.parse(line)));
  const failures = entries.filter((entry) => entry.level >= 40);
  expect(failures.length).toBeGreaterThan(0);
  expect(failures.some(isDeliveryFailure)).toBe(true);
  await privacy();
}, 30000);

test('production config parser preserves SMTP_URL and configured guest web base', () => {
  const config = loadConfig({
    DATABASE_URL: 'postgres://synthetic@127.0.0.1/hb028',
    REDIS_URL: 'redis://127.0.0.1:6379/6',
    JWT_ACCESS_SECRET: 'synthetic-hb028-config',
    JWT_REFRESH_SECRET: 'synthetic-hb028-config',
    BUSINESS_TIMEZONE: 'Asia/Ho_Chi_Minh',
    PORT: '3000',
    SMTP_URL: smtpUrl,
    GUEST_WEB_BASE_URL: guestBase,
  });
  expect(Reflect.get(config, 'SMTP_URL') === smtpUrl).toBe(true);
  expect(Reflect.get(config, 'GUEST_WEB_BASE_URL') === guestBase).toBe(true);
});
