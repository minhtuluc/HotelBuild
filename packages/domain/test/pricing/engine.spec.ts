import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import * as pricing from '../../src/pricing/index.js';
import { input, matrix, promo, rooms } from './fixtures.js';
import type { PricingInput } from '../../src/pricing/index.js';
function quote(i: PricingInput) {
  const result = pricing.quotePrice(i);
  if (!result.ok) throw new Error(JSON.stringify(result.error));
  return result.value;
}
function end(date: string, nights: number) {
  return new Date(Date.parse(date) + nights * 86400000).toISOString().slice(0, 10);
}
function occupied(i: PricingInput, demand: number, supply = 100, capturedAt = i.now): PricingInput {
  return {
    ...i,
    occupancy: Array.from(
      { length: (Date.parse(i.checkOut) - Date.parse(i.checkIn)) / 86400000 },
      (_, n) => ({
        id: `s${n}`,
        propertyId: i.propertyId,
        date: end(i.checkIn, n),
        demand,
        supply,
        capturedAt,
      }),
    ),
  };
}
describe('HB-052 pricing', () => {
  it('TC-RATE-01 exposes pure API', () => expect(pricing).toHaveProperty('quotePrice'));
  it.each(matrix)('TC-RATE-01 literal matrix %s %s %s', (room, date, channel, total) => {
    expect(quote(input(room, date, end(date, 1), channel)).total).toBe(total);
  });
  it('TC-RATE-01 golden SUP trace and deposit', () => {
    const q = quote(input('SUP', '2026-11-17', '2026-11-19'));
    expect(q.total).toBe(1446000);
    expect(q.depositAmount).toBe(434000);
    expect(q.nights[0]?.steps.map((s) => s.step)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
    expect(q.nights[0]?.p1).toEqual({ numerator: '722500', denominator: '1' });
    expect(JSON.parse(JSON.stringify(q))).toEqual(q);
  });
  it('TC-RATE-02 golden REUN OTA', () =>
    expect(quote(occupied(input('DLX', '2026-04-30', '2026-05-03', 'OTA_BOOKING'), 82)).total).toBe(
      8112000,
    ));
  it('TC-RATE-01 golden FAM summer', () =>
    expect(quote(occupied(input('FAM', '2026-07-08', '2026-07-13', 'WALKIN'), 92)).total).toBe(
      14538000,
    ));
  it('TC-RATE-02 golden DOR long stay and private base', () => {
    const i = input('DOR', '2026-10-05', '2026-10-19', 'AGENCY');
    expect(quote(i).total).toBe(2544000);
    expect(quote({ ...i, ratePlan: { ...i.ratePlan, fixedNightlyPrice: 237000 } }).total).toBe(
      2414000,
    );
    expect(quote({ ...i, ratePlan: { ...i.ratePlan, fixedNightlyPrice: 237500 } }).total).toBe(
      2424000,
    );
  });
  it('TC-RATE-03 resolves season priority, width, creation independent of UUID', () => {
    const i = input('STD', '2026-04-30', '2026-05-01');
    const base = { from: i.checkIn, to: i.checkIn, priority: 80, weekendSurchargeEnabled: false };
    const q = quote({
      ...i,
      seasons: [
        ...i.seasons,
        { ...base, id: 'z', multiplier: '1.5', createdAt: 0 },
        { ...base, id: 'a', multiplier: '1.7', createdAt: 2 },
      ],
    });
    expect(q.nights[0]?.seasonId).toBe('z');
    expect(q.total).toBe(975000);
  });
  it('TC-RATE-04 no season uses one', () =>
    expect(quote({ ...input(), seasons: [] }).total).toBe(650000));
  it('TC-RATE-05 weekends exclude Sunday and NY Friday', () => {
    expect(
      quote(input('STD', '2026-06-18', '2026-06-22')).nights.map((n) => n.nightlyPrice),
    ).toEqual([865000, 1038000, 1038000, 865000]);
    expect(quote(input('STD', '2027-01-01', '2027-01-02')).total).toBe(1430000);
  });
  it('TC-RATE-06 REUN Saturday disables weekend', () =>
    expect(quote(input('STD', '2026-05-02', '2026-05-03')).total).toBe(1170000));
  it('TC-RATE-07 occupancy thresholds, freshness, zero supply and property scope', () => {
    const i = input('STD', '2026-06-15', '2026-06-16');
    for (const [d, s, total] of [
      [7999, 10000, 910000],
      [80, 100, 1047000],
      [95, 100, 1138000],
      [120, 100, 1138000],
    ] as const)
      expect(quote(occupied(i, d, s)).total).toBe(total);
    expect(quote(occupied(i, 95, 100, i.now - 300001)).total).toBe(910000);
    expect(quote(occupied(i, 95, 100, i.now - 300000)).total).toBe(1138000);
    expect(quote(occupied(i, 1, 0)).warnings).toContain('E_RATE_ZERO_SUPPLY');
    expect(quote(occupied(i, 0, 0)).total).toBe(910000);
    const s = occupied(i, 95).occupancy[0]!;
    expect(
      quote({
        ...i,
        occupancy: [
          { ...s, propertyId: 'OTHER' },
          { ...s, id: 'type-snapshot', roomTypeId: 'STD' },
        ],
      }).total,
    ).toBe(910000);
  });
  it('TC-RATE-08 LOS all nights and mixed season E2', () => {
    for (const [n, factor] of [
      [2, '1'],
      [3, '19/20'],
      [6, '19/20'],
      [7, '9/10'],
      [13, '9/10'],
      [14, '17/20'],
    ] as const) {
      const q = quote(input('STD', '2026-11-17', end('2026-11-17', n)));
      expect(
        q.nights.every(
          (x) =>
            `${x.losMultiplier.numerator}/${x.losMultiplier.denominator}` ===
            (factor === '1' ? '1/1' : factor),
        ),
      ).toBe(true);
    }
    expect(quote(input('STD', '2026-09-29', '2026-10-02')).total).toBe(1637000);
  });
  it('TC-RATE-09 four plan LOS flags with valid periods', () => {
    const i = input('STD', '2026-11-17', '2026-12-01');
    for (const id of ['FLEX7', 'SAVER3', 'LONGSTAY14']) {
      const minNights = id === 'LONGSTAY14' ? 14 : id === 'SAVER3' ? 2 : 1;
      const q = quote({ ...i, ratePlan: { ...i.ratePlan, id, minNights } });
      expect(
        q.nights.every(
          (n) => n.losMultiplier.numerator === '17' && n.losMultiplier.denominator === '20',
        ),
      ).toBe(true);
    }
    const q = quote({
      ...i,
      ratePlan: { ...i.ratePlan, id: 'NONREF', losDiscountEnabled: false, depositPercent: '100' },
    });
    expect(
      q.nights.every(
        (n) => n.losMultiplier.numerator === '1' && n.losMultiplier.denominator === '1',
      ),
    ).toBe(true);
    expect(q.depositAmount).toBe(q.total);
  });
  it('TC-RATE-10 seven channels and dated property commission', () => {
    const i = { ...input('STD', '2026-06-15', '2026-06-16'), seasons: [] };
    expect(i.channels.map((c) => quote({ ...i, channelCode: c.code }).total)).toEqual([
      650000, 650000, 715000, 618000, 813000, 793000, 774000,
    ]);
    const setting = {
      id: 'setting',
      propertyId: 'CS',
      channelCode: 'OTA_BOOKING',
      effectiveFrom: '2026-06-16',
      multiplier: '1.50',
      commissionPercent: '20',
    };
    const q = quote({
      ...i,
      checkOut: '2026-06-17',
      channelCode: 'OTA_BOOKING',
      channelSettings: [setting],
    });
    expect(q.nights.map((n) => n.channelSettingId)).toEqual([null, 'setting']);
    expect(q.nights.map((n) => n.nightlyPrice)).toEqual([813000, 975000]);
    expect(q.nights[1]?.commissionPercent).toEqual({ numerator: '20', denominator: '1' });
  });
  it('TC-RATE-11 floor and ceiling all room types; nonlinear clamp counterexample', () => {
    for (const room of ['STD', 'SUP', 'DLX', 'FAM', 'DOR'] as const) {
      const i = input(room, '2026-11-17', '2026-11-18');
      expect(quote({ ...i, ratePlan: { ...i.ratePlan, fixedNightlyPrice: 1 } }).total).toBe(
        rooms[room].minPrice,
      );
      expect(quote({ ...i, ratePlan: { ...i.ratePlan, fixedNightlyPrice: 100000000 } }).total).toBe(
        rooms[room].maxPrice,
      );
    }
    const i = input('STD', '2026-10-12', '2026-10-15', 'AGENCY');
    const q = quote({
      ...i,
      calendar: [
        {
          id: 'override',
          roomTypeId: 'STD',
          from: i.checkIn,
          to: '2026-10-14',
          source: 'OVERRIDE',
          price: 450000,
          createdAt: 1,
        },
      ],
    });
    expect(q.total).toBe(1200000);
    expect(q.nights[0]?.p5).toEqual({ numerator: '1380825', denominator: '4' });
    expect(q.total).not.toBe(1140000);
    expect(q.nights.every((n) => n.clamped === 'floor')).toBe(true);
  });
  it('TC-RATE-12 exact intermediate fractions and opposite final rounding', () => {
    const i = input('STD', '2026-06-15', '2026-06-18');
    const q = quote({ ...occupied(i, 95), promotions: [promo('SEVEN', 'PERCENT', '7')] });
    expect(q.nights[0]?.p4).toEqual({ numerator: '1080625', denominator: '1' });
    expect(q.subtotal).toBe(3243000);
    expect(q.discountAmount).toEqual({ numerator: '227010', denominator: '1' });
    expect(q.total).toBe(3015000);
    expect(q.depositAmount).toBe(905000);
  });
  it('TC-RATE-02 dual percentages additive cap and AMOUNT before PERCENT', () => {
    const i = occupied(input('STD', '2026-06-15', '2026-06-18'), 95);
    const q = quote({
      ...i,
      promotions: [promo('A', 'PERCENT', '20'), promo('B', 'PERCENT', '15')],
    });
    expect(q.total).toBe(2270000);
    expect(q.depositAmount).toBe(681000);
    expect(q.warnings).toContain('E_RATE_DISCOUNT_CAPPED');
    const mixed = quote({
      ...i,
      promotions: [promo('Z', 'AMOUNT', '300000'), promo('A', 'PERCENT', '20')],
    });
    expect(mixed.total).toBe(2354000);
    expect(mixed.appliedPromotions).toEqual(['Z', 'A']);
    expect(mixed.total).not.toBe(2294000);
  });
  it('E4 floor drops promotions without blocking online quote', () => {
    const i = input('DOR', '2026-10-12', '2026-10-15', 'AGENCY');
    for (const percent of ['25', '30']) {
      const q = quote({ ...i, promotions: [promo('P', 'PERCENT', percent)] });
      expect(q.total).toBe(576000);
      expect(q.appliedPromotions).toEqual([]);
      expect(q.warnings).toContain('E_RATE_BELOW_FLOOR');
    }
  });
  it('TC-RATE-22 10000 complete stay invariants and determinism', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...(['STD', 'SUP', 'DLX', 'FAM', 'DOR'] as const)),
        fc.integer({ min: 0, max: 729 }),
        fc.integer({ min: 1, max: 30 }),
        fc.integer({ min: 0, max: 100 }),
        fc.integer({ min: 0, max: 30 }),
        fc.constantFrom(
          'WEB',
          'PHONE',
          'WALKIN',
          'OTA_BOOKING',
          'OTA_AGODA',
          'OTA_AIRBNB',
          'AGENCY',
        ),
        fc.constantFrom('FLEX7', 'SAVER3', 'NONREF', 'LONGSTAY14'),
        (room, day, generatedNights, d, p, ch, plan) => {
          const minNights = plan === 'LONGSTAY14' ? 14 : plan === 'SAVER3' ? 2 : 1;
          const n = Math.max(generatedNights, minNights);
          const date = end('2026-01-01', day);
          const i = {
            ...occupied(input(room, date, end(date, n), ch), d),
            promotions: [promo('P', 'PERCENT', String(p))],
            ratePlan: {
              ...input().ratePlan,
              id: plan,
              minNights,
              losDiscountEnabled: plan !== 'NONREF',
            },
          };
          const q = quote(i);
          expect(q.total).toBeGreaterThanOrEqual(0);
          expect(q.total % 1000).toBe(0);
          expect(q.depositAmount % 1000).toBe(0);
          for (const night of q.nights) {
            expect(night.nightlyPrice).toBeGreaterThanOrEqual(rooms[room].minPrice);
            expect(night.nightlyPrice).toBeLessThanOrEqual(rooms[room].maxPrice);
            expect(night.nightlyPrice % 1000).toBe(0);
          }
          expect(quote(i)).toEqual(q);
        },
      ),
      { numRuns: 10000, seed: 52022 },
    );
  }, 30000);
});
