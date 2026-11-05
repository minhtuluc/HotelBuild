import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page, type Route } from '@playwright/test';
import { fulfillJson, listBody } from '../operations-web/fake-api';
import { operationsWebOnly } from '../operations-web/guard';
import { loginRefundStaff } from '../operations-web/refund-fixture';

/**
 * SCR-40 (HB-132) trên API giả của BFF. Chỉ chứng minh giao diện; nghiệm thu nghiệp vụ cần API thật
 * và bằng chứng HB-194. Mọi dữ liệu là tổng hợp, không có PII/PIN/token.
 */
const PROPERTY = {
  id: 'journey-standard',
  name: 'Synthetic Hill',
  status: 'ACTIVE',
  activeRoomCount: 20,
  overbookLimitPct: 5,
  checkInTime: '14:00',
  checkOutTime: '12:00',
  version: 1,
};
const CHANNEL = {
  id: 'c1',
  code: 'OTA_BOOKING',
  name: 'Synthetic OTA',
  multiplier: 1,
  commissionPct: 15,
  holdMinutes: 30,
  overbookAllowed: true,
  version: 1,
};
const ROOM_TYPE = {
  id: 'rt1',
  propertyId: 'journey-standard',
  code: 'DOR',
  capacityAdults: 1,
  capacityChildren: 0,
  basePrice: 100000,
  minPrice: 100000,
  maxPrice: 100000,
  allowShared: true,
  bedCount: 6,
  sellingUnits: 6,
  version: 1,
};
const MAPPING_VIEW = {
  channelId: 'c1',
  version: 2,
  mapping: {
    id: 'm1',
    channelId: 'c1',
    roomTypeId: 'rt1',
    providerRoomTypeCode: 'OTA-DORM',
    allotmentPct: 40,
    externalRatePlanCode: null,
    status: 'ACTIVE',
    version: 2,
    updatedAt: '2026-11-10T01:00:00.000Z',
  },
};
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

operationsWebOnly();
test.beforeEach(async ({ page, request }) => {
  await loginRefundStaff(page, request, 'OWNER');
});

interface Spy {
  keys: string[];
  matches: (string | undefined)[];
  bodies: string[];
}

async function backend(page: Page, onMapping?: (route: Route, calls: number) => Promise<void>): Promise<Spy> {
  const spy: Spy = { keys: [], matches: [], bodies: [] };
  const rows = [
    { date: '2026-11-10', allotment: 3, used: 1 },
    { date: '2026-11-11', allotment: 4, used: 2 },
  ];
  await page.route('**/api/session/sys/properties*', (route) => fulfillJson(route, 200, listBody([PROPERTY])));
  await page.route('**/api/session/sys/room-types*', (route) => fulfillJson(route, 200, listBody([ROOM_TYPE])));
  await page.route('**/api/session/sys/channels*', (route) => fulfillJson(route, 200, listBody([CHANNEL])));
  await page.route('**/api/session/sys/channel-allotments*', (route) => fulfillJson(route, 200, listBody(rows)));
  await page.route('**/api/session/sys/channels/c1/mappings', async (route) => {
    const headers = route.request().headers();
    spy.keys.push(headers['idempotency-key'] ?? '');
    spy.matches.push(headers['if-match']);
    spy.bodies.push(route.request().postData() ?? '');
    if (onMapping !== undefined) return onMapping(route, spy.keys.length);
    return route.fulfill({ status: 200, contentType: 'application/json', headers: { etag: '"2"' }, body: JSON.stringify(MAPPING_VIEW) });
  });
  return spy;
}

async function fillMapping(page: Page): Promise<void> {
  await page.getByRole('textbox', { name: 'Mã phòng OTA' }).fill('OTA-DORM');
  await page.getByRole('textbox', { name: 'Hạn mức (%)' }).fill('40');
}

async function expectNoBlockingViolations(page: Page): Promise<void> {
  const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
  const blocking = results.violations.filter((item) => item.impact === 'serious' || item.impact === 'critical');
  expect(blocking.map((item) => item.id)).toEqual([]);
}

test.describe('SCR-40 cấu hình kênh bán (HB-132)', () => {
  test('browser_keyboard_a11y_responsive', async ({ page }) => {
    const spy = await backend(page);
    await page.goto('/channels/configuration');
    await expect(page.getByTestId('hb132-config')).toContainText('5%');
    await expect(page.getByTestId('hb132-allotments')).toContainText('Hạn mức');
    await expectNoBlockingViolations(page);

    // Lỗi trường: có chữ, gắn trường, aria-invalid, không gửi mạng.
    await page.getByTestId('hb132-mapping-submit').focus();
    await page.keyboard.press('Enter');
    await expect(page.locator('#hb132-providerRoomTypeCode-error')).toContainText('Bắt buộc nhập');
    await expect(page.getByRole('textbox', { name: 'Mã phòng OTA' })).toHaveAttribute('aria-invalid', 'true');
    expect(spy.keys).toHaveLength(0);

    // Bằng bàn phím: mở hộp thoại, Escape trả focus về nút đã mở nó.
    await fillMapping(page);
    await page.getByTestId('hb132-mapping-submit').focus();
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('hb132-dialog-mapping')).toBeVisible();
    await expectNoBlockingViolations(page);
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('hb132-dialog-mapping')).toBeHidden();
    await expect(page.getByTestId('hb132-mapping-submit')).toBeFocused();

    // Xác nhận: một PUT, khoá UUIDv4, tạo mới không If-Match; thành công do máy chủ xác nhận.
    await page.keyboard.press('Enter');
    await page.getByTestId('hb132-dialog-mapping-confirm').focus();
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('hb132-done')).toBeVisible();
    await expect(page.getByTestId('hb132-confirmed-mapping')).toContainText('OTA-DORM');
    expect(spy.keys).toHaveLength(1);
    expect(spy.keys[0]).toMatch(UUID_V4);
    expect(spy.matches[0]).toBeUndefined();
    await expectNoBlockingViolations(page);

    await page.setViewportSize({ width: 360, height: 800 });
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
  });

  test('kết quả chưa rõ giữ nguyên khoá khi gửi lại', async ({ page }) => {
    const spy = await backend(page, async (route, calls) => {
      if (calls <= 2) return route.abort('failed');
      return route.fulfill({ status: 200, contentType: 'application/json', headers: { etag: '"2"' }, body: JSON.stringify(MAPPING_VIEW) });
    });
    await page.goto('/channels/configuration');
    await fillMapping(page);
    await page.getByTestId('hb132-mapping-submit').click();
    await page.getByTestId('hb132-dialog-mapping-confirm').click();
    await expect(page.getByTestId('hb132-failure')).toContainText('Chưa biết lệnh đã được áp dụng');
    await page.getByRole('button', { name: 'Gửi lại cùng lệnh' }).click();
    await expect(page.getByTestId('hb132-done')).toBeVisible();
    expect(new Set(spy.keys).size).toBe(1);
    expect(new Set(spy.bodies).size).toBe(1);
    expect(spy.keys.length).toBeGreaterThanOrEqual(3);
  });
});
