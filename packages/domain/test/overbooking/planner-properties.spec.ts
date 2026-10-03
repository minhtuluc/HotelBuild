import { expect, test } from 'vitest';
import fc from 'fast-check';
import { checkActiveOversell as guard } from '@pinehill/domain/overbooking';

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
