import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { expect, test } from 'vitest';
import { channelSummarySchema, listResponseSchema, errorBodySchema } from '@pinehill/contracts';
import { http, login } from '../../room-blocks/http-fixture.js';
import { rows, userId } from '../../room-blocks/inventory-seed.js';
const schema = listResponseSchema(channelSummarySchema);
const get = (token: string, query: Record<string, unknown> = {}) =>
  http().get('/api/v1/channels').set('Authorization', `Bearer ${token}`).query(query);

for (const role of [
  'OWNER',
  'MANAGER',
  'FRONT_DESK',
  'RESERVATION_AGENT',
  'ACCOUNTANT',
  'HOUSEKEEPING',
  'SYSADMIN',
])
  test(`published channel defaults: ${role} has explicit read permission`, async () => {
    const token = await login(role);
    const response = await get(token);
    expect(response.status).toBe(['MANAGER', 'OWNER'].includes(role) ? 200 : 403);
    if (response.status === 200) expect(schema.parse(response.body).data).toHaveLength(7);
  });

test('unauthenticated channel configuration is never public', async () => {
  expect((await http().get('/api/v1/channels')).status).toBe(401);
});
test('MANAGER reads global chain defaults without a property scope or resolving property overrides', async () => {
  const token = await login();
  await rows('DELETE FROM user_property_scopes WHERE user_id=$1', [userId]);
  const id = String(
    (
      await rows(
        "UPDATE channels SET multiplier=0.315,commission_pct=15.25,hold_minutes=45,overbook_allowed=true,last_sync_error='synthetic-private-channel' WHERE code='OTA_BOOKING' RETURNING id",
      )
    )[0]!.id,
  );
  const response = await get(token);
  expect(response.status).toBe(200);
  expect(response.headers['cache-control']).toBe('no-store');
  const dto = schema.parse(response.body).data.find((row) => row.id === id);
  expect(dto).toEqual({
    id,
    code: 'OTA_BOOKING',
    name: 'OTA_BOOKING',
    multiplier: 0.315,
    commissionPct: 15.25,
    holdMinutes: 45,
    overbookAllowed: true,
    version: 2,
  });
  expect(JSON.stringify(response.body)).not.toContain('synthetic-private-channel');
  expect(
    Object.keys(
      z.object({ data: z.array(z.record(z.string(), z.unknown())) }).parse(response.body).data[0]!,
    ).sort(),
  ).toEqual(
    [
      'id',
      'code',
      'name',
      'multiplier',
      'commissionPct',
      'holdMinutes',
      'overbookAllowed',
      'version',
    ].sort(),
  );
});
test('UUID cursor pagination exhausts the catalogue once and preserves total and actual page limit', async () => {
  const token = await login();
  const ids: string[] = [];
  let cursor: string | undefined;
  for (let i = 0; i < 4; i++) {
    const result = await get(token, { limit: 2, ...(cursor ? { cursor } : {}) });
    expect(result.status).toBe(200);
    const page = schema.parse(result.body);
    expect(page.meta.total).toBe(7);
    expect(page.meta.limit).toBe(2);
    expect(page.data).toHaveLength(i === 3 ? 1 : 2);
    ids.push(...page.data.map((row) => row.id));
    expect(page.meta.hasMore).toBe(i < 3);
    cursor = page.meta.nextCursor ?? undefined;
  }
  expect(cursor).toBeUndefined();
  expect(new Set(ids).size).toBe(7);
  expect(ids).toEqual([...ids].sort());
});
for (const query of [
  { limit: 0 },
  { limit: 101 },
  { limit: 'invalid' },
  { cursor: 'not-a-uuid' },
  { cursor: '' },
  { propertyId: randomUUID() },
])
  test(`invalid/unsupported published query ${JSON.stringify(query)} is validation400`, async () => {
    const response = await get(await login(), query);
    expect(response.status).toBe(400);
    expect(errorBodySchema.parse(response.body).code).toBe('E_GEN_VALIDATION_FAILED');
  });
test('GET changes no channel/version/audit/outbox/claim data', async () => {
  const token = await login();
  const facts = async () => ({
    channels: await rows('SELECT id,version,updated_at FROM channels ORDER BY id'),
    audit: await rows('SELECT id FROM audit_logs ORDER BY id'),
    outbox: await rows('SELECT id FROM outbox_events ORDER BY id'),
    claims: await rows('SELECT id FROM idempotency_keys ORDER BY id'),
  });
  const before = await facts();
  expect((await get(token)).status).toBe(200);
  expect(await facts()).toEqual(before);
});
test('unsafe bigint channel version never rounds into a usable optimistic token', async () => {
  const token = await login();
  // INSERT sets a valid bigint boundary without disabling the normal update/version trigger.
  const id = String((await rows("DELETE FROM channels WHERE code='WEB' RETURNING id"))[0]!.id);
  try {
    await rows(
      "INSERT INTO channels(id,code,name,multiplier,version) VALUES($1,'WEB','WEB',1,9007199254740993)",
      [id],
    );
    expect(
      (await rows('SELECT version::text AS value FROM channels WHERE id=$1', [id]))[0]!.value,
    ).toBe('9007199254740993');
    const response = await get(token);
    expect(response.status).toBe(500);
    expect(JSON.stringify(response.body)).not.toContain('synthetic-private-channel');
  } finally {
    await rows('DELETE FROM channels WHERE id=$1', [id]);
    await rows("INSERT INTO channels(id,code,name,multiplier) VALUES($1,'WEB','WEB',1)", [id]);
  }
});
