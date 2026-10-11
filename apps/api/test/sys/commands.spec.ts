import { randomUUID } from 'node:crypto';
import { test, expect } from 'vitest';
import { put, login, rows, userId, http } from './fixture.js';
const state = async () =>
  (
    await rows("SELECT value,version,updated_by FROM system_settings WHERE key='refund.feeAmount'")
  )[0];
const audits = async () =>
  rows(
    "SELECT before_json,after_json,reason FROM audit_logs WHERE entity_id=(SELECT id FROM system_settings WHERE key='refund.feeAmount')",
  );
test('OWNER command returns204/version ETag and durable replay changes DB/audit exactly once', async () => {
  const token = await login(),
    key = randomUUID();
  const first = await put(token, '1000', 'refund.feeAmount', '"1"', key);
  expect(first.status).toBe(204);
  expect(first.text).toBe('');
  expect(first.headers.etag).toBe('"2"');
  expect(first.headers['cache-control']).toBe('no-store');
  const replay = await put(token, '1000', 'refund.feeAmount', '"1"', key);
  expect(replay.status).toBe(204);
  expect(replay.headers.etag).toBe('"2"');
  expect(replay.headers['idempotency-replayed']).toBe('true');
  expect(replay.headers['access-control-expose-headers']).toBe('ETag');
  expect(await state()).toEqual({ value: '1000', version: '2', updated_by: userId });
  const records = await audits();
  expect(records).toHaveLength(1);
  expect(records[0]!.before_json).toMatchObject({ value: '0' });
  expect(records[0]!.after_json).toMatchObject({ value: '1000' });
});
test('missing malformed or stale IfMatch and missing keys do not write', async () => {
  const token = await login();
  expect((await put(token, '1000', 'refund.feeAmount', null)).status).toBe(428);
  for (const version of ['1', 'W/"1"', '"0"', '"2"', '"9007199254740992"'])
    expect((await put(token, '1000', 'refund.feeAmount', version)).status).toBe(412);
  expect((await put(token, '1000', 'missing.setting')).status).toBe(404);
  expect(await state()).toMatchObject({ value: '0', version: '1' });
  expect(await audits()).toHaveLength(0);
});
test('typed validation accepts exact boolean, structuredJSON, decimal number and string', async () => {
  const token = await login();
  for (const [key, value] of [
    ['test.enabled', 'true'],
    ['test.json', '{"limit":2}'],
    ['test.label', 'Synthetic new label'],
  ])
    expect((await put(token, value, key)).status).toBe(204);
  await rows(
    "INSERT INTO system_settings(key,value,value_type) VALUES('pricing.weekendMultiplier','1.20','NUMBER')",
  );
  expect((await put(token, '1.25', 'pricing.weekendMultiplier')).status).toBe(204);
});
for (const value of [
  'NaN',
  'Infinity',
  '1e999',
  '0x10',
  '1000abc',
  '-1',
  '1.5',
  '9007199254740992',
])
  test(`fee rejects unsafe typed value ${value}`, async () => {
    expect((await put(await login(), value)).status).toBe(400);
    expect(await state()).toMatchObject({ value: '0', version: '1' });
  });
