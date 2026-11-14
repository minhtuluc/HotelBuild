import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

/**
 * HB-312 — tiếng Anh: URL `/en/...`, `html lang`, hreflang, chọn ngôn ngữ, link nội bộ giữ locale, tiền và
 * ngày theo `en`. Tiếng Việt ở `/` không đổi (các spec SCR-* hiện có vẫn chạy trên bản không tiền tố).
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

const STAY = 'checkIn=2026-12-24&checkOut=2026-12-26&adults=2&children=0';

async function axeClean(page: Page): Promise<void> {
  const result = await new AxeBuilder({ page }).analyze();
  const serious = result.violations.filter(
    (item) => item.impact === 'serious' || item.impact === 'critical',
  );
  expect(serious.map((item) => `${item.id}: ${item.nodes.length}`)).toEqual([]);
}

test.describe('Tiếng Anh (HB-312)', () => {
  test('/en: html lang, tiêu đề, hreflang đủ ba mục, link nội bộ giữ /en, axe sạch', async ({
    page,
  }) => {
    await page.goto('/en');
    await expect(page.locator('html')).toHaveAttribute('lang', 'en');
    await expect(page).toHaveTitle('Pine Hill · Book direct');
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Night by night.');
    const hreflang = await page
      .locator('link[rel="alternate"][hreflang]')
      .evaluateAll((nodes) => nodes.map((node) => node.getAttribute('hreflang')));
    expect(hreflang.sort()).toEqual(['en', 'vi', 'x-default']);
    const nav = page.getByRole('navigation', { name: 'Main navigation' });
    await expect(nav.getByRole('link', { name: 'My bookings' })).toHaveAttribute(
      'href',
      '/en/bookings',
    );
    await axeClean(page);
  });

  test('chọn ngôn ngữ chuyển qua lại, giữ đường dẫn và tham số', async ({ page }) => {
    await page.goto('/stays/da-lat?from=test');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Ga Đà Lạt');
    await page.getByTestId('language-select').selectOption('en');
    await expect(page).toHaveURL(/\/en\/stays\/da-lat\?from=test$/);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Da Lat Station');
    await page.getByTestId('language-select').selectOption('vi');
    await expect(page).toHaveURL(/\/stays\/da-lat\?from=test$/);
    await expect(page.locator('html')).toHaveAttribute('lang', 'vi');
  });

  test('tìm phòng từ /en sang /en/search, tiền in theo en', async ({ page }) => {
    await page.goto('/en');
    await expect(page.getByTestId('search-block')).toBeVisible();
    await page.getByRole('textbox', { name: 'Check-in', exact: true }).fill('2026-12-24');
    await page.getByRole('textbox', { name: 'Check-out', exact: true }).fill('2026-12-26');
    await expect(page.getByTestId('search-checkIn-line')).toHaveText('Thu, 24/12/2026');
    await page.getByRole('button', { name: 'Search' }).click();
    await expect(page).toHaveURL(/\/en\/search\?/);
    const table = page.getByTestId('availability-table');
    await expect(table).toBeVisible();
    await expect(table).toContainText(/\d{1,3}(,\d{3})+ ₫/);
    await expect(table).not.toContainText(/\d{1,3}(\.\d{3})+ ₫/);
  });

  test('trang nội dung tiếng Anh: trang ga và trang hạng', async ({ page }) => {
    await page.goto('/en/stays/da-lat');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Da Lat Station');
    await expect(page.getByTestId('station-cta')).toHaveAttribute(
      'href',
      '/en?ga=da-lat#search-block',
    );
    await page.goto('/en/room-types/DLX');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Deluxe class');
    await expect(page.getByTestId('cabin-spec')).toContainText('3 adults');
    await axeClean(page);
  });

  test('báo giá SCR-03 bằng tiếng Anh: bảng giá từng đêm, giờ VN có nhãn tiếng Anh', async ({
    page,
  }) => {
    await page.goto(`/en/rooms/synthetic-room?propertyId=synthetic-property&${STAY}`);
    await expect(page.getByTestId('nights-table')).toContainText('Nightly price');
    await expect(page.locator('main')).toContainText('(Vietnam time)');
    await expect(page.locator('main')).not.toContainText('giờ VN');
  });

  test('360px: /en không cuộn ngang', async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 800 });
    await page.goto('/en');
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
      ),
    ).toBe(true);
  });
});
