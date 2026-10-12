import { test, expect } from 'vitest';
import { z } from 'zod';
import {
  audit,
  logs,
  settings,
  login,
  propertyId,
  otherPropertyId,
  userId,
  rows,
} from './fixture.js';
const raw = z.object({
  data: z.array(z.record(z.string(), z.unknown())),
  meta: z.object({
    total: z.number(),
    limit: z.number(),
    hasMore: z.boolean(),
    nextCursor: z.string().nullable(),
  }),
});
test('MANAGER filters immutable scope before pagination and count, including conflicting and unknown proofs', async () => {
  const own = await audit(null, { propertyId, status: 'ACTIVE' });
  await audit(null, { propertyId: otherPropertyId });
  await audit({ propertyId: otherPropertyId }, { propertyId });
  await audit(null, { propertyId, property_id: otherPropertyId });
  await audit(null, { propertyId: [propertyId] });
  await audit(null, { note: propertyId });
  await audit(null, { propertyId }, 'UntrustedType');
  const direct = await audit(null, null, 'Property', propertyId);
  const result = await logs(await login('MANAGER'), { limit: 1 });
  expect(result.status).toBe(200);
  expect(result.headers['cache-control']).toBe('no-store');
  const first = raw.parse(result.body);
  expect(first.meta).toMatchObject({ total: 2, limit: 1, hasMore: true });
  const second = raw.parse(
    (await logs(await login('MANAGER'), { limit: 1, cursor: first.meta.nextCursor! })).body,
  );
  expect([first.data[0]!.id, second.data[0]!.id].sort()).toEqual([own, direct].sort());
  expect(second.meta).toMatchObject({ total: 2, hasMore: false, nextCursor: null });
});
test('OWNER reads global records; manager permission does not follow the writer current scope', async () => {
  const id = await audit(null, { propertyId: otherPropertyId });
  const unknown = await audit(null, { status: 'ACTIVE' });
  const owner = await logs(await login());
  expect(owner.status).toBe(200);
  expect(
    raw
      .parse(owner.body)
      .data.map((r) => r.id)
      .sort(),
  ).toEqual([id, unknown].sort());
  const manager = await logs(await login('MANAGER'));
  expect(manager.status).toBe(200);
  expect(raw.parse(manager.body).meta.total).toBe(0);
});
test('audit returns exact fields and removes legacy tokens, document identifiers and hidden guest fields', async () => {
  const id = await audit(null, {
    propertyId,
    status: 'ACTIVE',
    passwordHash: 'Synthetic-secret',
    accessToken: 'Synthetic-token',
    guest: { fullName: 'Synthetic Guest', phone: '+84901234567' },
    note: 'Passport AB 1234567; email test@example.invalid',
  });
  const result = await logs(await login());
  expect(result.status).toBe(200);
  const entry = raw.parse(result.body).data[0]!;
  expect(entry.id).toBe(id);
  expect(Object.keys(entry).sort()).toEqual(
    [
      'id',
      'actorId',
      'action',
      'entityType',
      'entityId',
      'reason',
      'beforeJson',
      'afterJson',
      'createdAt',
    ].sort(),
  );
  const serialized = JSON.stringify(entry);
  expect(serialized).not.toContain('Synthetic-secret');
  expect(serialized).not.toContain('Synthetic-token');
  expect(serialized).not.toContain('Synthetic Guest');
  expect(serialized).not.toContain('AB 1234567');
  expect(serialized).not.toContain('test@example.invalid');
  expect(
    z.object({ status: z.literal('ACTIVE') }).parse(JSON.parse(String(entry.afterJson))).status,
  ).toBe('ACTIVE');
});
test('audit validates real timestamps, IDs, filters and cursor membership; ranges are half-open', async () => {
  const a = await audit(null, { propertyId }, 'RoomBlock', undefined, '2026-10-11T00:00:00Z');
  await audit(null, { propertyId }, 'RoomBlock', undefined, '2026-10-12T00:00:00Z');
  const token = await login('MANAGER');
  const good = await logs(token, {
    from: '2026-10-11T00:00:00Z',
    to: '2026-10-12T00:00:00Z',
    actorId: userId,
    entityType: 'RoomBlock',
  });
  expect(good.status).toBe(200);
  expect(raw.parse(good.body).data.map((r) => r.id)).toEqual([a]);
  for (const query of [
    { from: '2026-02-30T00:00:00Z' },
    { actorId: 'bad' },
    { cursor: 'bad' },
    { limit: 101 },
    { alien: 'x' },
    { from: '2026-10-12T00:00:00Z', to: '2026-10-11T00:00:00Z' },
  ])
    expect((await logs(token, query)).status).toBe(400);
  const hidden = await audit(null, { propertyId: otherPropertyId });
  expect((await logs(token, { cursor: hidden })).status).toBe(400);
});
for (const role of ['HOUSEKEEPING', 'FRONT_DESK', 'RESERVATION_AGENT', 'ACCOUNTANT', 'SYSADMIN'])
  test(`${role} cannot read business audit or settings`, async () => {
    const token = await login(role);
    expect((await logs(token)).status).toBe(403);
    expect((await settings(token)).status).toBe(403);
  });
