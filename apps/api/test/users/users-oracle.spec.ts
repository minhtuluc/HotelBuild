import { randomUUID } from 'node:crypto';
import { test, expect } from 'vitest';
import {
  errorBodySchema,
  userSummarySchema,
  tokenPairSchema,
  userMeSchema,
} from '@pinehill/contracts';
import {
  http,
  login,
  listed,
  match,
  access,
  create,
  newUser,
  changes,
  rows,
  id,
  propertyA,
  propertyB,
  state,
  assertAccess,
  assertPassword,
  assertAudit,
  auditCount,
  username,
} from './users-oracle.fixture.js';

// Independent oracle: HB-016, QĐ-03 §1.7/T6/T9, api§2.1/§6.3, TC-AUTH-06/10.
// No test controller, permission mutation or implementation mock.
function error(response: { status: number; body: unknown }, status: number, code: string) {
  expect(response.status).toBe(status);
  expect(errorBodySchema.parse(response.body).code).toBe(code);
}
async function unchanged(name: string, before: Awaited<ReturnType<typeof state>>, audits: number) {
  expect(await state(name)).toEqual(before);
  expect(await auditCount()).toBe(audits);
}

test('control: real TCP health and staff auth/RBAC operate on owned PG16/Redis7', async () => {
  const health = await http().get('/api/v1/system/health');
  expect(health.status).toBe(200);
  const pair = await login();
  const me = await http().get('/api/v1/auth/me').set('Authorization', `Bearer ${pair.accessToken}`);
  expect(me.status).toBe(200);
  expect(userMeSchema.parse(me.body).userId).toBe(id('owner-a'));
});
test('OWNER lists user summary, ETag, filters and cursor without hashes or credentials', async () => {
  const token = (await login()).accessToken;
  const first = await listed(token, { q: username('staff'), role: 'FRONT_DESK', limit: 1 });
  expect(first.data).toHaveLength(1);
  expect(first.meta.total).toBe(2);
  expect(first.meta.hasMore).toBe(true);
  expect(first.meta.nextCursor).not.toBeNull();
  const second = await listed(token, {
    q: username('staff'),
    role: 'FRONT_DESK',
    limit: 1,
    cursor: first.meta.nextCursor,
  });
  expect(second.data).toHaveLength(1);
  expect(second.data[0]!.id).not.toBe(first.data[0]!.id);
  expect(second.meta.hasMore).toBe(false);
  const filtered = await listed(token, { q: username('staff'), propertyId: propertyB });
  expect(filtered.data.map((u) => u.id)).toEqual([id('staff-b')]);
});
test('MANAGER list is scoped; caller propertyId cannot expand its property scope', async () => {
  const token = (await login('manager')).accessToken;
  const result = await listed(token, { q: username('staff') });
  expect(result.data.map((u) => u.id)).toEqual([id('staff-a')]);
  const response = await http()
    .get('/api/v1/users')
    .set('Authorization', `Bearer ${token}`)
    .query({ propertyId: propertyB });
  error(response, 403, 'E_AUTH_OUT_OF_SCOPE');
});
test('SYSADMIN can list user administration without a business property membership', async () => {
  const token = (await login('admin')).accessToken;
  const result = await listed(token, { q: username('staff') });
  expect(new Set(result.data.map((u) => u.id))).toEqual(new Set([id('staff-a'), id('staff-b')]));
});
for (const role of ['FRONT_DESK', 'RESERVATION_AGENT', 'ACCOUNTANT', 'HOUSEKEEPING'])
  test(`${role} cannot list, create or assign user privileges`, async () => {
    await rows('UPDATE users SET role=$1 WHERE id=$2', [role, id('staff-a')]);
    const token = (await login('staff-a')).accessToken;
    const before = await state('staff-b'),
      audits = await auditCount();
    error(
      await http().get('/api/v1/users').set('Authorization', `Bearer ${token}`),
      403,
      'E_RBAC_FORBIDDEN',
    );
    error(await create(token, newUser()), 403, 'E_RBAC_FORBIDDEN');
    error(await access(token, 'staff-b', changes(), '"1"'), 403, 'E_RBAC_FORBIDDEN');
    await unchanged('staff-b', before, audits);
    expect(
      await rows('SELECT id FROM users WHERE username=$1', [username('new-person')]),
    ).toHaveLength(0);
  });
