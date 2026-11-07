/**
 * F6 gap HB-132 — `GET /channels` trả `rateWarnings` do máy chủ tính từ hệ số/hoa hồng mặc định
 * (BR-RATE-07/09): OTA thấp hơn WEB về doanh thu thuần, hoặc kênh trực tiếp có hệ số < 1,00.
 */
import { afterAll, beforeAll, expect, test } from 'vitest';
import { channelSummarySchema, listResponseSchema } from '@pinehill/contracts';
import type { ChannelSummary } from '@pinehill/contracts';
import { USERS, auth, http, login, rows, setup, teardown } from './fixture.js';

const page = listResponseSchema(channelSummarySchema);
let manager = '';

const CONFIG: readonly [code: string, multiplier: string, commission: string][] = [
  ['WEB', '1.000', '0'],
  ['PHONE', '0.950', '0'], // < 1,00 ⇒ E_RATE_DIRECT_BELOW_BASE
  ['WALKIN', '1.100', '0'],
  ['OTA_BOOKING', '1.200', '18'], // 1,20 × 0,82 = 0,984 < 1,000 ⇒ E_RATE_CHANNEL_PARITY
  ['OTA_AGODA', '1.220', '17'], // 1,0126 ≥ 1,000
  ['OTA_AIRBNB', '1.190', '15'], // 1,0115 ≥ 1,000
  ['AGENCY', '0.950', '10'], // ngoài phạm vi BR-RATE-09
];

const EXPECTED: Record<string, readonly string[]> = {
  WEB: [],
  PHONE: ['E_RATE_DIRECT_BELOW_BASE'],
  WALKIN: [],
  OTA_BOOKING: ['E_RATE_CHANNEL_PARITY'],
  OTA_AGODA: [],
  OTA_AIRBNB: [],
  AGENCY: [],
};

const warningsByCode = (data: readonly ChannelSummary[]) =>
  Object.fromEntries(data.map((row) => [row.code, row.rateWarnings ?? []]));

beforeAll(async () => {
  await setup();
  manager = await login(USERS.manager);
  for (const [code, multiplier, commission] of CONFIG)
    await rows('UPDATE channels SET multiplier=$2, commission_pct=$3 WHERE code=$1', [
      code,
      multiplier,
      commission,
    ]);
}, 120_000);

afterAll(async () => {
  await teardown();
});

test('rateWarnings theo cấu hình: OTA thấp hơn WEB và kênh trực tiếp dưới 1,00', async () => {
  const response = await http().get('/api/v1/channels').query({ limit: 100 }).set(auth(manager));
  expect(response.status).toBe(200);
  expect(warningsByCode(page.parse(response.body).data)).toEqual(EXPECTED);
});

test('WEB nằm ngoài trang hiện tại vẫn được dùng làm mốc so sánh', async () => {
  const collected: ChannelSummary[] = [];
  let cursor: string | null = null;
  for (let guard = 0; guard < 10; guard += 1) {
    const response = await http()
      .get('/api/v1/channels')
      .query({ limit: 1, ...(cursor === null ? {} : { cursor }) })
      .set(auth(manager));
    expect(response.status).toBe(200);
    const parsed = page.parse(response.body);
    expect(parsed.data).toHaveLength(1);
    collected.push(...parsed.data);
    cursor = parsed.meta.nextCursor;
    if (cursor === null) break;
  }
  expect(collected).toHaveLength(CONFIG.length);
  expect(warningsByCode(collected)).toEqual(EXPECTED);
});

test('đổi cấu hình thì cảnh báo đổi theo, không giữ kết quả cũ', async () => {
  await rows("UPDATE channels SET multiplier=1.250 WHERE code='OTA_BOOKING'");
  const fixed = await http().get('/api/v1/channels').query({ limit: 100 }).set(auth(manager));
  expect(warningsByCode(page.parse(fixed.body).data)['OTA_BOOKING']).toEqual([]);
  await rows("UPDATE channels SET multiplier=1.300 WHERE code='WEB'");
  const raised = await http().get('/api/v1/channels').query({ limit: 100 }).set(auth(manager));
  // WEB tăng hệ số ⇒ mốc so sánh cao hơn: 1,25 × 0,82 = 1,025 < 1,300.
  expect(warningsByCode(page.parse(raised.body).data)['OTA_BOOKING']).toEqual([
    'E_RATE_CHANNEL_PARITY',
  ]);
});
