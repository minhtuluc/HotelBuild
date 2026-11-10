/**
 * HB-224 — BR-CHAN-01: ảnh tồn đẩy lên OTA dùng `channel_mappings.allotment_pct` làm hạn mức mặc định.
 * QA HB-194 (QA-F6-12): worker cố định 80% nên đổi `allotmentPct` trên SCR-40 không có tác dụng.
 * Harness HB-131 có 5 phòng STD: 80% ⇒ 4, 100% ⇒ 5, 20% ⇒ 1.
 */
import { afterAll, beforeAll, expect, test, vi } from 'vitest';
import { z } from 'zod';
import {
  rows,
  runSweep,
  seed,
  setup,
  simulatorRespond,
  snapshotBodies,
  startWorker,
  stopWorker,
  teardown,
} from './harness.js';

vi.setConfig({ testTimeout: 60_000 });

const lineSchema = z.object({ roomTypeId: z.string(), quota: z.number(), supply: z.number() });

beforeAll(async () => {
  await setup();
}, 180_000);

afterAll(async () => {
  await teardown();
}, 60_000);

async function quotasOf(code: string, version: number): Promise<readonly number[]> {
  const channelId = seed.channels[code]!;
  await runSweep(`hb224-${code}-${version}`, { channelId, version });
  const body = snapshotBodies().find(
    (item) => item.channelId === channelId && item.snapshot?.version === version,
  );
  expect(body).toBeDefined();
  return z
    .array(lineSchema)
    .parse(body!.snapshot?.inventory)
    .filter((line) => line.roomTypeId === seed.typeId)
    .map((line) => line.quota);
}

test('HB224_snapshot_quota_follows_mapping_allotment_pct', async () => {
  simulatorRespond(200);
  const worker = await startWorker();
  try {
    await rows(
      'UPDATE channel_mappings SET allotment_pct=100 WHERE channel_id=$1 AND room_type_id=$2',
      [seed.channels['OTA_AGODA'], seed.typeId],
    );
    await rows(
      'UPDATE channel_mappings SET allotment_pct=20 WHERE channel_id=$1 AND room_type_id=$2',
      [seed.channels['OTA_AIRBNB'], seed.typeId],
    );
    const agoda = await quotasOf('OTA_AGODA', 224);
    const airbnb = await quotasOf('OTA_AIRBNB', 225);
    const booking = await quotasOf('OTA_BOOKING', 226);
    expect(agoda.length).toBeGreaterThan(0);
    expect(new Set(agoda)).toEqual(new Set([5]));
    expect(new Set(airbnb)).toEqual(new Set([1]));
    // Ánh xạ mặc định (80) giữ nguyên hành vi cũ.
    expect(new Set(booking)).toEqual(new Set([4]));
  } finally {
    await stopWorker(worker);
  }
});
