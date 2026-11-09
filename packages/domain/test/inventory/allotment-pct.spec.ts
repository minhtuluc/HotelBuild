import { expect, it } from 'vitest';
import { snapshot, unit } from './fixtures.js';

/**
 * HB-224 — BR-CHAN-01: hạn mức mặc định từng OTA là `allotmentPct` của ánh xạ kênh (OWNER cấu hình qua
 * `PUT /channels/{id}/mappings`), vắng thì 80%. QA HB-194 (QA-F6-12): engine cứng 80% nên cấu hình 50%
 * không đổi tồn công bố. `0` nghĩa là không bán qua kênh đó; không nâng lên tối thiểu 1.
 */
const twelve = Array.from({ length: 12 }, (_, i) => unit(`r${i}`));
const channel = (allotmentPct?: number) =>
  snapshot({
    channelCode: 'OTA_AGODA',
    units: twelve,
    ...(allotmentPct === undefined ? {} : { allotmentPct }),
  }).nightly[0]?.channelAvailability;

it('HB224_configured_allotment_pct_sets_default_ota_quota', () => {
  expect(channel()).toBe(9);
  expect(channel(80)).toBe(9);
  expect(channel(50)).toBe(6);
  expect(channel(100)).toBe(12);
  expect(channel(1)).toBe(1);
  expect(channel(0)).toBe(0);
});

it('HB224_direct_channels_ignore_allotment_pct', () => {
  expect(
    snapshot({ channelCode: 'WEB', units: twelve, allotmentPct: 0 }).nightly[0]
      ?.channelAvailability,
  ).toBe(12);
});
