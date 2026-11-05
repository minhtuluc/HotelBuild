import { expect, test } from 'vitest';
import fc from 'fast-check';
import {
  checkActiveOversell as guard,
  planRelocation,
  rankRelocations,
} from '@pinehill/domain/overbooking';
import type {
  RelocationCandidate,
  RelocationGeography,
  RelocationPlanRequest,
  RelocationRoomStock,
} from '@pinehill/domain/overbooking';

test('active_oversell_10000: per-property exact limits, every night, determinism and immutable snapshots', () => {
  fc.assert(
    fc.property(
      fc.array(
        fc.record({
          rooms: fc.integer({ min: 0, max: 1_000_000 }),
          pctHundredths: fc.integer({ min: 0, max: 500 }),
          overbookAllowed: fc.boolean(),
          deltas: fc.tuple(
            fc.integer({ min: -1, max: 1 }),
            fc.integer({ min: -1, max: 1 }),
            fc.integer({ min: -1, max: 1 }),
          ),
        }),
        { minLength: 1, maxLength: 4 },
      ),
      (properties) => {
        for (const [index, config] of properties.entries()) {
          // Independent bounded-number oracle: quotient plus remainder, not production bigint ceil.
          const product = config.rooms * config.pctHundredths;
          const rounded = Math.floor(product / 10_000) + (product % 10_000 === 0 ? 0 : 1);
          const limit =
            config.pctHundredths === 0 || !config.overbookAllowed ? 0 : Math.max(1, rounded);
          const nightly = Object.freeze(
            config.deltas.map((delta, day) =>
              Object.freeze({
                date: `2026-10-0${day + 3}`,
                projectedOversoldRooms: Math.max(0, limit + delta),
              }),
            ),
          );
          const input = Object.freeze({
            kind: 'ACTIVE_SALE' as const,
            propertyId: `CS-${index}`,
            activePhysicalRooms: config.rooms,
            overbookLimitPct: `${Math.floor(config.pctHundredths / 100)}.${String(
              config.pctHundredths % 100,
            ).padStart(2, '0')}`,
            channel: Object.freeze({ overbookAllowed: config.overbookAllowed }),
            nightly,
          });
          const original = JSON.stringify(input);
          const firstFailure = nightly.find((row) => row.projectedOversoldRooms > limit);
          const expected = firstFailure
            ? {
                ok: false,
                error: {
                  code: 'E_OVER_LIMIT_EXCEEDED',
                  propertyId: input.propertyId,
                  date: firstFailure.date,
                  dailyLimit: limit,
                  projectedOversoldRooms: firstFailure.projectedOversoldRooms,
                },
              }
            : { ok: true, value: { kind: 'ACTIVE_SALE', dailyLimit: limit } };
          expect(guard(input)).toEqual(expected);
          expect(guard(input)).toEqual(expected);
          expect(guard({ ...input, nightly: [...nightly].reverse() })).toEqual(expected);
          expect(JSON.stringify(input)).toBe(original);
        }
      },
    ),
    { numRuns: 10_000, seed: 12203 },
  );
});

const NOW = Date.UTC(2026, 9, 10, 6, 0);
const HOUR = 3_600_000;
const STAY = ['2026-10-10', '2026-10-11'] as const;

const relocationCandidates = (): fc.Arbitrary<readonly RelocationCandidate[]> =>
  fc
    .array(
      fc.record({
        channelCode: fc.constantFrom('WEB', 'WALKIN', 'OTA_BOOKING'),
        loyaltyTier: fc.constantFrom('PLATINUM', 'GOLD', 'SILVER', 'MEMBER', 'GUEST'),
        paidAmountVnd: fc.constantFrom(0, 600_000, 2_000_000),
        nights: fc.integer({ min: 0, max: 20 }),
        staysLast12Months: fc.integer({ min: 0, max: 5 }),
        status: fc.constantFrom('HELD', 'CONFIRMED', 'CHECKED_IN'),
        createdAtEpochMs: fc.integer({ min: NOW - 30 * 24 * HOUR, max: NOW }),
        arrivalOffsetHours: fc.integer({ min: 0, max: 12 }),
      }),
      { minLength: 0, maxLength: 6 },
    )
    .map((rows) =>
      rows.map((row, index): RelocationCandidate => ({
        bookingId: `booking-${index}`,
        channelCode: row.channelCode,
        seq: BigInt(index + 1),
        createdAtEpochMs: row.createdAtEpochMs,
        loyaltyTier: row.loyaltyTier,
        paidAmountVnd: row.paidAmountVnd,
        totalAmountVnd: 2_000_000,
        depositAmountVnd: 600_000,
        nights: row.nights,
        staysLast12Months: row.staysLast12Months,
        status: row.status,
        arrivalAtEpochMs: NOW + row.arrivalOffsetHours * HOUR,
        nowEpochMs: NOW,
      })),
    );

