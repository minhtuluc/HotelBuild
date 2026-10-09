import { test, expect } from 'vitest';
import { errorBodySchema, cancellationPolicySchema } from '@pinehill/contracts';
import { put } from './http-fixture.js';
import { policies, policyBody, effects, effectsBefore, rows } from './seed.js';

const cases = [
  {
    name: 'offset above PostgreSQL int32',
    tiers: [
      { hoursBeforeCheckIn: 2147483648, refundPercent: 100 },
      { hoursBeforeCheckIn: 0, refundPercent: 0, chargeFirstNight: false },
    ],
    index: 0,
  },
  { name: 'missing catch-all', tiers: [{ hoursBeforeCheckIn: 72, refundPercent: 50 }], index: 0 },
  {
    name: 'duplicate catch-all',
    tiers: [
      { hoursBeforeCheckIn: 0, refundPercent: 0 },
      { hoursBeforeCheckIn: 0, refundPercent: 0 },
    ],
    index: 1,
  },
  {
    name: 'duplicate offset',
    tiers: [
      { hoursBeforeCheckIn: 72, refundPercent: 50 },
      { hoursBeforeCheckIn: 72, refundPercent: 25 },
      { hoursBeforeCheckIn: 0, refundPercent: 0 },
    ],
    index: 1,
  },
  {
    name: 'fractional refund',
    tiers: [
      { hoursBeforeCheckIn: 72, refundPercent: 50.5 },
      { hoursBeforeCheckIn: 0, refundPercent: 0 },
    ],
    index: 0,
  },
  {
    name: 'refund above100',
    tiers: [
      { hoursBeforeCheckIn: 72, refundPercent: 101 },
      { hoursBeforeCheckIn: 0, refundPercent: 0 },
    ],
    index: 0,
  },
  { name: 'negative refund', tiers: [{ hoursBeforeCheckIn: 0, refundPercent: -1 }], index: 0 },
  {
    name: 'increasing refund',
    tiers: [
      { hoursBeforeCheckIn: 72, refundPercent: 25 },
      { hoursBeforeCheckIn: 24, refundPercent: 50 },
      { hoursBeforeCheckIn: 0, refundPercent: 0 },
    ],
    index: 1,
  },
  {
    name: 'charge with refund',
    tiers: [{ hoursBeforeCheckIn: 0, refundPercent: 50, chargeFirstNight: true }],
    index: 0,
  },
  {
    name: 'negative legacy threshold',
    tiers: [{ hoursBeforeCheckIn: -2, refundPercent: 0 }],
    index: 0,
  },
  {
    name: 'contradictory canonical offset',
    tiers: [{ hoursBeforeCheckIn: 72, offsetHours: -1, refundPercent: 0 }],
    index: 0,
  },
  {
    name: 'catch-all not last',
    tiers: [
      { hoursBeforeCheckIn: 0, refundPercent: 0 },
      { hoursBeforeCheckIn: 72, refundPercent: 50 },
    ],
    index: 0,
  },
  {
    name: 'unordered thresholds',
    tiers: [
      { hoursBeforeCheckIn: 24, refundPercent: 0 },
      { hoursBeforeCheckIn: 72, refundPercent: 50 },
      { hoursBeforeCheckIn: 0, refundPercent: 0 },
    ],
    index: 1,
  },
];
test.each(cases)(
  'policy rejects $name with safe indexed details and no side effects',
  async ({ tiers, index }) => {
    const r = await put(policies.get('CP-FLEX7')!, { ...policyBody(), tiers });
    expect(r.status).toBe(422);
    const e = errorBodySchema.parse(r.body);
    expect(e.code).toBe('E_RATE_CONFIGURATION_INVALID');
    expect(e.details?.some((d) => d.field.startsWith(`tiers[${index}].`))).toBe(true);
    expect(await effects()).toEqual(effectsBefore);
  },
);
test('maximum int32 offset remains valid and is stored exactly', async () => {
  const id = policies.get('CP-FLEX7')!;
  const r = await put(id, {
    ...policyBody(),
    tiers: [
      { hoursBeforeCheckIn: 2147483647, refundPercent: 100 },
      { hoursBeforeCheckIn: 0, refundPercent: 0 },
    ],
  });
  expect(r.status).toBe(200);
  expect(cancellationPolicySchema.parse(r.body).tiers[0]?.offsetHours).toBe(2147483647);
  expect(
    (
      await rows(
        'SELECT offset_hours FROM cancellation_tiers WHERE policy_id=$1 AND sort_order=1',
        [id],
      )
    )[0]?.offset_hours,
  ).toBe(2147483647);
});
test('zero-hour legacy sentinel rejects a positive early-checkout refund without writes', async () => {
  const r = await put(policies.get('CP-NONREF')!, {
    ...policyBody(),
    tiers: [{ hoursBeforeCheckIn: 0, refundPercent: 0 }],
    earlyCheckoutFreeHours: 0,
    earlyCheckoutRefundPct: 50,
  });
  expect(r.status).toBe(422);
  expect(errorBodySchema.parse(r.body).details).toContainEqual({
    field: 'earlyCheckoutRefundPct',
    issue: 'REFUND_WITHOUT_THRESHOLD',
  });
  expect(await effects()).toEqual(effectsBefore);
});
test('zero-hour and zero-refund legacy round trip preserves canonical null', async () => {
  const id = policies.get('CP-NONREF')!;
  const r = await put(id, {
    ...policyBody(),
    tiers: [{ hoursBeforeCheckIn: 0, refundPercent: 0 }],
    earlyCheckoutFreeHours: 0,
    earlyCheckoutRefundPct: 0,
  });
  expect(r.status).toBe(200);
  expect(cancellationPolicySchema.parse(r.body).earlyCheckoutFreeHours).toBe(0);
  expect(
    (await rows('SELECT early_checkout_free_hours FROM cancellation_policies WHERE id=$1', [id]))[0]
      ?.early_checkout_free_hours,
  ).toBeNull();
});
test('legacy omitted first-night flag never silently converts an existing charge into a refund', async () => {
  const r = await put(policies.get('CP-FLEX7')!, {
    ...policyBody(),
    tiers: [{ hoursBeforeCheckIn: 0, refundPercent: 50 }],
  });
  expect(r.status).toBe(422);
  expect(errorBodySchema.parse(r.body).details).toContainEqual({
    field: 'tiers[0].chargeFirstNight',
    issue: 'REFUND_WITH_FIRST_NIGHT_CHARGE',
  });
});
test('explicit false permits replacing the legacy first-night charging rule without ambiguity', async () => {
  const r = await put(policies.get('CP-FLEX7')!, {
    ...policyBody(),
    tiers: [{ hoursBeforeCheckIn: 0, refundPercent: 50, chargeFirstNight: false }],
  });
  expect(r.status).toBe(200);
  expect(cancellationPolicySchema.parse(r.body).tiers[0]).toMatchObject({
    offsetHours: -1,
    refundPercent: 50,
    chargeFirstNight: false,
  });
});