test('OWNER sees live typed settings and explicit SYSTEM metadata; manager cannot read global configuration', async () => {
  const result = await settings(await login());
  expect(result.status).toBe(200);
  expect(result.headers['cache-control']).toBe('no-store');
  const parsed = raw.parse(result.body);
  expect(parsed.meta.total).toBe(5);
  const number = parsed.data.find((r) => r.key === 'refund.feeAmount')!;
  expect(number).toMatchObject({
    value: '0',
    valueType: 'NUMBER',
    updatedBy: 'SYSTEM',
    version: 1,
  });
  expect(Object.keys(number).sort()).toEqual(
    ['key', 'value', 'valueType', 'description', 'updatedBy', 'updatedAt', 'version'].sort(),
  );
  expect(parsed.data.find((r) => r.key === 'test.label')!.description).toBe('test.label');
  expect((await settings(await login('MANAGER'))).status).toBe(403);
});
test('settings paginate by real keys and reject unknown cursors and query fields', async () => {
  const token = await login();
  const first = await settings(token, { limit: 1 });
  expect(first.status).toBe(200);
  const page = raw.parse(first.body);
  expect(page.data[0]!.key).toBe('H029');
  const next = raw.parse((await settings(token, { limit: 1, cursor: page.meta.nextCursor! })).body);
  expect(next.data[0]!.key).toBe('refund.feeAmount');
  expect((await settings(token, { cursor: 'missing' })).status).toBe(400);
  expect((await settings(token, { role: 'OWNER' })).status).toBe(400);
  await rows("UPDATE system_settings SET value='200' WHERE key='refund.feeAmount'");
  expect(
    raw.parse((await settings(token)).body).data.find((r) => r.key === 'refund.feeAmount')!.value,
  ).toBe('200');
});

