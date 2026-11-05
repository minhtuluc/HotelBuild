import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page, type Route } from '@playwright/test';
import { fulfillJson, listBody } from '../operations-web/fake-api';
import { operationsWebOnly } from '../operations-web/guard';
import { loginRefundStaff } from '../operations-web/refund-fixture';

/**
 * SCR-42 (HB-134) trên API giả của BFF. Chỉ chứng minh giao diện; nghiệm thu nghiệp vụ cần API thật,
 * simulator và bằng chứng HB-194. Mọi dữ liệu là tổng hợp, không có PII/PIN/token.
 */
const CHANNEL = {
  id: 'c1',
  code: 'OTA_BOOKING',
  name: 'Synthetic OTA',
  multiplier: 1,
  commissionPct: 15,
  holdMinutes: 30,
  overbookAllowed: false,
  version: 1,
};
const BOOKING = {
  id: 'b1',
  channelId: 'c1',
  eventType: 'booking.created',
  providerEventId: 'ev-1',
  providerBookingCode: 'OTA-1001',
  status: 'PROCESSED',
  bookingId: 'bk-1',
  duplicate: false,
  flagged: false,
  flagReason: null,
  flaggedBy: null,
  flaggedAt: null,
  oversold: true,
  guestNameMasked: 'N*** V*** A',
  receivedAt: '2026-11-10T00:00:00.000Z',
  processedAt: '2026-11-10T00:00:05.000Z',
  errorCode: null,
  version: 4,
};
const FLAGGED = { ...BOOKING, flagged: true, flagReason: 'Trùng mã', version: 5 };
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

async function backend(page: Page, onFlag?: (route: Route, calls: number) => Promise<void>): Promise<Spy> {
  const spy: Spy = { keys: [], matches: [], bodies: [] };
  await page.route('**/api/session/sys/channels*', (route) => fulfillJson(route, 200, listBody([CHANNEL])));
  await page.route('**/api/session/sys/channels/c1/ota-bookings*', (route) =>
    fulfillJson(route, 200, listBody([BOOKING])),
  );
  await page.route('**/api/session/sys/channels/c1/ota-bookings/b1/duplicate-flag', async (route) => {
    const headers = route.request().headers();
    spy.keys.push(headers['idempotency-key'] ?? '');
    spy.matches.push(headers['if-match']);
    spy.bodies.push(route.request().postData() ?? '');
    if (onFlag !== undefined) return onFlag(route, spy.keys.length);
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      headers: { etag: '"5"' },
      body: JSON.stringify(FLAGGED),
    });
  });
  return spy;
}

async function expectNoBlockingViolations(page: Page): Promise<void> {
  const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
  const blocking = results.violations.filter((item) => item.impact === 'serious' || item.impact === 'critical');
  expect(blocking.map((item) => item.id)).toEqual([]);
}

test.describe('SCR-42 booking OTA nhận vào (HB-134)', () => {
  test('browser_keyboard_a11y_responsive', async ({ page }) => {
    const spy = await backend(page);
    await page.goto('/channels/ota-bookings');
    await expect(page.getByTestId('hb134-row-b1')).toContainText('OTA-1001');
    await expect(page.getByTestId('hb134-row-b1')).toContainText('Vượt tồn (oversold)');
    await expectNoBlockingViolations(page);

    // Bàn phím: mở hộp thoại, kiểm lỗi trường, Escape trả focus về nút đã mở nó.
    await page.getByTestId('hb134-flag-b1').focus();
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('hb134-dialog-flag')).toBeVisible();
    await page.getByTestId('hb134-dialog-flag-confirm').focus();
    await page.keyboard.press('Enter');
    await expect(page.locator('#hb134-reason-error')).toContainText('Bắt buộc nhập');
    expect(spy.keys).toHaveLength(0);
    await expectNoBlockingViolations(page);
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('hb134-dialog-flag')).toBeHidden();
    await expect(page.getByTestId('hb134-flag-b1')).toBeFocused();

    // Gửi lệnh: khoá UUIDv4 và If-Match theo phiên bản đã đọc; dòng được thay bằng bản máy chủ xác nhận.
    await page.keyboard.press('Enter');
    await page.getByRole('textbox', { name: 'Lý do' }).fill('Trùng mã');
    await page.getByTestId('hb134-dialog-flag-confirm').focus();
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('hb134-done')).toBeVisible();
    expect(spy.keys).toHaveLength(1);
    expect(spy.keys[0]).toMatch(UUID_V4);
    expect(spy.matches[0]).toBe('"4"');
    expect(spy.bodies[0]).toBe('{"flagged":true,"reason":"Trùng mã"}');
    await expectNoBlockingViolations(page);

    await page.setViewportSize({ width: 360, height: 800 });
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
  });

  test('kết quả chưa rõ giữ nguyên khoá và If-Match khi gửi lại', async ({ page }) => {
    const spy = await backend(page, async (route, calls) => {
      if (calls <= 2) return route.abort('failed');
      return fulfillJson(route, 200, JSON.stringify(FLAGGED));
    });
    await page.goto('/channels/ota-bookings');
    await page.getByTestId('hb134-flag-b1').click();
    await page.getByRole('textbox', { name: 'Lý do' }).fill('Trùng mã');
    await page.getByTestId('hb134-dialog-flag-confirm').click();
    await expect(page.getByTestId('hb134-failure')).toContainText('Chưa biết lệnh đã được áp dụng');
    await page.getByRole('button', { name: 'Gửi lại cùng lệnh' }).click();
    await expect(page.getByTestId('hb134-done')).toBeVisible();
    expect(new Set(spy.keys).size).toBe(1);
    expect(new Set(spy.matches).size).toBe(1);
    expect(new Set(spy.bodies).size).toBe(1);
    expect(spy.keys.length).toBeGreaterThanOrEqual(3);
  });
});
