import { expect, it } from 'vitest';
import { quotePrice } from '../../src/pricing/index.js';
import type { CalendarRate, PricingInput } from '../../src/pricing/index.js';
import { input, promo } from './fixtures.js';
function quote(i: PricingInput) {
  const r = quotePrice(i);
  if (!r.ok) throw Error(JSON.stringify(r.error));
  return r.value;
}
it('calendar priority channel creation id and rate plan matching', () => {
  const i = { ...input(), seasons: [] };
  const row: CalendarRate = {
    id: 'base',
    roomTypeId: 'STD',
    from: i.checkIn,
    to: i.checkIn,
    source: 'BASE',
    price: 700000,
    createdAt: 10,
  };
  const plan = {
    ...row,
    id: 'plan',
    source: 'RATE_PLAN' as const,
    ratePlanId: 'FLEX7',
    price: 710000,
  };
  expect(quote({ ...i, calendar: [row] }).total).toBe(700000);
  expect(
    quote({ ...i, calendar: [row], ratePlan: { ...i.ratePlan, fixedNightlyPrice: 720000 } }).total,
  ).toBe(720000);
  expect(
    quote({ ...i, calendar: [row, plan], ratePlan: { ...i.ratePlan, fixedNightlyPrice: 720000 } })
      .total,
  ).toBe(710000);
  expect(quote({ ...i, calendar: [{ ...plan, ratePlanId: 'OTHER' }] }).total).toBe(650000);
  const override = { ...row, source: 'OVERRIDE' as const };
  expect(
    quote({
      ...i,
      calendar: [
        { ...override, id: 'z', price: 730000, createdAt: 1 },
        { ...override, id: 'a', price: 740000, createdAt: 1 },
      ],
    }).total,
  ).toBe(740000);
  expect(
    quote({
      ...i,
      calendar: [
        { ...override, id: 'early', price: 730000, createdAt: 0 },
        { ...override, id: 'channel', channelCode: 'WEB', price: 740000, createdAt: 10 },
      ],
    }).total,
  ).toBe(740000);
  expect(
    quote({
      ...i,
      calendar: [
        { ...override, id: 'early', price: 730000, createdAt: 0 },
        { ...override, id: 'late', price: 740000, createdAt: 10 },
      ],
    }).total,
  ).toBe(730000);
  expect(
    quote({
      ...i,
      calendar: [
        { ...row, propertyId: 'OTHER' },
        { ...row, id: 'other-channel', channelCode: 'AGENCY' },
      ],
    }).total,
  ).toBe(650000);
});
it('channel effective date newest property scope and commission threshold', () => {
  const i = { ...input(), seasons: [], channelCode: 'OTA_BOOKING' };
  const setting = {
    id: 'a',
    propertyId: 'CS',
    channelCode: 'OTA_BOOKING',
    effectiveFrom: '2026-01-01',
    multiplier: '1.3',
    commissionPercent: '18',
  };
  const q = quote({
    ...i,
    channelSettings: [
      setting,
      { ...setting, id: 'b', effectiveFrom: '2026-02-01', multiplier: '1.4' },
      { ...setting, id: 'c', propertyId: 'OTHER', multiplier: '2' },
    ],
  });
  expect(q.total).toBe(910000);
  expect(q.nights[0]?.channelSettingId).toBe('b');
  expect(quotePrice({ ...i, channelSettings: [{ ...setting, multiplier: '1.2' }] }).ok).toBe(false);
  expect(quotePrice({ ...i, channelSettings: [setting, { ...setting, id: 'b' }] }).ok).toBe(false);
});
it('season scope and unresolved equal creation reject rather than UUID tie', () => {
  const i = input();
  const s = i.seasons[0]!;
  expect(quote({ ...i, seasons: [{ ...s, propertyId: 'OTHER' }] }).total).toBe(650000);
  expect(quotePrice({ ...i, seasons: [s, { ...s, id: 'same' }] }).ok).toBe(false);
});
it('occupancy newest snapshot exact boundary includes overbooking and no floating division', () => {
  const i = {
    ...input('STD', '2026-06-15', '2026-06-16'),
    occupancy: [
      {
        id: 'old',
        propertyId: 'CS',
        date: '2026-06-15',
        demand: 79,
        supply: 100,
        capturedAt: 999999,
      },
      {
        id: 'new',
        propertyId: 'CS',
        date: '2026-06-15',
        demand: 120,
        supply: 100,
        capturedAt: 1000000,
      },
    ],
  };
  expect(quote(i).total).toBe(1138000);
  expect(
    quote({
      ...i,
      occupancy: [
        { ...i.occupancy[0]!, id: 'b' },
        { ...i.occupancy[0]!, id: 'a' },
      ],
    }).nights[0]?.occupancySnapshotId,
  ).toBe('a');
});
it('tiny rational just above and below rounding boundary keeps precision', () => {
  const i = {
    ...input(),
    seasons: [],
    channels: [{ code: 'WEB', multiplier: '1.000000000000000001', commissionPercent: '0' }],
  };
  const q = quote(i);
  expect(q.total).toBe(651000);
  expect(q.nights[0]?.p5).toEqual({
    numerator: '13000000000000000013',
    denominator: '20000000000000',
  });
  expect(
    quote({
      ...i,
      channels: [{ code: 'WEB', multiplier: '0.999999999999999999', commissionPercent: '0' }],
    }).total,
  ).toBe(650000);
});
it('promotions ordered codes amount sum and huge amount capped', () => {
  const i = { ...input('STD', '2026-06-15', '2026-06-16'), seasons: [] };
  expect(
    quote({ ...i, promotions: [promo('Z', 'AMOUNT', '10000'), promo('A', 'AMOUNT', '10000')] })
      .appliedPromotions,
  ).toEqual(['A', 'Z']);
  expect(
    quote({ ...i, promotions: [promo('HUGE', 'AMOUNT', '999999999999999999999999')] }).total,
  ).toBe(455000);
  expect(quote({ ...i, promotions: [promo('EXACT', 'PERCENT', '30')] }).warnings).not.toContain(
    'E_RATE_DISCOUNT_CAPPED',
  );
});
it('promotion validity and immutable usage are checked at supplied now', () => {
  const i = input();
  const p = promo('P', 'PERCENT', '10');
  for (const promotions of [
    [{ ...p, validFrom: 1000001 }],
    [{ ...p, validTo: 1000000 }],
    [{ ...p, uses: 10 }],
    [p, promo('B', 'PERCENT', '10'), promo('C', 'PERCENT', '10')],
    [{ ...p, stackable: false }, promo('B', 'PERCENT', '10')],
  ])
    expect(quotePrice({ ...i, promotions })).toMatchObject({
      ok: false,
      error: { code: 'E_RATE_PROMOTION_INVALID' },
    });
  const unlimited = {
    code: p.code,
    kind: p.kind,
    value: p.value,
    stackable: p.stackable,
    validFrom: p.validFrom,
    validTo: p.validTo,
    uses: p.uses,
  };
  expect(quote({ ...i, promotions: [unlimited] }).total).toBe(497000);
  expect(p.uses).toBe(0);
});
it('parity is evaluated after ceiling clamp and direct channel warning', () => {
  const i = {
    ...input('STD', '2026-11-17', '2026-11-18', 'OTA_BOOKING'),
    seasons: [],
    ratePlan: { ...input().ratePlan, fixedNightlyPrice: 1800000 },
  };
  expect(quote(i).warnings).toContain('E_RATE_CHANNEL_PARITY');
  expect(
    quote({ ...i, channels: i.channels.filter((c) => c.code !== 'WEB') }).warnings,
  ).not.toContain('E_RATE_CHANNEL_PARITY');
  const direct = {
    ...input(),
    seasons: [],
    channels: [{ code: 'WEB', multiplier: '0.9', commissionPercent: '0' }],
  };
  expect(quote(direct).warnings).toContain('E_RATE_DIRECT_BELOW_BASE');
  expect(quote({ ...direct, promotions: [promo('P', 'PERCENT', '1')] }).warnings).not.toContain(
    'E_RATE_DIRECT_BELOW_BASE',
  );
});
it('rejects malformed loaded config and unsafe final totals', () => {
  const i = input();
  const s = i.seasons[0]!;
  const p = promo('P', 'PERCENT', '10');
  const bad: PricingInput[] = [
    { ...i, checkIn: '2026-02-30' },
    { ...i, checkIn: 'today' },
    { ...i, now: -1 },
    { ...i, propertyId: '' },
    { ...i, room: { ...i.room, basePrice: 0.5 } },
    { ...i, room: { ...i.room, minPrice: 400001 } },
    { ...i, room: { ...i.room, maxPrice: 300000 } },
    { ...i, ratePlan: { ...i.ratePlan, minNights: 2 } },
    { ...i, ratePlan: { ...i.ratePlan, maxNights: 0 } },
    { ...i, ratePlan: { ...i.ratePlan, depositPercent: '101' } },
    { ...i, seasons: [{ ...s, multiplier: '0' }] },
    { ...i, seasons: [{ ...s, multiplier: 'NaN' }] },
    { ...i, seasons: [{ ...s, priority: 0.5 }] },
    { ...i, seasons: [{ ...s, to: '2026-01-01' }] },
    { ...i, channelCode: 'MISSING' },
    {
      ...i,
      occupancy: [
        { id: 'x', propertyId: 'CS', date: i.checkIn, demand: 1, supply: 1, capturedAt: i.now + 1 },
      ],
    },
    {
      ...i,
      calendar: [
        {
          id: 'x',
          roomTypeId: 'STD',
          from: i.checkIn,
          to: i.checkIn,
          createdAt: 0,
          source: 'RATE_PLAN',
          price: 1,
        },
      ],
    },
    { ...i, promotions: [{ ...p, validTo: 0 }] },
    { ...i, promotions: [{ ...p, kind: 'AMOUNT', value: '1.5' }] },
    { ...i, settings: { ...i.settings, occupancyMidPercent: '95' } },
    { ...i, settings: { ...i.settings, los: [{ minNights: 0, multiplier: '1' }] } },
    { ...i, settings: { ...i.settings, los: [{ minNights: 1, multiplier: '1.1' }] } },
  ];
  for (const b of bad)
    expect(quotePrice(b)).toMatchObject({ ok: false, error: { code: 'E_RATE_INVALID_INPUT' } });
  const huge = {
    ...i,
    checkOut: '2026-11-20',
    seasons: [],
    room: { ...i.room, basePrice: 4000000000000000, maxPrice: 5000000000000000 },
  };
  expect(quotePrice(huge)).toMatchObject({ ok: false, error: { code: 'E_RATE_UNSAFE_AMOUNT' } });
});
it('parity resolves WEB channel calendar separately', () => {
  const i = {
    ...input('STD', '2026-11-17', '2026-11-18', 'OTA_BOOKING'),
    seasons: [],
    room: { ...input().room, maxPrice: 3000000 },
  };
  const row: CalendarRate = {
    id: 'web',
    roomTypeId: 'STD',
    from: i.checkIn,
    to: i.checkIn,
    channelCode: 'WEB',
    source: 'OVERRIDE',
    price: 2000000,
    createdAt: 0,
  };
  const q = quote({
    ...i,
    calendar: [row, { ...row, id: 'ota', channelCode: 'OTA_BOOKING', price: 1000000 }],
  });
  expect(q.total).toBe(1250000);
  expect(q.warnings).toContain('E_RATE_CHANNEL_PARITY');
});
it('commission-only property override inherits default multiplier', () => {
  const i = { ...input('STD', '2026-11-17', '2026-11-18', 'OTA_BOOKING'), seasons: [] };
  const q = quote({
    ...i,
    channelSettings: [
      {
        id: 'commission',
        propertyId: 'CS',
        channelCode: 'OTA_BOOKING',
        effectiveFrom: i.checkIn,
        commissionPercent: '15',
      },
    ],
  });
  expect(q.total).toBe(813000);
  expect(q.nights[0]?.channelSettingId).toBe('commission');
  expect(q.nights[0]?.commissionPercent).toEqual({ numerator: '15', denominator: '1' });
});
it('floor-dropped promotion does not suppress direct-channel underpricing warning', () => {
  const i = {
    ...input('DOR', '2026-10-12', '2026-10-15'),
    channels: [{ code: 'WEB', multiplier: '0.9', commissionPercent: '0' }],
    promotions: [promo('P', 'PERCENT', '30')],
  };
  const q = quote(i);
  expect(q.appliedPromotions).toEqual([]);
  expect(q.warnings).toContain('E_RATE_BELOW_FLOOR');
  expect(q.warnings).toContain('E_RATE_DIRECT_BELOW_BASE');
});
