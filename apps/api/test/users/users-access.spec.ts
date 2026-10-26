import { test, expect } from 'vitest';
import { errorBodySchema, tokenPairSchema } from '@pinehill/contracts';
import {
  http,
  login,
  match,
  access,
  create,
  newUser,
  changes,
  rows,
  id,
  propertyB,
  state,
  assertAccess,
  assertAudit,
  auditCount,
  underUserLocks,
} from './users-oracle.fixture.js';

// HB-016 concurrency, versions, all-session revocation and audit atomicity.
function error(response: { status: number; body: unknown }, status: number, code: string) {
  expect(response.status).toBe(status);
  expect(errorBodySchema.parse(response.body).code).toBe(code);
}
async function unchanged(name: string, before: Awaited<ReturnType<typeof state>>, audits: number) {
  expect(await state(name)).toEqual(before);
  expect(await auditCount()).toBe(audits);
}

test('missing If-Match is 428 and a stale version is 412 with no additional mutation', async () => {
  const token = (await login()).accessToken;
  const original = await match(token, 'staff-a'),
    before = await state('staff-a'),
    audits = await auditCount();
  error(await access(token, 'staff-a', changes('MANAGER')), 428, 'E_GEN_PRECONDITION_REQUIRED');
  await unchanged('staff-a', before, audits);
  expect(await match(token, 'staff-a')).toBe(original);
  expect((await access(token, 'staff-a', changes('MANAGER'), original)).status).toBe(200);
  const next = await match(token, 'staff-a');
  expect(next).not.toBe(original);
  const saved = await state('staff-a'),
    savedAudits = await auditCount();
  error(
    await access(token, 'staff-a', changes('ACCOUNTANT'), original),
    412,
    'E_GEN_VERSION_CONFLICT',
  );
  await unchanged('staff-a', saved, savedAudits);
  expect(await match(token, 'staff-a')).toBe(next);
});
for (const mutation of ['role', 'scope', 'activation'])
  test(`${mutation} change revokes every target session; access and refresh reject immediately`, async () => {
    const owner = (await login()).accessToken;
    const web = await login('staff-a'),
      android = await login('staff-a', 'OPS_ANDROID');
    const rotatedResponse = await http()
      .post('/api/v1/auth/refresh')
      .send({ refreshToken: web.refreshToken });
    expect(rotatedResponse.status).toBe(200);
    const rotated = tokenPairSchema.parse(rotatedResponse.body);
    const body =
      mutation === 'role'
        ? changes('MANAGER')
        : mutation === 'scope'
          ? changes('FRONT_DESK', true, [propertyB])
          : changes('FRONT_DESK', false);
    const result = await access(owner, 'staff-a', body, await match(owner, 'staff-a'));
    expect(result.status).toBe(200);
    await assertAudit(id('staff-a'), changes(), body);
    const sessions = (await assertAccess('staff-a', body)).sessions;
    expect(sessions).toHaveLength(3);
    expect(sessions.every((s) => s.revoked_at instanceof Date)).toBe(true);
    for (const pair of [web, rotated, android]) {
      error(
        await http().get('/api/v1/auth/me').set('Authorization', `Bearer ${pair.accessToken}`),
        401,
        'E_AUTH_INVALID_CREDENTIALS',
      );
      error(
        await http().post('/api/v1/auth/refresh').send({ refreshToken: pair.refreshToken }),
        401,
        'E_AUTH_INVALID_CREDENTIALS',
      );
    }
  });
test('two simultaneous edits using one version yield one 200 and one 412', async () => {
  const token = (await login()).accessToken,
    version = await match(token, 'staff-a');
  const results = await underUserLocks(['staff-a'], () => [
    Promise.resolve(access(token, 'staff-a', changes('MANAGER'), version)),
    Promise.resolve(access(token, 'staff-a', changes('ACCOUNTANT'), version)),
  ]);
  expect(results.map((r) => r.status).sort()).toEqual([200, 412]);
  error(
    results.find((r) => r.status === 412)!,
    412,
    'E_GEN_VERSION_CONFLICT',
  );
  const winner = results.findIndex((r) => r.status === 200);
  const finalRole = winner === 0 ? 'MANAGER' : 'ACCOUNTANT';
  await assertAccess('staff-a', changes(finalRole));
  await assertAudit(id('staff-a'), changes(), changes(finalRole));
});
test('two owners concurrently disable each other: exactly one succeeds and one active OWNER remains', async () => {
  const a = (await login()).accessToken,
    b = (await login('owner-b')).accessToken;
  const av = await match(a, 'owner-b'),
    bv = await match(b, 'owner-a');
  const results = await underUserLocks(['owner-a', 'owner-b'], () => [
    Promise.resolve(access(a, 'owner-b', changes('OWNER', false, []), av)),
    Promise.resolve(access(b, 'owner-a', changes('OWNER', false, []), bv)),
  ]);
  expect(results.filter((r) => r.status === 200)).toHaveLength(1);
  // The other request may reach the last-owner rule, or lose its already-revoked session first.
  const refused = results.find((r) => r.status !== 200)!;
  expect([401, 403]).toContain(refused.status);
  expect(['E_AUTH_INVALID_CREDENTIALS', 'E_RBAC_FORBIDDEN']).toContain(
    errorBodySchema.parse(refused.body).code,
  );
  expect(
    Number((await rows("SELECT count(*) AS n FROM users WHERE role='OWNER' AND is_active"))[0]!.n),
  ).toBe(1);
});
test('audit insert failure rolls back user, scope and session revocation together', async () => {
  const token = (await login()).accessToken;
  await login('staff-a');
  const version = await match(token, 'staff-a'),
    before = await state('staff-a'),
    audits = await auditCount();
  await rows(
    "ALTER TABLE audit_logs ADD CONSTRAINT hb016_fault CHECK(entity_type <> 'User') NOT VALID",
  );
  try {
    const response = await access(
      token,
      'staff-a',
      changes('MANAGER', false, [propertyB]),
      version,
    );
    expect(response.status).toBe(500);
    await unchanged('staff-a', before, audits);
  } finally {
    await rows('ALTER TABLE audit_logs DROP CONSTRAINT hb016_fault');
  }
});
test('audit failure during create leaves no user or scopes', async () => {
  const token = (await login()).accessToken,
    body = newUser(),
    audits = await auditCount();
  await rows(
    "ALTER TABLE audit_logs ADD CONSTRAINT hb016_fault CHECK(entity_type <> 'User') NOT VALID",
  );
  try {
    expect((await create(token, body)).status).toBe(500);
    expect(await rows('SELECT id FROM users WHERE username=$1', [body.username])).toHaveLength(0);
    expect(await auditCount()).toBe(audits);
  } finally {
    await rows('ALTER TABLE audit_logs DROP CONSTRAINT hb016_fault');
  }
});