test('MANAGER with revoked empty scope sees an empty page, not an internal error', async () => {
  await audit(null, { propertyId });
  const token = await login('MANAGER');
  await rows('DELETE FROM user_property_scopes WHERE user_id=$1', [userId]);
  const result = await logs(token);
  expect(result.status).toBe(200);
  expect(raw.parse(result.body)).toMatchObject({ data: [], meta: { total: 0, hasMore: false } });
});
test('contradictory immutable proofs are denied even when both properties are in manager scope', async () => {
  await rows('INSERT INTO user_property_scopes(user_id,property_id) VALUES($1,$2)', [
    userId,
    otherPropertyId,
  ]);
  try {
    await audit({ propertyId }, { propertyId: otherPropertyId });
    const result = await logs(await login('MANAGER'));
    expect(result.status).toBe(200);
    expect(raw.parse(result.body).meta.total).toBe(0);
  } finally {
    await rows('DELETE FROM user_property_scopes WHERE user_id=$1 AND property_id=$2', [
      userId,
      otherPropertyId,
    ]);
  }
});
test('legacy secrets in free text and embedded JSON values cannot leak through audit projection', async () => {
  await audit(null, {
    propertyId,
    note: 'accessToken=SyntheticSecretWord; API key: SyntheticKeyWord',
    value: JSON.stringify({
      status: 'ACTIVE',
      password: 'SyntheticPassword',
      before: { refreshToken: 'SyntheticRefresh' },
    }),
  });
  const result = await logs(await login());
  expect(result.status).toBe(200);
  const text = JSON.stringify(result.body);
  for (const secret of [
    'SyntheticSecretWord',
    'SyntheticKeyWord',
    'SyntheticPassword',
    'SyntheticRefresh',
  ])
    expect(text).not.toContain(secret);
  expect(text).toContain('ACTIVE');
});
test('numeric setting values retain their exact decimal digits in audit output', async () => {
  await audit(
    { key: 'refund.feeAmount', value: '123456789' },
    { key: 'refund.feeAmount', value: '234567890' },
    'SystemSetting',
  );
  const result = await logs(await login());
  expect(result.status).toBe(200);
  const entry = raw.parse(result.body).data[0]!;
  expect(JSON.parse(String(entry.beforeJson))).toMatchObject({ value: '123456789' });
  expect(JSON.parse(String(entry.afterJson))).toMatchObject({ value: '234567890' });
});
test('legacy secret-named setting snapshot is redacted when read', async () => {
  await audit(
    null,
    { key: 'credentials.password', value: 'SyntheticLegacyCredential' },
    'SystemSetting',
  );
  const result = await logs(await login());
  expect(result.status).toBe(200);
  expect(JSON.stringify(result.body)).not.toContain('SyntheticLegacyCredential');
});
test('legacy quoted JSON secrets in reason are redacted when read', async () => {
  const id = await audit(null, { propertyId });
  // Append-only historical input fixture: supply reason on insertion, never update AuditLog.
  await rows(
    `INSERT INTO audit_logs(chain_seq,row_hash,actor_id,actor_role,action,entity_type,entity_id,reason)
    VALUES(0,'pending',$1,'OWNER',(SELECT action FROM audit_logs WHERE id=$2),'SystemSetting',NULL,$3)`,
    [
      userId,
      id,
      '{"password":"SyntheticLegacyQuotedPassword","accessToken":"SyntheticLegacyQuotedToken"}',
    ],
  );
  const response = await logs(await login());
  expect(response.status).toBe(200);
  const text = JSON.stringify(response.body);
  expect(text).not.toContain('SyntheticLegacyQuotedPassword');
  expect(text).not.toContain('SyntheticLegacyQuotedToken');
});
test('existing RoomBlock CREATED and REMOVED snapshots retain room and date history', async () => {
  const room = '00000000-0000-4000-8000-123456789012';
  await audit(null, {
    propertyId,
    roomId: room,
    startDate: '2030-01-01',
    endDate: '2030-01-03',
    reason: 'MAINTENANCE',
  });
  await audit(
    {
      propertyId,
      room_id: room,
      start_date: '2030-01-01',
      end_date: '2030-01-03',
      reason: 'MAINTENANCE',
    },
    null,
  );
  const response = await logs(await login());
  expect(response.status).toBe(200);
  const records = raw.parse(response.body).data;
  const created = records.find((row) => row.beforeJson === null)!;
  const removed = records.find((row) => row.afterJson === null)!;
  expect(JSON.parse(String(created.afterJson))).toMatchObject({
    roomId: room,
    startDate: '2030-01-01',
    endDate: '2030-01-03',
  });
  expect(JSON.parse(String(removed.beforeJson))).toMatchObject({
    room_id: room,
    start_date: '2030-01-01',
    end_date: '2030-01-03',
  });
});
test('known business amounts and bigint versions retain exact digits while phone notes stay masked', async () => {
  await audit(
    null,
    { fixedNightlyPrice: '123456789', version: '1234567890123', note: 'phone +849012345678' },
    'RatePlan',
  );
  const response = await logs(await login());
  expect(response.status).toBe(200);
  const snapshot: unknown = JSON.parse(String(raw.parse(response.body).data[0]!.afterJson));
  expect(snapshot).toMatchObject({ fixedNightlyPrice: '123456789', version: '1234567890123' });
  expect(JSON.stringify(response.body)).not.toContain('+849012345678');
});
test('SystemSetting history supports immutable logical key while retaining UUID filters and scope', async () => {
  const id = await audit(
    { key: 'refund.feeAmount', value: '0' },
    { key: 'refund.feeAmount', value: '1000' },
    'SystemSetting',
  );
  await audit(null, { key: 'other.setting', value: '0' }, 'SystemSetting');
  await audit(null, { key: 'refund.feeAmount', propertyId }, 'RoomBlock');
  const token = await login();
  const byKey = await logs(token, {
    entityType: 'SystemSetting',
    entityId: 'refund.feeAmount',
    limit: 1,
  });
  expect(byKey.status).toBe(200);
  expect(raw.parse(byKey.body).meta).toMatchObject({ total: 1, hasMore: false });
  expect(raw.parse(byKey.body).data[0]!.id).toBe(id);
  const record = raw
    .parse((await logs(token, { entityType: 'SystemSetting' })).body)
    .data.find((r) => r.id === id)!;
  expect(
    raw
      .parse((await logs(token, { entityId: String(record.entityId) })).body)
      .data.some((r) => r.id === id),
  ).toBe(true);
  expect(
    raw.parse(
      (
        await logs(await login('MANAGER'), {
          entityType: 'SystemSetting',
          entityId: 'refund.feeAmount',
        })
      ).body,
    ).meta.total,
  ).toBe(0);
});
