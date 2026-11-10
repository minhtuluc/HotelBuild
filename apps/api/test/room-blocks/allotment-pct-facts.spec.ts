/**
 * HB-224 — BR-CHAN-01: hạn mức OTA mặc định = `channel_mappings.allotment_pct` của ánh xạ ACTIVE
 * (vắng ánh xạ ⇒ 80%). QA HB-194 (QA-F6-12): loader bỏ qua cột này nên mọi kênh luôn 80%.
 * Loại STD có 2 phòng: 80% ⇒ max(1, floor(1.6)) = 1; 100% ⇒ 2; 50% ⇒ 1 (DB ràng buộc 1..100).
 */
import { beforeEach, expect, test } from 'vitest';
import { calculateAvailability } from '@pinehill/domain/inventory';
import { loadInventoryFacts } from '../../src/modules/inv/facts/loader.js';
import { db, rows, propertyId, typeId, stay, allotment } from './inventory-seed.js';

async function otaNight(channel: 'OTA_BOOKING' | 'OTA_AGODA' = 'OTA_BOOKING') {
  const input = await db.$transaction((tx) =>
    loadInventoryFacts(tx, { ...stay, propertyId, roomTypeId: typeId, channelCode: channel }),
  );
  const result = calculateAvailability(input);
  const nightly = result.ok
    ? result.value.nightly
    : result.error.code === 'E_INV_NO_AVAILABILITY'
      ? result.error.availability.nightly
      : [];
  return nightly[0]?.channelAvailability;
}
async function mapping(channel: string, pct: number, status = 'ACTIVE') {
  await rows(
    `INSERT INTO channel_mappings(channel_id,room_type_id,external_room_code,status,allotment_pct)
     SELECT id,$2,'HB224-'||code,$4,$3 FROM channels WHERE code=$1`,
    [channel, typeId, pct, status],
  );
}
beforeEach(async () => {
  await rows('DELETE FROM channel_mappings');
});

test('HB224_without_mapping_ota_quota_defaults_to_80_percent', async () => {
  expect(await otaNight()).toBe(1);
});

test('HB224_configured_mapping_pct_drives_ota_quota', async () => {
  await mapping('OTA_BOOKING', 100);
  expect(await otaNight()).toBe(2);
  await rows('UPDATE channel_mappings SET allotment_pct=50');
  expect(await otaNight()).toBe(1);
});

test('HB224_pct_is_per_channel_and_inactive_mapping_ignored', async () => {
  await mapping('OTA_AGODA', 100);
  await mapping('OTA_BOOKING', 100, 'INACTIVE');
  expect(await otaNight('OTA_AGODA')).toBe(2);
  expect(await otaNight('OTA_BOOKING')).toBe(1);
});

test('HB224_explicit_daily_allotment_still_overrides_pct', async () => {
  await mapping('OTA_BOOKING', 100);
  await allotment('OTA_BOOKING', 1);
  expect(await otaNight()).toBe(1);
});