test('MANAGER cannot create or assign user privileges', async () => {
  const token = (await login('manager')).accessToken;
  error(await create(token, newUser()), 403, 'E_RBAC_FORBIDDEN');
  error(await access(token, 'staff-b', changes(), '"1"'), 403, 'E_RBAC_FORBIDDEN');
});
for (const role of ['OWNER', 'SYSADMIN'])
  test(`SYSADMIN cannot assign ${role} via either create or update`, async () => {
    const token = (await login('admin')).accessToken;
    const before = await state('staff-a'),
      audits = await auditCount();
    error(await create(token, newUser('new-person', role)), 403, 'E_RBAC_FORBIDDEN');
    error(
      await access(token, 'staff-a', changes(role, true, []), await match(token, 'staff-a')),
      403,
      'E_RBAC_FORBIDDEN',
    );
    await unchanged('staff-a', before, audits);
  });
for (const name of ['owner-a', 'admin'])
  for (const field of ['role', 'scope', 'activation'])
    test(`${name} cannot edit only its own ${field}`, async () => {
      const token = (await login(name)).accessToken;
      const version = await match(token, name),
        before = await state(name),
        audits = await auditCount();
      const role = name === 'owner-a' ? 'OWNER' : 'SYSADMIN';
      const body =
        field === 'role'
          ? changes(name === 'owner-a' ? 'SYSADMIN' : 'FRONT_DESK', true, [])
          : field === 'scope'
            ? changes(role, true, [propertyA])
            : changes(role, false, []);
      error(await access(token, name, body, version), 403, 'E_RBAC_FORBIDDEN');
      await unchanged(name, before, audits);
    });
for (const role of [
  'OWNER',
  'SYSADMIN',
  'MANAGER',
  'FRONT_DESK',
  'RESERVATION_AGENT',
  'ACCOUNTANT',
  'HOUSEKEEPING',
])
  test(`OWNER can assign ${role} to another account`, async () => {
    const token = (await login()).accessToken;
    const response = await access(
      token,
      'staff-a',
      changes(role, true, ['OWNER', 'SYSADMIN'].includes(role) ? [] : [propertyA]),
      await match(token, 'staff-a'),
    );
    expect(response.status).toBe(200);
    await assertAccess(
      'staff-a',
      changes(role, true, ['OWNER', 'SYSADMIN'].includes(role) ? [] : [propertyA]),
    );
    expect(response.headers.etag).toBe(await match(token, 'staff-a'));
    await assertAudit(
      id('staff-a'),
      changes(),
      changes(role, true, ['OWNER', 'SYSADMIN'].includes(role) ? [] : [propertyA]),
    );
  });
