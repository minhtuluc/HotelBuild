/**
 * HB-226 — test thuộc tính 10.000 cấu hình, seed cố định (HB-131 AC4, TC-CHAN-06; QA HB-194 QA-F6-03:
 * test khoá HB-131 chỉ có ví dụ, chưa có lượt thuộc tính).
 *
 * Bất biến BR-CHAN-01 / BR-INV-05 của tồn từng kênh trên mỗi đêm:
 * 1. tồn kênh luôn trong `[0, max(0, pool)]` — không âm, không vượt tồn chung;
 * 2. kênh trực tiếp WEB/PHONE/WALKIN không có quota: tồn kênh = `max(0, pool)`;
 * 3. OTA không có dòng allotment: quota = `floor(pct% đơn vị ACTIVE)` với `pct = allotmentPct` của ánh xạ
 *    kênh (HB-224/HB-232; vắng ⇒ 80), tối thiểu 1 khi có đơn vị ACTIVE và pct > 0, 0 khi pct = 0
 *    (tính **trước** khoá phòng), 0 khi không có; AGENCY thiếu cấu hình = 0;
 * 4. allotment tường minh thắng mặc định; `used` vượt allotment vẫn cho tồn 0, không âm;
 * 5. tồn kênh = `max(0, min(pool, quota − used))`.
 */
import fc from 'fast-check';
import { expect, it } from 'vitest';
import type {
  AvailabilityInput,
  ChannelCode,
  Demand,
  RoomBlock,
  SellingUnit,
} from '../../src/inventory/index.js';
import { fixture, obligation, snapshot, unit } from './fixtures.js';

const CHANNELS = [
  'WEB',
  'PHONE',
  'WALKIN',
  'OTA_BOOKING',
  'OTA_AGODA',
  'OTA_AIRBNB',
  'AGENCY',
] as const satisfies readonly ChannelCode[];
const DIRECT = new Set<ChannelCode>(['WEB', 'PHONE', 'WALKIN']);
const STATUSES = ['ACTIVE', 'ACTIVE', 'ACTIVE', 'MAINTENANCE', 'INACTIVE'] as const;
const NIGHTS = ['2026-11-20', '2026-11-21', '2026-11-22'] as const;
const CHECK_OUT = '2026-11-23';

const configuration = fc.record({
  channelCode: fc.constantFrom(...CHANNELS),
  rooms: fc.array(fc.constantFrom(...STATUSES), { minLength: 0, maxLength: 15 }),
  blocked: fc.array(fc.nat({ max: 14 }), { maxLength: 6 }),
  demand: fc.array(
    fc.record({
      channelCode: fc.constantFrom(...CHANNELS),
      night: fc.nat({ max: NIGHTS.length - 1 }),
    }),
    { maxLength: 25 },
  ),
  allotment: fc.option(fc.nat({ max: 20 }), { nil: undefined }),
  allotmentPct: fc.option(fc.integer({ min: 0, max: 100 }), { nil: undefined }),
});
type Configuration = typeof configuration extends fc.Arbitrary<infer T> ? T : never;

function inputOf(config: Configuration): AvailabilityInput {
  const units: SellingUnit[] = config.rooms.map((status, i) => ({ ...unit(`r${i}`), status }));
  const blocks: RoomBlock[] = config.blocked
    .filter((index) => index < config.rooms.length)
    .map((index) => ({ roomId: `r${index}`, checkIn: NIGHTS[0], checkOut: CHECK_OUT }));
  const demand: Demand[] = config.demand.map((item, i) =>
    obligation(`b${i}`, {
      channelCode: item.channelCode,
      checkIn: NIGHTS[item.night] ?? NIGHTS[0],
      checkOut: NIGHTS[item.night + 1] ?? CHECK_OUT,
    }),
  );
  const allotments =
    config.allotment === undefined
      ? []
      : NIGHTS.map((date) => ({
          propertyId: fixture.propertyId,
          roomTypeId: fixture.roomTypeId,
          channelCode: config.channelCode,
          date,
          allotment: config.allotment!,
        }));
  return {
    ...fixture,
    channelCode: config.channelCode,
    checkIn: NIGHTS[0],
    checkOut: CHECK_OUT,
    units,
    blocks,
    demand,
    allotments,
    ...(config.allotmentPct === undefined ? {} : { allotmentPct: config.allotmentPct }),
  };
}

function expectedQuota(config: Configuration): number | null {
  if (DIRECT.has(config.channelCode)) return null;
  if (config.allotment !== undefined) return config.allotment;
  if (config.channelCode === 'AGENCY') return 0;
  const active = config.rooms.filter((status) => status === 'ACTIVE').length;
  const pct = config.allotmentPct ?? 80;
  return active > 0 && pct > 0 ? Math.max(1, Math.floor((active * pct) / 100)) : 0;
}

it('HB226_channel_quota_invariants_hold_for_10000_seeded_configurations', () => {
  fc.assert(
    fc.property(configuration, (config) => {
      const quota = expectedQuota(config);
      for (const night of snapshot(inputOf(config)).nightly) {
        const shared = Math.max(0, night.pool);
        expect(night.channelAvailability).toBeGreaterThanOrEqual(0);
        expect(night.channelAvailability).toBeLessThanOrEqual(shared);
        if (quota === null) expect(night.channelAvailability).toBe(shared);
        else
          expect(night.channelAvailability).toBe(Math.max(0, Math.min(shared, quota - night.used)));
        expect(night.used).toBe(
          config.demand.filter(
            (item) => item.channelCode === config.channelCode && NIGHTS[item.night] === night.date,
          ).length,
        );
      }
    }),
    { numRuns: 10_000, seed: 20_261_106 },
  );
});
