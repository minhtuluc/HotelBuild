import { createHash, randomUUID } from 'node:crypto';
import { expect, test } from 'vitest';
import { tokenPairSchema } from '@pinehill/contracts';
import { clock, login, refresh, rows, session, userId } from './staff-auth.locked.fixture.js';

// A historical business clock must not mix with PostgreSQL's wall-clock defaults.
test('login persists creation and expiry using the same injected clock', async () => {
  clock.value = Date.UTC(2001, 0, 1);
  const pair = await login('OPS_ANDROID');
  const stored = await session(pair.refreshToken);
  expect(stored.created_at).toEqual(new Date('2001-01-01T00:00:00.000Z'));
  expect(stored.last_seen_at).toEqual(new Date('2001-01-01T00:00:00.000Z'));
  expect(stored.expires_at).toEqual(new Date('2001-01-08T00:00:00.000Z'));
  expect(pair.refreshExpiresInSeconds).toBe(604800);
});

test('refresh timestamps its descendant with the clock and retains the absolute family expiry', async () => {
  clock.value = Date.UTC(2001, 0, 1);
  const token = 'synthetic-clock-refresh-token';
  const familyId = randomUUID();
  await rows(
    `INSERT INTO auth_sessions
     (id, principal_type, user_id, surface, family_id, token_hash, created_at, last_seen_at, expires_at)
     VALUES ($1::uuid, 'USER', $2::uuid, 'OPS_ANDROID', $3::uuid, $4, $5, $5, $6)`,
    [
      randomUUID(),
      userId,
      familyId,
      createHash('sha256').update(token).digest('hex'),
      new Date('2001-01-01T00:00:00.000Z'),
      new Date('2001-01-08T00:00:00.000Z'),
    ],
  );
  clock.advance(60000);
  const response = await refresh(token);
  expect(response.status).toBe(200);
  const pair = tokenPairSchema.parse(response.body);
  const stored = await session(pair.refreshToken);
  expect(stored.family_id).toBe(familyId);
  expect(stored.created_at).toEqual(new Date('2001-01-01T00:01:00.000Z'));
  expect(stored.last_seen_at).toEqual(new Date('2001-01-01T00:01:00.000Z'));
  expect(stored.expires_at).toEqual(new Date('2001-01-08T00:00:00.000Z'));
  expect(pair.refreshExpiresInSeconds).toBe(604740);
});
