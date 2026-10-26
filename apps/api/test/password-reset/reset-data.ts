import { randomUUID, createHash } from 'node:crypto';
import { hash, verify } from '@node-rs/argon2';
import { expect } from 'vitest';
import {
  businessDb,
  rows,
  clock,
  password,
  newPassword,
  phone,
  legacyPhone,
  role,
} from './reset-oracle.fixture.js';
import { email, logs } from './reset-mail.js';
export const digest = (token: string) => createHash('sha256').update(token).digest('hex');
export async function seed(withCredential = true, address: string | null = email, number = phone) {
  const guest = await businessDb().guests.create({
    data: { phone: number, full_name: 'Synthetic HB028', email: address },
  });
  if (withCredential)
    await businessDb().guest_credentials.create({
      data: {
        guest_id: guest.id,
        password_hash: await hash(password, { memoryCost: 19456, timeCost: 2, parallelism: 1 }),
      },
    });
  return guest.id;
}
export async function seedSession(
  guestId: string,
  surface: 'GUEST_WEB' | 'GUEST_ANDROID',
  rotated = false,
) {
  return businessDb().auth_sessions.create({
    data: {
      guest_id: guestId,
      principal_type: 'GUEST',
      surface,
      family_id: randomUUID(),
      token_hash: digest(randomUUID()),
      // ck_auth_sessions_expiry (expires_at > created_at): đồng hồ giả của oracle ở 09/10, now() mặc định của DB thì không.
      created_at: clock.now(),
      expires_at: new Date(clock.value + 604800000),
      ...(rotated ? { rotated_at: clock.now() } : {}),
    },
  });
}
export async function seedReset(
  guestId: string,
  token: string,
  expires = clock.value + 1800000,
  consumed = false,
) {
  return businessDb().guest_password_resets.create({
    data: {
      guest_id: guestId,
      token_hash: digest(token),
      created_at: new Date(expires - 1800000),
      expires_at: new Date(expires),
      ...(consumed ? { consumed_at: clock.now() } : {}),
    },
  });
}
export async function savedReset(token: string, guestId: string) {
  const saved = await rows(
    'SELECT id,guest_id,created_at,expires_at,consumed_at,token_hash FROM guest_password_resets WHERE guest_id=$1',
    [guestId],
  );
  expect(saved.length).toBe(1);
  const { token_hash: stored, ...safe } = saved[0]!;
  expect(typeof stored).toBe('string');
  if (typeof stored !== 'string') throw new Error('HB028 missing token hash');
  expect(stored.length > 0).toBe(true);
  expect(stored.includes(token)).toBe(false);
  expect(
    [Buffer.from(token).toString('hex'), Buffer.from(token).toString('base64')].includes(stored),
  ).toBe(false);
  expect(safe.guest_id).toBe(guestId);
  expect(safe.created_at).toEqual(clock.now());
  expect(safe.expires_at).toEqual(new Date(clock.value + 1800000));
  expect(safe.consumed_at).toBeNull();
  // Black-box confirm tests establish token-to-account binding, without choosing the hash algorithm.
  return safe;
}
export async function passwordMatches(id: string, secret = newPassword) {
  const credential = await businessDb().guest_credentials.findUniqueOrThrow({
    where: { guest_id: id },
  });
  expect(credential.password_hash.startsWith('$argon2id$')).toBe(true);
  expect(credential.password_hash.includes(secret)).toBe(false);
  expect(await verify(credential.password_hash, secret)).toBe(true);
}
export async function snapshot(id: string) {
  return {
    credential: (
      await rows(
        "SELECT guest_id,encode(digest(password_hash,'sha256'),'hex') AS fingerprint,failed_login_count,locked_until,password_changed_at FROM guest_credentials WHERE guest_id=$1",
        [id],
      )
    )[0],
    sessions: await rows(
      'SELECT id,revoked_at,rotated_at FROM auth_sessions WHERE guest_id=$1 ORDER BY id',
      [id],
    ),
    resets: await rows(
      'SELECT id,consumed_at FROM guest_password_resets WHERE guest_id=$1 ORDER BY id',
      [id],
    ),
  };
}
export function assertPrivate(text: string, secrets: readonly string[] = []) {
  for (const value of [phone, legacyPhone, email, password, newPassword, ...secrets])
    expect(text.includes(value)).toBe(false);
  expect(/password_hash|passwordHash|token_hash|tokenHash|\$argon2id\$/.test(text)).toBe(false);
}
export async function privacy(secrets: readonly string[] = []) {
  // Request/failure logs need a positive capture control; never pass privacy because logging is disabled.
  expect(logs().length > 0).toBe(true);
  assertPrivate(logs(), secrets);
  assertPrivate(JSON.stringify(await rows('SELECT * FROM audit_logs')), secrets);
}
export async function auditCount() {
  return Number((await rows('SELECT count(*) AS n FROM audit_logs'))[0]!.n);
}
// Deferred constraint trigger executes at COMMIT, after all transaction callback writes/mail calls.
export async function beforeCommit<T>(operation: () => Promise<T>, inspect: () => Promise<void>) {
  const existing = await rows('SELECT id FROM guest_password_resets ORDER BY id');
  await rows(
    'CREATE FUNCTION hb028_stall() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN PERFORM pg_advisory_xact_lock(28028); RETURN NEW; END $$',
  );
  await rows(
    'CREATE CONSTRAINT TRIGGER hb028_stall AFTER INSERT ON guest_password_resets DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION hb028_stall()',
  );
  await rows('BEGIN');
  let result: Promise<PromiseSettledResult<T>> | undefined,
    complete = false,
    reached = false;
  try {
    await rows('SELECT pg_advisory_xact_lock(28028)');
    result = Promise.allSettled([operation()])
      .then((values) => values[0]!)
      .finally(() => {
        complete = true;
      });
    const deadline = Date.now() + 5000;
    while (!complete) {
      await rows('SELECT pg_stat_clear_snapshot()');
      const waiting = Number(
        (
          await rows(
            "SELECT count(*) AS n FROM pg_stat_activity WHERE usename=$1 AND wait_event_type='Lock'",
            [role],
          )
        )[0]!.n,
      );
      if (waiting >= 1) {
        reached = true;
        break;
      }
      if (Date.now() > deadline) throw new Error('HB028 reset did not reach commit barrier');
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    if (!reached) throw new Error('HB028 request completed before commit barrier');
    expect(await rows('SELECT id FROM guest_password_resets ORDER BY id')).toEqual(existing);
    await inspect();
  } finally {
    await rows('ROLLBACK');
    await result;
    await rows('DROP TRIGGER hb028_stall ON guest_password_resets');
    await rows('DROP FUNCTION hb028_stall()');
  }
  if (result === undefined) throw new Error('HB028 missing reset operation');
  const settled = await result;
  if (settled.status === 'fulfilled') return settled.value;
  throw settled.reason instanceof Error
    ? settled.reason
    : new Error('HB028 reset operation failed');
}
function nonemptyError(value: unknown): boolean {
  if (typeof value === 'string') return value.trim().length > 0;
  if (value === true) return true;
  if (typeof value === 'object' && value !== null) return Object.values(value).some(nonemptyError);
  return false;
}
function failureMarker(value: unknown): boolean {
  if (typeof value !== 'object' || value === null) return false;
  return Object.entries(value).some(([key, item]) => {
    if (/^(success|sent|delivered|mailSent|emailSent)$/i.test(key) && item === false) return true;
    if (/(?:error|err|exception)$/i.test(key) && nonemptyError(item)) return true;
    if (
      /^(action|status|event|eventType|message|reason|outcome|code|errorCode)$/i.test(key) &&
      typeof item === 'string' &&
      /failed|failure|error|ECONNREFUSED|lỗi|thất bại/i.test(item)
    )
      return true;
    return typeof item === 'object' && item !== null && failureMarker(item);
  });
}
export function isDeliveryFailure(value: unknown): boolean {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  return /mail|smtp|email|password.?reset/i.test(JSON.stringify(value)) && failureMarker(value);
}
export function assertDeliveryFailure(value: unknown) {
  expect(isDeliveryFailure(value)).toBe(true);
}
export async function concurrentConfirm<T>(resetId: string, commands: () => Promise<T>[]) {
  await rows('BEGIN');
  let results: Promise<PromiseSettledResult<T>[]> | undefined,
    complete = 0,
    reached = false;
  try {
    await rows('SELECT id FROM guest_password_resets WHERE id=$1 FOR UPDATE', [resetId]);
    results = Promise.allSettled(
      commands().map(async (command) => {
        try {
          return await command;
        } finally {
          complete++;
        }
      }),
    );
    const deadline = Date.now() + 5000;
    while (complete === 0) {
      await rows('SELECT pg_stat_clear_snapshot()');
      const waiting = Number(
        (
          await rows(
            "SELECT count(*) AS n FROM pg_stat_activity WHERE usename=$1 AND wait_event_type='Lock'",
            [role],
          )
        )[0]!.n,
      );
      if (waiting >= 2) {
        reached = true;
        break;
      }
      if (Date.now() > deadline) throw new Error('HB028 confirm race did not reach two DB locks');
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    if (!reached) throw new Error('HB028 confirm requests completed before two DB locks');
  } finally {
    await rows('ROLLBACK');
    await results;
  }
  if (results === undefined) throw new Error('HB028 missing confirm commands');
  return (await results).map((value) => {
    if (value.status === 'fulfilled') return value.value;
    throw value.reason instanceof Error
      ? value.reason
      : new Error('HB028 confirm operation failed');
  });
}
