import { createHash } from 'node:crypto';
import { hash, verify } from '@node-rs/argon2';
import { expect } from 'vitest';
import { z } from 'zod';
import { jwtVerify } from 'jose';
import type { TokenPair } from '@pinehill/contracts';
import {
  rows,
  businessDb,
  clock,
  phone,
  legacyPhone,
  email,
  password,
  role,
  accessSecret,
} from './guest-oracle.fixture.js';
export async function profile(value = phone) {
  return (await rows('SELECT * FROM guests WHERE phone=$1', [value]))[0];
}
export async function credentials(guestId: string) {
  return (
    await rows(
      "SELECT guest_id,failed_login_count,locked_until,encode(digest(password_hash,'sha256'),'hex') AS fingerprint FROM guest_credentials WHERE guest_id=$1",
      [guestId],
    )
  )[0];
}
export async function guestSession(token: string) {
  const digest = createHash('sha256').update(token).digest('hex');
  const sessions = await rows(
    'SELECT id,principal_type,user_id,guest_id,surface,family_id,expires_at,last_seen_at,rotated_at,revoked_at FROM auth_sessions WHERE token_hash=$1',
    [digest],
  );
  expect(sessions).toHaveLength(1);
  return sessions[0]!;
}
export async function assertPrincipal(tokens: TokenPair, guestId: string, surface = 'GUEST_WEB') {
  const session = await guestSession(tokens.refreshToken);
  expect(session.principal_type).toBe('GUEST');
  expect(session.guest_id).toBe(guestId);
  expect(session.user_id).toBeNull();
  expect(session.surface).toBe(surface);
  await assertAccessToken(tokens.accessToken, String(session.id));
  expect(tokens.expiresInSeconds).toBe(900);
  expect(tokens.refreshExpiresInSeconds).toBe(604800);
  expect(session.expires_at).toEqual(new Date(clock.value + 604800000));
  return session;
}
export async function assertAccessToken(token: string, sessionId: string) {
  const { payload, protectedHeader } = await jwtVerify(
    token,
    new TextEncoder().encode(accessSecret),
    {
      algorithms: ['HS256'],
      currentDate: clock.now(),
    },
  );
  expect(protectedHeader.alg).toBe('HS256');
  expect(payload.exp).toBe(Math.floor(clock.value / 1000) + 900);
  // The shared HB-013 signer binds sid to the persisted principal; no unpublished guest claim name.
  expect(payload.sid).toBe(sessionId);
}
export async function assertPassword(guestId: string) {
  const encoded = String(
    (await rows('SELECT password_hash FROM guest_credentials WHERE guest_id=$1', [guestId]))[0]!
      .password_hash,
  );
  expect(encoded.startsWith('$argon2id$')).toBe(true);
  expect(encoded.includes(password)).toBe(false);
  expect(await verify(encoded, password)).toBe(true);
}
export async function seedGuest(withCredentials = true, extra: object = {}) {
  const body = {
    fullName: 'Synthetic existing HB017',
    email: 'synthetic-hb017@example.invalid',
    blacklisted: false,
    ...extra,
  };
  const guest = await businessDb().guests.create({
    data: {
      phone,
      full_name: body.fullName,
      email: body.email,
      blacklisted: body.blacklisted,
      // ck_guests_blacklist_reason: cờ danh sách đen bắt buộc kèm lý do.
      ...(body.blacklisted ? { blacklist_reason: 'synthetic HB017 blacklist' } : {}),
    },
  });
  if (withCredentials)
    await businessDb().guest_credentials.create({
      data: {
        guest_id: guest.id,
        password_hash: await hash(password, { memoryCost: 19456, timeCost: 2, parallelism: 1 }),
      },
    });
  return guest.id;
}
export async function totals() {
  const value = (
    await rows(
      "SELECT (SELECT count(*) FROM guests) AS guests,(SELECT count(*) FROM guest_credentials) AS credentials,(SELECT count(*) FROM auth_sessions WHERE principal_type='GUEST') AS sessions,(SELECT count(*) FROM audit_logs WHERE entity_type='Guest') AS audits",
    )
  )[0]!;
  return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, Number(v)]));
}
function field(snapshot: unknown, camel: string, snake: string): unknown {
  if (typeof snapshot !== 'object' || snapshot === null || Array.isArray(snapshot))
    throw new Error('HB017 invalid audit snapshot');
  const value = z.record(z.string(), z.unknown()).parse(snapshot);
  const keys = [...new Set([camel, snake])].filter((key) => Object.hasOwn(value, key));
  expect(keys.length).toBeGreaterThan(0);
  if (keys.length === 2) expect(value[camel]).toEqual(value[snake]);
  return value[keys[0]!];
}
export async function assertRegistrationAudit(
  guestId: string,
  consent: boolean,
  issuedTokens: readonly string[] = [],
) {
  const audit = (
    await rows(
      "SELECT before_json,after_json FROM audit_logs WHERE entity_type='Guest' AND entity_id=$1 AND before_json IS NULL ORDER BY chain_seq DESC LIMIT 1",
      [guestId],
    )
  )[0];
  expect(audit).toBeDefined();
  expect(field(audit!.after_json, 'consentMarketing', 'consent_marketing')).toBe(consent);
  expect(field(audit!.after_json, 'consentVersion', 'consent_version')).toBe('hb017-v1');
  const json = JSON.stringify(await rows('SELECT * FROM audit_logs WHERE entity_id=$1', [guestId]));
  for (const sensitive of [phone, legacyPhone, email, password, ...issuedTokens])
    expect(json.includes(sensitive)).toBe(false);
  expect(/password_hash|passwordHash|token_hash|tokenHash|\$argon2id\$/.test(json)).toBe(false);
}
async function underLocks<T>(
  table: 'guest_credentials' | 'auth_sessions',
  column: 'guest_id' | 'id',
  resource: string,
  commands: () => Promise<T>[],
) {
  await rows('BEGIN');
  let complete = 0,
    reachedBarrier = false;
  let results: Promise<PromiseSettledResult<T>[]> | undefined;
  try {
    await rows(`SELECT ${column} FROM ${table} WHERE ${column}=$1 FOR UPDATE`, [resource]);
    results = Promise.allSettled(
      commands().map(async (p) => {
        try {
          return await p;
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
        reachedBarrier = true;
        break;
      }
      if (Date.now() >= deadline) throw new Error('HB017 credential race did not reach DB locks');
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    if (!reachedBarrier)
      throw new Error('HB017 requests completed without reaching DB lock barrier');
  } finally {
    await rows('ROLLBACK');
    await results;
  }
  if (results === undefined) throw new Error('HB017 missing race commands');
  return (await results).map((r) => {
    if (r.status === 'fulfilled') return r.value;
    throw r.reason instanceof Error ? r.reason : new Error('HB017 race request failed');
  });
}

export const underCredentialLocks = <T>(guestId: string, commands: () => Promise<T>[]) =>
  underLocks('guest_credentials', 'guest_id', guestId, commands);
export const underSessionLocks = <T>(sessionId: string, commands: () => Promise<T>[]) =>
  underLocks('auth_sessions', 'id', sessionId, commands);