const relocationRooms = (): fc.Arbitrary<readonly RelocationRoomStock[]> =>
  fc
    .array(
      fc.record({
        propertyId: fc.constantFrom('CS-01', 'CS-02', 'CS-03'),
        roomTypeId: fc.constantFrom('STD', 'DLX', 'SUP'),
        basePriceVnd: fc.integer({ min: 500_000, max: 2_000_000 }),
        capacityAdults: fc.integer({ min: 1, max: 4 }),
        occupiedDates: fc.subarray([...STAY]),
      }),
      { minLength: 0, maxLength: 6 },
    )
    .map((rows) =>
      rows.map((row, index): RelocationRoomStock => ({ roomId: `room-${index}`, ...row })),
    );

const relocationGeography = (): fc.Arbitrary<RelocationGeography> =>
  fc
    .record({ sameCity: fc.boolean(), nearKm: fc.constantFrom(5, 12, 15, 15.5, 160, 300) })
    .map(({ sameCity, nearKm }) => ({
      properties: [
        { propertyId: 'CS-01', city: 'Đà Lạt' },
        { propertyId: 'CS-02', city: sameCity ? 'Đà Lạt' : 'Vũng Tàu' },
        { propertyId: 'CS-03', city: 'Phan Thiết' },
      ],
      distances: [
        { fromPropertyId: 'CS-01', toPropertyId: 'CS-02', roadDistanceKm: nearKm },
        { fromPropertyId: 'CS-02', toPropertyId: 'CS-03', roadDistanceKm: 170 },
        { fromPropertyId: 'CS-01', toPropertyId: 'CS-03', roadDistanceKm: 300 },
      ],
    }));

const relocationBooking = (): fc.Arbitrary<RelocationPlanRequest['booking']> =>
  fc
    .record({
      guestCount: fc.integer({ min: 1, max: 3 }),
      status: fc.constantFrom('HELD', 'CONFIRMED', 'CHECKED_IN'),
      roomTypeId: fc.constantFrom('STD', 'DLX'),
      roomTypeBasePriceVnd: fc.constantFrom(900_000, 1_000_000, 1_300_000),
    })
    .map((row) => ({
      bookingId: 'booking-plan-1',
      propertyId: 'CS-01',
      roomTypeId: row.roomTypeId,
      roomTypeBasePriceVnd: row.roomTypeBasePriceVnd,
      guestCount: row.guestCount,
      status: row.status,
      paidAmountVnd: 1_400_000,
      firstNightRateVnd: 700_000,
    }));

const serializeBigint = (_key: string, value: unknown): unknown =>
  typeof value === 'bigint' ? value.toString() : value;

test('TC_OVER_10_deterministic_10000: seeded fixture sets keep order, score and ladder stable and are not mutated', () => {
  fc.assert(
    fc.property(
      relocationCandidates(),
      relocationRooms(),
      relocationGeography(),
      relocationBooking(),
      (candidates, roomStock, geography, booking) => {
        const ranked = rankRelocations(candidates);
        expect(ranked.ok).toBe(true);
        expect(rankRelocations(candidates)).toEqual(ranked);
        expect(rankRelocations([...candidates].reverse())).toEqual(ranked);

        const request: RelocationPlanRequest = {
          planId: 'plan-deterministic-1',
          nowEpochMs: NOW,
          booking,
          stayDates: [...STAY],
          roomStock,
          geography,
        };
        const before = JSON.stringify(candidates, serializeBigint) + JSON.stringify(request);
        const plan = planRelocation(request);
        expect(plan.ok).toBe(true);
        expect(planRelocation(request)).toEqual(plan);
        // Reversing stay dates and room stock must not change order, score or ladder.
        expect(
          planRelocation({
            ...request,
            stayDates: [...STAY].reverse(),
            roomStock: [...roomStock].reverse(),
          }),
        ).toEqual(plan);
        expect(JSON.stringify(candidates, serializeBigint) + JSON.stringify(request)).toBe(before);
      },
    ),
    { numRuns: 10_000, seed: 12204 },
  );
});
