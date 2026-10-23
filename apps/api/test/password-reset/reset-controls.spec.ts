import { randomBytes } from 'node:crypto';
import { test, expect } from 'vitest';
import { tokenPairSchema } from '@pinehill/contracts';
import { http, password, clock, rows, businessDb } from './reset-oracle.fixture.js';
import {
  mailCount,
  sendControlMail,
  tokenFromMail,
  tokenFromText,
  guestBase,
  logs,
  email,
  stopSmtp,
  resetMail,
} from './reset-mail.js';
import {
  seed,
  seedReset,
  savedReset,
  digest,
  assertPrivate,
  beforeCommit,
  concurrentConfirm,
  assertDeliveryFailure,
  isDeliveryFailure,
} from './reset-data.js';

test('control: real health/staff HTTP succeeds and production Pino logs are captured', async () => {
  expect((await http().get('/api/v1/system/health')).status).toBe(200);
  const response = await http()
    .post('/api/v1/auth/login')
    .send({ username: 'h028-staff', password });
  expect(response.status).toBe(200);
  const tokens = tokenPairSchema.parse(response.body);
  expect(
    (await http().get('/api/v1/auth/me').set('Authorization', `Bearer ${tokens.accessToken}`))
      .status,
  ).toBe(200);
  expect(logs().includes('request completed')).toBe(true);
  assertPrivate(logs(), [tokens.accessToken, tokens.refreshToken]);
});
test('control: dedicated Mailpit accepts real SMTP and link helper rejects wrong host/entropy', async () => {
  const token = randomBytes(32).toString('base64url');
  await sendControlMail(`${guestBase}/reset?token=${token}`);
  expect(await mailCount()).toBe(1);
  expect((await tokenFromMail()).token === token).toBe(true);
  expect(() => tokenFromText(`https://wrong.example.invalid/reset?token=${token}`)).toThrow();
  expect(() => tokenFromText(`${guestBase}/reset?token=short`)).toThrow();
  expect(() => tokenFromText('synthetic message without link')).toThrow();
});
test('control: DB reset assertion rejects wrong identity/expiry/consumption/plaintext persistence', async () => {
  const id = await seed(),
    token = randomBytes(32).toString('hex');
  await seedReset(id, token);
  await savedReset(token, id);
  await expect(savedReset(token, '00000000-0000-4000-8000-000000000001')).rejects.toThrow();
  await rows('UPDATE guest_password_resets SET expires_at=$2 WHERE token_hash=$1', [
    digest(token),
    new Date(clock.value + 1799000),
  ]);
  await expect(savedReset(token, id)).rejects.toThrow();
  await rows('UPDATE guest_password_resets SET expires_at=$2,consumed_at=$3 WHERE token_hash=$1', [
    digest(token),
    new Date(clock.value + 1800000),
    clock.now(),
  ]);
  await expect(savedReset(token, id)).rejects.toThrow();
  await rows(
    'UPDATE guest_password_resets SET token_hash=$2,consumed_at=NULL WHERE token_hash=$1',
    [digest(token), token],
  );
  await expect(savedReset(token, id)).rejects.toThrow();
  for (const stored of [
    '',
    Buffer.from(token).toString('hex'),
    Buffer.from(token).toString('base64'),
  ]) {
    await rows('UPDATE guest_password_resets SET token_hash=$2 WHERE guest_id=$1', [id, stored]);
    await expect(savedReset(token, id)).rejects.toThrow();
  }
});
test('control: log/audit privacy detects token/password/email in arbitrary fields', () => {
  assertPrivate('synthetic safe log');
  const sensitiveValues: readonly string[] = [
    email,
    password,
    'synthetic-control-token',
    'passwordHash',
    'token_hash',
  ];
  for (const sensitive of sensitiveValues)
    expect(() =>
      assertPrivate(JSON.stringify({ memo: sensitive }), ['synthetic-control-token']),
    ).toThrow();
});
test('control: commit barrier holds a real runtime INSERT and rejects no-wait operations', async () => {
  const id = await seed(),
    token = randomBytes(32).toString('hex');
  await expect(
    beforeCommit(
      () => Promise.resolve(1),
      async () => {},
    ),
  ).rejects.toThrow('before commit barrier');
  await beforeCommit(
    () => seedReset(id, token),
    async () => {
      expect(await mailCount()).toBe(0);
    },
  );
  await savedReset(token, id);
});

test('control: confirm barrier requires two actual DB waiters; failure evidence rejects success-only mail events', async () => {
  const id = await seed(),
    token = randomBytes(32).toString('hex');
  const reset = await seedReset(id, token);
  await expect(
    concurrentConfirm(reset.id, () => [Promise.resolve(1), Promise.resolve(2)]),
  ).rejects.toThrow('before two DB locks');
  await concurrentConfirm(reset.id, () => [rowsOnRuntime(reset.id), rowsOnRuntime(reset.id)]);
  for (const error of [undefined, null, false, '', {}, { code: null }])
    expect(() => assertDeliveryFailure({ action: 'EMAIL_SENT', success: true, error })).toThrow();
  expect(
    [
      { action: 'EMAIL_SENT', success: true },
      { action: 'OTHER_FAILED', error: 'unrelated' },
    ].some(isDeliveryFailure),
  ).toBe(false);
  assertDeliveryFailure({ action: 'EMAIL_FAILED', error: 'ECONNREFUSED' });
});
async function rowsOnRuntime(id: string) {
  return businessDb().guest_password_resets.update({
    where: { id },
    data: { consumed_at: clock.now() },
  });
}

test('control: deferred commit barrier detects SMTP sent inside the transaction callback', async () => {
  const id = await seed(),
    token = randomBytes(32).toString('hex');
  await expect(
    beforeCommit(
      () =>
        businessDb().$transaction(async (tx) => {
          await tx.guest_password_resets.create({
            data: {
              guest_id: id,
              token_hash: digest(token),
              created_at: clock.now(),
              expires_at: new Date(clock.value + 1800000),
            },
          });
          await sendControlMail(`${guestBase}/reset/${token}`);
        }),
      async () => {
        if ((await mailCount()) !== 0) throw new Error('HB028 early SMTP detected at COMMIT');
      },
    ),
  ).rejects.toThrow('HB028 early SMTP detected at COMMIT');
  expect(await mailCount()).toBe(1);
  // Barrier cleanup releases COMMIT even when the independent SMTP inspection detects a violation.
  expect((await rows('SELECT id FROM guest_password_resets')).length).toBe(1);
});

test('control: SMTP421 refusal restores real delivery without restarting Mailpit', async () => {
  stopSmtp();
  await expect(sendControlMail('synthetic refused message')).rejects.toThrow();
  expect(await mailCount()).toBe(0);
  await resetMail();
  await sendControlMail('synthetic restored message');
  expect(await mailCount()).toBe(1);
});