test('SYSADMIN can assign a normal role with validated property scope', async () => {
  const token = (await login('admin')).accessToken;
  const response = await access(
    token,
    'staff-a',
    changes('MANAGER', true, [propertyB]),
    await match(token, 'staff-a'),
  );
  expect(response.status).toBe(200);
  const saved = await state('staff-a');
  expect(saved.user.role).toBe('MANAGER');
  expect(saved.scopes).toEqual([{ property_id: propertyB }]);
  await assertAudit(id('staff-a'), changes(), changes('MANAGER', true, [propertyB]), 'admin');
});
test('OWNER can demote another OWNER when two are active', async () => {
  const token = (await login()).accessToken;
  expect((await access(token, 'owner-b', changes(), await match(token, 'owner-b'))).status).toBe(
    200,
  );
  await assertAudit(id('owner-b'), changes('OWNER', true, []), changes());
  expect(
    Number((await rows("SELECT count(*) AS n FROM users WHERE role='OWNER' AND is_active"))[0]!.n),
  ).toBe(1);
});
test('unknown property or malformed role fails without mutation, sessions or audit changes', async () => {
  const token = (await login()).accessToken,
    version = await match(token, 'staff-a');
  const before = await state('staff-a'),
    audits = await auditCount();
  error(
    await access(token, 'staff-a', changes('FRONT_DESK', true, [randomUUID()]), version),
    400,
    'E_GEN_VALIDATION_FAILED',
  );
  error(await access(token, 'staff-a', changes('GUEST'), version), 400, 'E_GEN_VALIDATION_FAILED');
  await unchanged('staff-a', before, audits);
});
test('create returns safe summary, temporary password is Argon2id and forces password change', async () => {
  const token = (await login()).accessToken,
    body = newUser();
  const response = await create(token, body);
  expect(response.status).toBe(201);
  const summary = userSummarySchema.parse(response.body);
  expect(summary.username).toBe(body.username);
  expect(summary.propertyScope).toEqual([propertyA]);
  expect(JSON.stringify(response.body)).not.toMatch(/password|token_hash|\$argon2id\$/);
  await assertPassword(body.username, body.temporaryPassword);
  const responseLogin = await http()
    .post('/api/v1/auth/login')
    .send({ username: body.username, password: body.temporaryPassword });
  expect(responseLogin.status).toBe(200);
  const pair = tokenPairSchema.parse(responseLogin.body);
  expect(pair.mustChangePassword).toBe(true);
  error(
    await http().get('/api/v1/auth/me').set('Authorization', `Bearer ${pair.accessToken}`),
    403,
    'E_AUTH_PASSWORD_CHANGE_REQUIRED',
  );
  await assertAudit(summary.id, null, changes(body.role));
});
test('duplicate username returns 409 and concurrent creation persists only one account', async () => {
  const token = (await login()).accessToken,
    body = newUser();
  const results = await Promise.all([create(token, body), create(token, body)]);
  expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
  error(
    results.find((r) => r.status === 409)!,
    409,
    'E_AUTH_USERNAME_TAKEN',
  );
  expect(await rows('SELECT id FROM users WHERE username=$1', [body.username])).toHaveLength(1);
});
test('SYSADMIN cannot demote the sole active OWNER to an otherwise assignable role', async () => {
  await rows('UPDATE users SET is_active=false WHERE id=$1', [id('owner-a')]);
  const token = (await login('admin')).accessToken;
  const version = await match(token, 'owner-b'),
    before = await state('owner-b'),
    audits = await auditCount();
  error(await access(token, 'owner-b', changes(), version), 403, 'E_RBAC_FORBIDDEN');
  await unchanged('owner-b', before, audits);
});
test('SYSADMIN creates a normal-role account with mandatory password change', async () => {
  const token = (await login('admin')).accessToken,
    body = newUser();
  const response = await create(token, body);
  expect(response.status).toBe(201);
  const summary = userSummarySchema.parse(response.body);
  expect(summary.role).toBe('FRONT_DESK');
  await assertAudit(summary.id, null, changes(), 'admin');
  expect(
    (await rows('SELECT must_change_password FROM users WHERE id=$1', [summary.id]))[0]!
      .must_change_password,
  ).toBe(true);
});

test('same-body same-key create retry is username conflict, not idempotency replay (QĐ-03 T9)', async () => {
  const token = (await login()).accessToken,
    body = newUser(),
    key = randomUUID();
  expect((await create(token, body, key)).status).toBe(201);
  error(await create(token, body, key), 409, 'E_AUTH_USERNAME_TAKEN');
  expect(await rows('SELECT id FROM users WHERE username=$1', [body.username])).toHaveLength(1);
});
test('business role with empty property scope is rejected on create and update', async () => {
  const token = (await login()).accessToken,
    before = await state('staff-a'),
    audits = await auditCount();
  error(await create(token, { ...newUser(), propertyScope: [] }), 400, 'E_GEN_VALIDATION_FAILED');
  error(
    await access(token, 'staff-a', changes('MANAGER', true, []), await match(token, 'staff-a')),
    400,
    'E_GEN_VALIDATION_FAILED',
  );
  await unchanged('staff-a', before, audits);
  expect(
    await rows('SELECT id FROM users WHERE username=$1', [username('new-person')]),
  ).toHaveLength(0);
});

test('anonymous caller cannot list, create or update users', async () => {
  error(await http().get('/api/v1/users'), 401, 'E_AUTH_INVALID_CREDENTIALS');
  error(
    await http().post('/api/v1/users').set('Idempotency-Key', randomUUID()).send(newUser()),
    401,
    'E_AUTH_INVALID_CREDENTIALS',
  );
  error(
    await http()
      .put(`/api/v1/users/${id('staff-a')}/access`)
      .set('Idempotency-Key', randomUUID())
      .set('If-Match', '"1"')
      .send(changes()),
    401,
    'E_AUTH_INVALID_CREDENTIALS',
  );
});
test('create cannot mass-assign password flags or a caller-supplied password hash', async () => {
  const token = (await login()).accessToken,
    body = newUser(),
    audits = await auditCount();
  error(
    await create(token, {
      ...body,
      mustChangePassword: false,
      passwordHash: 'synthetic forbidden field',
    }),
    400,
    'E_GEN_VALIDATION_FAILED',
  );
  expect(await rows('SELECT id FROM users WHERE username=$1', [body.username])).toHaveLength(0);
  expect(await auditCount()).toBe(audits);
});
