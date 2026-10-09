import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { test, expect } from 'vitest';
import {
  cancellationPolicySchema,
  listResponseSchema,
  ratePlanPublicSchema,
  ratePlanAdminSchema,
  errorBodySchema,
} from '@pinehill/contracts';
import { http, login, put } from './http-fixture.js';
import {
  policies,
  plans,
  rows,
  userId,
  propertyId,
  policyBody,
  effects,
  effectsBefore,
  version,
} from './seed.js';
const policyId = () => policies.get('CP-FLEX7')!;
const planId = () => plans.get('FLEX7')!;
const rawPage = z.object({ data: z.array(z.record(z.string(), z.unknown())) });

test('public listing only exposes sale terms and whole-stay eligible ACTIVE plans', async () => {
  const r = await http()
    .get('/api/v1/rate-plans')
    .query({ propertyId, checkIn: '2026-11-01', checkOut: '2026-11-03' });
  expect(r.status).toBe(200);
  const page = listResponseSchema(ratePlanPublicSchema).parse(r.body);
  expect(page.data.map((p) => p.code).sort()).toEqual(['FLEX7', 'NONREF']);
  expect(Object.keys(rawPage.parse(r.body).data.find((p) => p.code === 'FLEX7')!).sort()).toEqual([
    'code',
    'depositPercent',
    'freeCancelHours',
    'maxNights',
    'minNights',
    'name',
  ]);
  expect(page.data.find((p) => p.code === 'FLEX7')!.freeCancelHours).toBe(168);
  const long = await http()
    .get('/api/v1/rate-plans')
    .query({ checkIn: '2026-11-01', checkOut: '2026-11-15' });
  expect(long.status).toBe(200);
  expect(listResponseSchema(ratePlanPublicSchema).parse(long.body).data).toHaveLength(4);
});
test('inactive plans, policies and properties do not appear in public offers', async () => {
  await rows("UPDATE rate_plans SET status='INACTIVE' WHERE id=$1", [planId()]);
  await rows("UPDATE cancellation_policies SET status='INACTIVE' WHERE id=$1", [
    policies.get('CP-NONREF'),
  ]);
  const r = await http().get('/api/v1/rate-plans');
  expect(r.status).toBe(200);
  expect(
    listResponseSchema(ratePlanPublicSchema)
      .parse(r.body)
      .data.map((p) => p.code)
      .sort(),
  ).toEqual(['LONGSTAY14', 'SAVER3']);
  await rows("UPDATE properties SET status='INACTIVE' WHERE id=$1", [propertyId]);
  const closed = await http().get('/api/v1/rate-plans').query({ propertyId });
  expect(closed.status).toBe(200);
  expect(listResponseSchema(ratePlanPublicSchema).parse(closed.body).data).toEqual([]);
});
test.each([
  { checkIn: '2026-02-30', checkOut: '2026-03-03' },
  { checkIn: '2026-11-01' },
  { checkIn: '2026-11-03', checkOut: '2026-11-01' },
  { propertyId: 'not-a-uuid' },
  { limit: 0 },
])('invalid public query is rejected: %j', async (query) => {
  expect((await http().get('/api/v1/rate-plans').query(query)).status).toBe(400);
});
test('public stable pagination never duplicates a plan and rejects invalid cursors', async () => {
  const seen: string[] = [];
  let cursor: string | undefined;
  for (let i = 0; i < 4; i++) {
    const r = await http()
      .get('/api/v1/rate-plans')
      .query({ limit: 1, ...(cursor ? { cursor } : {}) });
    expect(r.status).toBe(200);
    const page = listResponseSchema(ratePlanPublicSchema).parse(r.body);
    expect(page.meta.total).toBe(4);
    seen.push(page.data[0]!.code);
    cursor = page.meta.nextCursor ?? undefined;
    expect(page.meta.hasMore).toBe(i < 3);
  }
  expect(new Set(seen).size).toBe(4);
  expect((await http().get('/api/v1/rate-plans').query({ cursor: 'bad' })).status).toBe(400);
});
test('internal list routes require authentication and OWNER gets faithful config projections', async () => {
  for (const path of ['/rate-plans/admin', '/cancellation-policies'])
    expect((await http().get(`/api/v1${path}`)).status).toBe(401);
  const token = await login();
  const rates = await http()
    .get('/api/v1/rate-plans/admin')
    .set('Authorization', `Bearer ${token}`);
  expect(rates.status).toBe(200);
  expect(listResponseSchema(ratePlanAdminSchema).parse(rates.body).data).toHaveLength(4);
  const p = await http()
    .get('/api/v1/cancellation-policies')
    .set('Authorization', `Bearer ${token}`);
  expect(p.status).toBe(200);
  expect(listResponseSchema(cancellationPolicySchema).parse(p.body).data).toHaveLength(4);
  const flex = listResponseSchema(cancellationPolicySchema)
    .parse(p.body)
    .data.find((p) => p.id === policyId())!;
  expect(flex.tiers.at(-1)).toMatchObject({
    hoursBeforeCheckIn: 0,
    offsetHours: -1,
    chargeFirstNight: true,
  });
  expect(
    (
      await http()
        .get('/api/v1/cancellation-policies')
        .query({ status: 'UNKNOWN' })
        .set('Authorization', `Bearer ${token}`)
    ).status,
  ).toBe(400);
});
test.each(['SYSADMIN', 'HOUSEKEEPING', 'FRONT_DESK', 'RESERVATION_AGENT', 'MANAGER', 'ACCOUNTANT'])(
  'all internal config operations deny %s and body-spoofed OWNER',
  async (role) => {
    const token = await login(role);
    for (const path of ['/rate-plans/admin', '/cancellation-policies'])
      expect(
        (await http().get(`/api/v1${path}`).set('Authorization', `Bearer ${token}`)).status,
      ).toBe(403);
    expect((await put(policyId(), { ...policyBody(), role: 'OWNER' }, { token })).status).toBe(403);
    expect(
      (await put(planId(), { depositPercent: 40, reason: 'Synthetic' }, { token, kind: 'plan' }))
        .status,
    ).toBe(403);
    expect(await effects()).toEqual(effectsBefore);
  },
);
test('OWNER does not require a property-scope row for global config', async () => {
  await rows('DELETE FROM user_property_scopes WHERE user_id=$1', [userId]);
  const r = await put(planId(), { depositPercent: 40, reason: 'Synthetic' }, { kind: 'plan' });
  expect(r.status).toBe(204);
});
test('full policy replacement increments version once and preserves omitted first-night flags', async () => {
  const before = await version(policyId());
  const input = policyBody();
  input.tiers[1]!.refundPercent = 25;
  const r = await put(policyId(), input);
  expect(r.status).toBe(200);
  const p = cancellationPolicySchema.parse(r.body);
  expect(p.version).toBe(Number(before.replaceAll('"', '')) + 1);
  expect(p.tiers[1]!.refundPercent).toBe(25);
  expect(p.tiers.at(-1)).toMatchObject({ offsetHours: -1, chargeFirstNight: true });
  expect(await effects()).toEqual({
    audit: effectsBefore.audit + 1,
    outbox: effectsBefore.outbox + 1,
  });
  const stored = await rows(
    'SELECT offset_hours,charge_first_night FROM cancellation_tiers WHERE policy_id=$1 ORDER BY sort_order',
    [policyId()],
  );
  expect(stored.map((t) => t.offset_hours)).toEqual([168, 72, 24, -1]);
  expect(stored.at(-1)!.charge_first_night).toBe(true);
});
test('canonical metadata permits an explicit zero-hour threshold plus a separate catch-all', async () => {
  const input = {
    ...policyBody(),
    tiers: [
      { hoursBeforeCheckIn: 0, offsetHours: 0, refundPercent: 50, chargeFirstNight: false },
      { hoursBeforeCheckIn: 0, offsetHours: -1, refundPercent: 0, chargeFirstNight: true },
    ],
  };
  const r = await put(policyId(), input);
  expect(r.status).toBe(200);
  expect(cancellationPolicySchema.parse(r.body).tiers.map((t) => t.offsetHours)).toEqual([0, -1]);
});
test('rate update preserves unexposed conditions, validates merged min/max, and can stop sales', async () => {
  const id = plans.get('NONREF')!;
  const before = await version(id, 'plan');
  const bad = await put(id, { minNights: 366, reason: 'Synthetic' }, { kind: 'plan' });
  expect(bad.status).toBe(422);
  expect(errorBodySchema.parse(bad.body).code).toBe('E_RATE_CONFIGURATION_INVALID');
  const r = await put(
    id,
    { depositPercent: 75, status: 'INACTIVE', reason: 'Synthetic' },
    { kind: 'plan' },
  );
  expect(r.status).toBe(204);
  const row = (
    await rows(
      'SELECT version,deposit_percent,status,reschedule_fee_pct FROM rate_plans WHERE id=$1',
      [id],
    )
  )[0]!;
  expect(Number(row.version)).toBe(Number(before.replaceAll('"', '')) + 1);
  expect(Number(row.deposit_percent)).toBe(75);
  expect(row.status).toBe('INACTIVE');
  expect(Number(row.reschedule_fee_pct)).toBe(10);
});
test('missing or inactive referenced policies are rejected without changing the rate', async () => {
  for (const id of [randomUUID(), policies.get('CP-NONREF')!]) {
    await rows("UPDATE cancellation_policies SET status='INACTIVE' WHERE id=$1", [id]);
    expect(
      (await put(planId(), { cancellationPolicyId: id, reason: 'Synthetic' }, { kind: 'plan' }))
        .status,
    ).toBe(422);
  }
  expect(await effects()).toEqual(effectsBefore);
});
test('preconditions distinguish missing428, stale412 and malformed412; errors have no effects', async () => {
  const token = await login();
  const noHeader = await http()
    .put(`/api/v1/cancellation-policies/${policyId()}`)
    .set('Authorization', `Bearer ${token}`)
    .set('Idempotency-Key', randomUUID())
    .send(policyBody());
  expect(noHeader.status).toBe(428);
  expect(errorBodySchema.parse(noHeader.body).code).toBe('E_GEN_PRECONDITION_REQUIRED');
  for (const match of ['"0"', '*', 'W/"1"', '1', '"1","2"'])
    expect((await put(policyId(), policyBody(), { token, match })).status).toBe(412);
  expect(await effects()).toEqual(effectsBefore);
});
test('missing key and nonexistent targets reject before durable claims', async () => {
  const token = await login();
  const noKey = await http()
    .put(`/api/v1/cancellation-policies/${policyId()}`)
    .set('Authorization', `Bearer ${token}`)
    .set('If-Match', await version(policyId()))
    .send(policyBody());
  expect(noKey.status).toBe(400);
  expect((await put(randomUUID(), policyBody(), { token, match: '"1"' })).status).toBe(404);
  expect(Number((await rows('SELECT count(*) AS n FROM idempotency_keys'))[0]!.n)).toBe(0);
});
test('policy replay accepts its committed old version, changed raw payload conflicts, revoked role denies replay', async () => {
  const token = await login(),
    key = randomUUID(),
    match = await version(policyId());
  const body = { ...policyBody(), reason: 'Repair tel0900000057' };
  const first = await put(policyId(), body, { token, key, match });
  expect(first.status).toBe(200);
  const replay = await put(policyId(), body, { token, key, match });
  expect(replay.status).toBe(200);
  expect(replay.body).toEqual(first.body);
  expect(replay.headers['idempotency-replayed']).toBe('true');
  const changed = await put(
    policyId(),
    { ...body, reason: 'Repair tel0910000057' },
    { token, key, match },
  );
  expect(changed.status).toBe(409);
  expect(errorBodySchema.parse(changed.body).code).toBe('E_SYS_IDEMPOTENCY_KEY_REUSED');
  await rows("UPDATE users SET role='MANAGER' WHERE id=$1", [userId]);
  expect((await put(policyId(), body, { token, key, match })).status).toBe(403);
  expect(await effects()).toEqual({
    audit: effectsBefore.audit + 1,
    outbox: effectsBefore.outbox + 1,
  });
});
test('rate204 response replays without a second update or event', async () => {
  const token = await login(),
    key = randomUUID(),
    match = await version(planId(), 'plan'),
    body = { depositPercent: 40, reason: 'Synthetic' };
  for (let i = 0; i < 2; i++)
    expect((await put(planId(), body, { token, key, match, kind: 'plan' })).status).toBe(204);
  expect(await effects()).toEqual({
    audit: effectsBefore.audit + 1,
    outbox: effectsBefore.outbox + 1,
  });
});
test('audit before/after retains full old tier data; operational reason and labels mask identifiers', async () => {
  const body = {
    ...policyBody(),
    reason: 'Repair +84 900 000 057, synthetic.guest@example.test',
    tiers: policyBody().tiers.map((t) => ({ ...t, label: 'Synthetic CCCD012345678957' })),
  };
  const r = await put(policyId(), body);
  expect(r.status).toBe(200);
  expect(JSON.stringify(r.body)).not.toContain('012345678957');
  const a = (
    await rows(
      "SELECT before_json,after_json,reason FROM audit_logs WHERE entity_id=$1 AND action='CANCELLATION_POLICY_UPDATED' ORDER BY chain_seq DESC LIMIT 1",
      [policyId()],
    )
  )[0]!;
  const serialized = JSON.stringify(a);
  expect(serialized).not.toContain('900 000 057');
  expect(serialized).not.toContain('synthetic.guest@example.test');
  expect(serialized).not.toContain('012345678957');
  const old = z
    .object({
      id: z.uuid(),
      tiers: z.array(
        z.object({ id: z.uuid(), offsetHours: z.number(), chargeFirstNight: z.boolean() }),
      ),
    })
    .parse(a.before_json);
  expect(old.id).toBe(policyId());
  expect(old.tiers.find((t) => t.offsetHours === -1)).toMatchObject({
    offsetHours: -1,
    chargeFirstNight: true,
  });
});
test('all snapshot write methods remain absent even for OWNER', async () => {
  const token = await login();
  for (const method of ['put', 'patch', 'delete'] as const) {
    const r = await http()
      [method](`/api/v1/bookings/${randomUUID()}/price-snapshot`)
      .set('Authorization', `Bearer ${token}`)
      .send({ policySnapshotJson: {} });
    expect(r.status).toBe(404);
  }
});
