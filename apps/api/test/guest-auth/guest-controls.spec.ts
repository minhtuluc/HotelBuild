import { createHash, randomUUID } from 'node:crypto';
import { expect, test } from 'vitest';
import { SignJWT } from 'jose';
import { AuditWriter } from '../../src/infrastructure/audit/audit-writer.js';
import {
  businessDb,
  clock,
  phone,
  rows,
  pair,
  email,
  legacyPhone,
  accessSecret,
} from './guest-oracle.fixture.js';
import {
  seedGuest,
  profile,
  assertPassword,
  credentials,
  assertPrincipal,
  assertAccessToken,
  assertRegistrationAudit,
  underCredentialLocks,
} from './guest-data.js';

// Control helper correctness only; no reference guest-auth route or fake service is registered.
const tokens = {
  tokenType: 'Bearer' as const,
  accessToken: 'synthetic-hb017-control-access-token',
  refreshToken: 'synthetic-hb017-control-refresh-token',
  expiresInSeconds: 900,
  refreshExpiresInSeconds: 604800,
};
test('profile/Argon2id/session assertions reject wrong guest, surface or lifetime', async () => {
  const id = await seedGuest();
  expect((await profile())!.phone).toBe('+84912345678');
  await assertPassword(id);
  const session = await businessDb().auth_sessions.create({
    data: {
      principal_type: 'GUEST',
      guest_id: id,
      surface: 'GUEST_WEB',
      family_id: id,
      token_hash: createHash('sha256').update(tokens.refreshToken).digest('hex'),
      // ck_auth_sessions_expiry (expires_at > created_at): created_at mặc định là now() thật, nhưng đồng hồ giả của oracle ở 09/10.
      created_at: clock.now(),
      expires_at: new Date(clock.value + 604800000),
    },
  });
  const signed = {
    ...tokens,
    accessToken: await new SignJWT({ sid: session.id })
      .setProtectedHeader({ alg: 'HS256' })
      .setExpirationTime(Math.floor(clock.value / 1000) + 900)
      .sign(new TextEncoder().encode(accessSecret)),
  };
  await assertPrincipal(signed, id);
  await expect(assertAccessToken(tokens.accessToken, session.id)).rejects.toThrow();
  await expect(assertAccessToken(signed.accessToken, randomUUID())).rejects.toThrow();
  clock.value += 900000;
  await expect(assertAccessToken(signed.accessToken, session.id)).rejects.toThrow();
  clock.value -= 900000;
  await expect(assertPrincipal(signed, '00000000-0000-4000-8000-000000000001')).rejects.toThrow();
  await expect(assertPrincipal(signed, id, 'GUEST_ANDROID')).rejects.toThrow();
  await expect(assertPrincipal({ ...signed, refreshExpiresInSeconds: 1 }, id)).rejects.toThrow();
  await expect(assertPrincipal({ ...signed, expiresInSeconds: 1 }, id)).rejects.toThrow();
  const before = (await credentials(id))!.fingerprint;
  await rows('UPDATE guest_credentials SET password_hash=$2 WHERE guest_id=$1', [
    id,
    'synthetic invalid hash',
  ]);
  expect((await credentials(id))!.fingerprint === before).toBe(false);
  await expect(assertPassword(id)).rejects.toThrow();
});
test('registration audit verifies consent and rejects unsafe or incomplete snapshots', async () => {
  const id = await seedGuest(false),
    writer = new AuditWriter(clock);
  const entry = {
    actor: { id: null, role: 'SYSTEM', ip: null, correlationId: 'hb017-helper-control' },
    action: 'HB017_ORACLE_CONTROL',
    entityType: 'Guest',
    entityId: id,
    beforeJson: null,
    afterJson: { consentMarketing: true, consentVersion: 'hb017-v1' },
    reason: 'synthetic helper control',
  };
  for (const afterJson of [
    { consentMarketing: false, consentVersion: 'hb017-v1' },
    { consentMarketing: true, consentVersion: 'wrong-version' },
    { consentVersion: 'hb017-v1' },
    { consentMarketing: true, consent_marketing: false, consentVersion: 'hb017-v1' },
    {
      consentMarketing: true,
      consentVersion: 'hb017-v1',
      passwordHash: 'synthetic forbidden field',
    },
    { consentMarketing: true, consentVersion: 'hb017-v1', memo: phone },
    { consentMarketing: true, consentVersion: 'hb017-v1', memo: legacyPhone },
    { consentMarketing: true, consentVersion: 'hb017-v1', memo: email },
    { consentMarketing: true, consentVersion: 'hb017-v1', memo: tokens.accessToken },
    { consentMarketing: true, consentVersion: 'hb017-v1', memo: tokens.refreshToken },
  ]) {
    const target = randomUUID();
    await businessDb().$transaction((tx) =>
      writer.record(tx, { ...entry, entityId: target, afterJson }),
    );
    await expect(
      assertRegistrationAudit(target, true, [tokens.accessToken, tokens.refreshToken]),
    ).rejects.toThrow();
  }
  for (const afterJson of [
    entry.afterJson,
    { consent_marketing: true, consent_version: 'hb017-v1' },
  ]) {
    await businessDb().$transaction((tx) => writer.record(tx, { ...entry, afterJson }));
    await assertRegistrationAudit(id, true);
  }
});
test('credential barrier observes two runtime DB transactions and releases them', async () => {
  const id = await seedGuest();
  await expect(
    underCredentialLocks(id, () => [Promise.resolve(1), Promise.resolve(2)]),
  ).rejects.toThrow('without reaching DB lock barrier');
  const results = await underCredentialLocks(id, () => [
    businessDb().guest_credentials.update({
      where: { guest_id: id },
      data: { failed_login_count: { increment: 1 } },
    }),
    businessDb().guest_credentials.update({
      where: { guest_id: id },
      data: { failed_login_count: { increment: 1 } },
    }),
  ]);
  expect(results).toHaveLength(2);
  expect((await credentials(id))!.failed_login_count).toBe(2);
});
test('raw response check rejects secrets even when client decoder would discard the field', () => {
  expect(pair(tokens).tokenType).toBe('Bearer');
  expect(() => pair({ ...tokens, passwordHash: 'synthetic forbidden field' })).toThrow();
});
