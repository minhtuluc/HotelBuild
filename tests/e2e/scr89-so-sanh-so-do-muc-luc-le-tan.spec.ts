import { randomInt } from 'node:crypto';
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import type { createSessionClient } from '../../packages/web-session/src/client.js';

/**
 * HB-323 — so sánh năm hạng (FEAT-05), sơ đồ hai chiều và mặt cắt khoang (UX-02), mục lục trang ga (UX-06),
 * liên hệ lễ tân khi lỗi mạng ở SCR-03/SCR-04 (P6: không `mailto:`, không giữ chỗ ngoài hệ thống).
 */
function customerWebOnly(): void {
  test.beforeEach(({}, testInfo) => {
    test.skip(
      !testInfo.project.name.startsWith('customer-web'),
      'ca này chỉ chạy trên customer-web',
    );
  });
}

customerWebOnly();

const QUOTES = '**/api/session/journey/quotes*';
const STAY = 'propertyId=synthetic-property&checkIn=2026-12-24&checkOut=2026-12-26&adults=2&children=0';
const origin = new URL(process.env.E2E_API_BASE_URL ?? 'http://127.0.0.1:4000/api/v1').origin;

async function axeClean(page: Page): Promise<void> {
  const result = await new AxeBuilder({ page }).analyze();
  const serious = result.violations.filter(
    (item) => item.impact === 'serious' || item.impact === 'critical',
  );
  expect(serious.map((item) => `${item.id}: ${item.nodes.length}`)).toEqual([]);
}

/** Đặt phòng cần phiên khách: như `scr04-05`, nạp session client của BFF rồi đăng nhập SĐT tổng hợp. */
async function loginGuest(page: Page): Promise<void> {
  await page.goto('/');
  await page.evaluate(async (url) => {
    const module: { createSessionClient: typeof createSessionClient } = await import(url);
    window.sessionClient = module.createSessionClient({ kind: 'guest' });
  }, `${origin}/__test/session-client.js`);
  await page.evaluate(
    (phone) => window.sessionClient?.login({ phone, password: 'Synthetic-password' }),
    `+84${String(randomInt(1000000000)).padStart(9, '0')}`,
  );
}

test.describe('So sánh hạng, sơ đồ, mục lục, liên hệ lễ tân (HB-323)', () => {
  test('bảng so sánh năm hạng: hàng đang xem có aria-current, Dorm bán theo giường; axe sạch', async ({
    page,
  }) => {
    await page.goto('/room-types/FAM');
    const table = page.getByTestId('class-compare');
    await expect(table.locator('tbody tr')).toHaveCount(5);
    await expect(page.getByTestId('compare-FAM')).toHaveAttribute('aria-current', 'true');
    await expect(page.getByTestId('compare-FAM')).toContainText('Đang xem');
    await expect(page.getByTestId('compare-DOR')).toContainText('Từng giường');
    await expect(page.getByTestId('compare-DOR')).toContainText('6');
    await expect(page.getByTestId('compare-DLX').getByRole('link', { name: 'Deluxe' })).toHaveAttribute(
      'href',
      '/room-types/DLX',
    );
    await axeClean(page);
  });

  test('bảng so sánh đọc được ở 360 px, không cuộn ngang', async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 800 });
    await page.goto('/room-types/SUP');
    await expect(page.getByTestId('compare-SUP')).toBeVisible();
    const overflow = await page.evaluate(() => {
      const root = document.scrollingElement ?? document.documentElement;
      return root.scrollWidth - root.clientWidth;
    });
    expect(overflow).toBeLessThanOrEqual(1);
  });

  test('trang chủ: rê vào ga trên sơ đồ tuyến thì thẻ ga nổi viền', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    await page.locator('.ph-route-stop[data-code="PT"] a').hover();
    await expect(page.locator('#ga-PT')).toHaveAttribute('data-sync-active', 'true');
    await expect(page.locator('#ga-DL')).not.toHaveAttribute('data-sync-active', 'true');
    await page.locator('#ga-VT h3').hover();
    await expect(page.locator('.ph-route-stop[data-code="VT"]')).toHaveAttribute(
      'data-sync-active',
      'true',
    );
  });

  test('mặt cắt khoang: mũi tên chuyển khoang, tóm tắt đổi, hàng hạng nổi viền; axe sạch', async ({
    page,
  }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    const diagram = page.getByTestId('cabin-diagram');
    await expect(diagram.getByRole('radio')).toHaveCount(5);
    await page.getByTestId('cabin-car-STD').click();
    await expect(page.getByTestId('cabin-summary')).toContainText('2 chỗ ngủ');
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('ArrowRight');
    await expect(page.getByTestId('cabin-car-DLX')).toBeFocused();
    await expect(page.getByTestId('cabin-car-DLX')).toHaveAttribute('aria-checked', 'true');
    await expect(page.getByTestId('cabin-summary')).toContainText('Deluxe · Khoang ba · 3 chỗ ngủ');
    await expect(page.locator('.ph-class[data-code="DLX"]')).toHaveAttribute('data-sync-active', 'true');
    await page.keyboard.press('End');
    await expect(page.getByTestId('cabin-summary')).toContainText('bán từng giường, 6 giường');
    await axeClean(page);
  });

  test('trang ga: mục lục bám cuộn đánh dấu mục đang đọc', async ({ page }) => {
    await page.goto('/stays/da-lat');
    const toc = page.getByTestId('page-toc');
    await expect(toc.getByRole('link')).toHaveCount(5);
    await toc.getByRole('link', { name: 'Một ngày tại ga' }).click();
    await expect(page).toHaveURL(/#mot-ngay$/);
    await expect(toc.getByRole('link', { name: 'Một ngày tại ga' })).toHaveAttribute(
      'aria-current',
      'true',
    );
    await expect(toc).toBeInViewport();
  });

  test('SCR-03 lỗi mạng: dòng liên hệ lễ tân cạnh "Thử lại", không mailto', async ({ page }) => {
    await page.route(QUOTES, (route) => route.abort('internetdisconnected'));
    await page.goto(`/rooms/synthetic-room?${STAY}`);
    const alert = page.getByRole('alert').filter({ has: page.getByRole('button', { name: 'Thử lại' }) });
    await expect(alert.getByTestId('front-desk-line')).toContainText('lễ tân');
    await expect(page.locator('a[href^="mailto:"]')).toHaveCount(0);
  });

  test('SCR-04 lỗi mạng: dòng liên hệ lễ tân cạnh "Thử lại", không mailto', async ({ page }) => {
    await loginGuest(page);
    await page.route(QUOTES, (route) => route.abort('internetdisconnected'));
    await page.goto(`/book?${STAY}&roomTypeId=synthetic-room&ratePlanCode=FLEX7&roomCount=1`);
    await expect(page.getByTestId('book-screen')).toBeVisible();
    const alert = page.getByRole('alert').filter({ has: page.getByRole('button', { name: 'Thử lại' }) });
    await expect(alert.getByTestId('front-desk-line')).toContainText('lễ tân');
    await expect(page.locator('a[href^="mailto:"]')).toHaveCount(0);
  });
});