test('boolean, JSON, reason and unknown fields cannot bypass strict body validation', async () => {
  const token = await login();
  expect((await put(token, 'yes', 'test.enabled')).status).toBe(400);
  expect((await put(token, '{bad', 'test.json')).status).toBe(400);
  for (const body of [
    { value: '1000', reason: ' ' },
    { value: '1000', reason: 'Synthetic', role: 'OWNER' },
    { value: 1000, reason: 'Synthetic' },
  ]) {
    const result = await http()
      .put('/api/v1/system-settings/refund.feeAmount')
      .set('Authorization', `Bearer ${token}`)
      .set('If-Match', '"1"')
      .set('Idempotency-Key', randomUUID())
      .send(body);
    expect(result.status).toBe(400);
  }
});
test('audit storage failure rolls back setting/version and cannot cache a successful response', async () => {
  const token = await login(),
    key = randomUUID();
  await rows(
    `CREATE FUNCTION hb036_fail() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action='SYSTEM_SETTING_UPDATED' THEN RAISE EXCEPTION 'Synthetic audit failure'; END IF; RETURN NEW; END $$`,
  );
  await rows(
    'CREATE TRIGGER hb036_fail BEFORE INSERT ON audit_logs FOR EACH ROW EXECUTE FUNCTION hb036_fail()',
  );
  try {
    expect((await put(token, '1000', 'refund.feeAmount', '"1"', key)).status).toBe(500);
  } finally {
    await rows('DROP TRIGGER hb036_fail ON audit_logs');
    await rows('DROP FUNCTION hb036_fail()');
  }
  expect(await state()).toMatchObject({ value: '0', version: '1' });
  expect(await audits()).toHaveLength(0);
  expect((await put(token, '1000', 'refund.feeAmount', '"1"', key)).status).toBe(204);
  expect(await audits()).toHaveLength(1);
});
test('revoked OWNER cannot replay a previous mutation, and same-key different body conflicts', async () => {
  const token = await login(),
    key = randomUUID();
  expect((await put(token, '1000', 'refund.feeAmount', '"1"', key)).status).toBe(204);
  expect((await put(token, '2000', 'refund.feeAmount', '"1"', key)).status).toBe(409);
  await rows("UPDATE users SET role='MANAGER' WHERE id=$1", [userId]);
  expect((await put(token, '1000', 'refund.feeAmount', '"1"', key)).status).toBe(403);
  expect(await audits()).toHaveLength(1);
});
for (const role of [
  'HOUSEKEEPING',
  'FRONT_DESK',
  'RESERVATION_AGENT',
  'ACCOUNTANT',
  'MANAGER',
  'SYSADMIN',
])
  test(`${role} cannot change a system setting`, async () => {
    expect((await put(await login(role))).status).toBe(403);
    expect(await state()).toMatchObject({ value: '0', version: '1' });
  });
test('same-version concurrent commands commit one setting version and one audit', async () => {
  const token = await login();
  const results = await Promise.all([put(token, '1000'), put(token, '2000')]);
  expect(results.map((r) => r.status).sort()).toEqual([204, 412]);
  expect((await state())!.version).toBe('2');
  expect(await audits()).toHaveLength(1);
});
test('setting audit sanitizes legacy and submitted JSON secrets before durable storage', async () => {
  await rows(`UPDATE system_settings SET value=$1 WHERE key='test.json'`, [
    JSON.stringify({ limit: 1, password: 'SyntheticOldSecret' }),
  ]);
  const response = await put(
    await login(),
    JSON.stringify({
      limit: 2,
      accessToken: 'SyntheticNewSecret',
      email: 'synthetic@example.invalid',
    }),
    'test.json',
    '"2"',
  );
  expect(response.status).toBe(204);
  const records = await rows(
    "SELECT before_json,after_json FROM audit_logs WHERE entity_id=(SELECT id FROM system_settings WHERE key='test.json')",
  );
  expect(records).toHaveLength(1);
  const text = JSON.stringify(records);
  for (const secret of ['SyntheticOldSecret', 'SyntheticNewSecret', 'synthetic@example.invalid'])
    expect(text).not.toContain(secret);
  expect(records[0]!.before_json).toMatchObject({ value: '{"limit":1}' });
  expect(records[0]!.after_json).toMatchObject({ value: '{"limit":2}' });
});
test('existing numeric business parameters retain percent, VND and interval bounds', async () => {
  const token = await login();
  for (const [key, bad] of [
    ['pricing.maxDiscountPct', '31'],
    ['checkInDebtPct', '101'],
    ['deal.threshold.minor', '1.5'],
    ['overbooking.transportSupportCap', '-1'],
    ['job.hold.releaseIntervalSeconds', '0'],
    ['channel.lowInventoryThreshold', '-1'],
    ['pricing.weekendMultiplier', '0'],
  ]) {
    await rows("INSERT INTO system_settings(key,value,value_type) VALUES($1,'1','NUMBER')", [key]);
    expect((await put(token, bad, key)).status).toBe(400);
    expect(
      (await rows('SELECT version FROM system_settings WHERE key=$1', [key]))[0]!.version,
    ).toBe('1');
  }
});
test('secret-named setting values are never copied into audit snapshots', async () => {
  await rows(
    "INSERT INTO system_settings(key,value,value_type) VALUES('credentials.password','SyntheticOldCredential','STRING')",
  );
  expect((await put(await login(), 'SyntheticNewCredential', 'credentials.password')).status).toBe(
    204,
  );
  const records = await rows(
    "SELECT before_json,after_json FROM audit_logs WHERE entity_id=(SELECT id FROM system_settings WHERE key='credentials.password')",
  );
  expect(records).toHaveLength(1);
  const text = JSON.stringify(records);
  expect(text).not.toContain('SyntheticOldCredential');
  expect(text).not.toContain('SyntheticNewCredential');
  expect(records[0]!.after_json).toMatchObject({ value: '[REDACTED]' });
});
