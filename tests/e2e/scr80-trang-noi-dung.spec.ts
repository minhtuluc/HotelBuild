import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

/**
 * HB-310 — trang nội dung mẫu: tờ giới thiệu ga (`/stays/da-lat`) và hạng khoang (`/room-types/DLX`).
 * Giờ nhận/trả phòng lấy từ `GET /public/properties` (giả lập qua route để khớp tên ga); không có giá.
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

const JOURNEY_PUBLIC_PROPERTIES = '**/api/session/journey/public/properties';

const PROPERTIES = [
  { id: 'p-vt', name: 'Pine Hill Vũng Tàu', checkInTime: '14:00', checkOutTime: '12:00' },
  { id: 'p-dl', name: 'Pine Hill Đà Lạt', checkInTime: '13:30', checkOutTime: '11:30' },
];

async function mockProperties(page: Page, status = 200): Promise<void> {
  await page.route(JOURNEY_PUBLIC_PROPERTIES, (route) =>
    route.fulfill({
      status,
      contentType: 'application/json',
      body: JSON.stringify(
        status === 200
          ? { data: PROPERTIES, meta: { limit: 20, nextCursor: null, hasMore: false, total: 2 } }
          : {},
      ),
    }),
  );
}

async function axeClean(page: Page): Promise<void> {
  const result = await new AxeBuilder({ page }).analyze();
  const serious = result.violations.filter(
    (item) => item.impact === 'serious' || item.impact === 'critical',
  );
  expect(serious.map((item) => `${item.id}: ${item.nodes.length}`)).toEqual([]);
}

test.describe('Tờ giới thiệu ga Đà Lạt (HB-310)', () => {
  test('đầu trang, giờ nhận/trả từ API, ga đang xem đánh dấu trên sơ đồ tuyến, axe sạch', async ({
    page,
  }) => {
    await mockProperties(page);
    await page.goto('/stays/da-lat');
    await expect(page).toHaveTitle('Ga Đà Lạt · Pine Hill');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Ga Đà Lạt');
    await expect(page.getByTestId('station-check-in')).toHaveText('13:30');
    await expect(page.getByTestId('station-check-out')).toHaveText('11:30');
    await expect(page.getByRole('link', { name: /Đà Lạt/ }).and(page.locator('[aria-current="page"]'))).toHaveCount(1);
    await expect(page.getByRole('navigation', { name: 'Đường dẫn' })).toContainText('Trang chủ');
    await expect(page.locator('link[rel="canonical"]')).toHaveAttribute('href', /\/stays\/da-lat$/);
    const jsonLd = await page.locator('script[type="application/ld+json"]').allTextContents();
    expect(jsonLd.some((text) => text.includes('"@type":"Hotel"'))).toBe(true);
    expect(jsonLd.some((text) => text.includes('"@type":"BreadcrumbList"'))).toBe(true);
    await expect(page.locator('main')).not.toContainText('₫');
    await axeClean(page);
  });

  test('không đọc được API: giờ in --:-- kèm lời dẫn, không đoán giờ', async ({ page }) => {
    await mockProperties(page, 500);
    await page.goto('/stays/da-lat');
    await expect(page.getByTestId('station-check-in')).toHaveText('--:--');
    await expect(page.getByTestId('station-times-note')).toBeVisible();
  });

  test('lightbox: Enter mở, ←/→ đổi ảnh, Esc đóng và trả tiêu điểm về ảnh đã mở', async ({
    page,
  }) => {
    await mockProperties(page);
    await page.goto('/stays/da-lat');
    const second = page.getByRole('button', { name: /^Xem ảnh 2\/4:/ });
    await second.focus();
    await page.keyboard.press('Enter');
    const lightbox = page.getByTestId('gallery-lightbox');
    await expect(lightbox).toBeVisible();
    await expect(page.getByTestId('gallery-position')).toHaveText('Ảnh 2/4');
    await page.keyboard.press('ArrowRight');
    await expect(page.getByTestId('gallery-position')).toHaveText('Ảnh 3/4');
    await page.keyboard.press('ArrowLeft');
    await page.keyboard.press('ArrowLeft');
    await expect(page.getByTestId('gallery-position')).toHaveText('Ảnh 1/4');
    await page.keyboard.press('ArrowLeft');
    await expect(page.getByTestId('gallery-position')).toHaveText('Ảnh 4/4');
    await axeClean(page);
    await page.keyboard.press('Escape');
    await expect(lightbox).toHaveCount(0);
    await expect(second).toBeFocused();
  });

  test('CTA về khối tìm phòng trang chủ với ga Đà Lạt chọn sẵn', async ({ page }) => {
    await mockProperties(page);
    await page.goto('/stays/da-lat');
    await page.getByTestId('station-cta').click();
    await expect(page).toHaveURL(/\/\?ga=da-lat#search-block$/);
    await expect(page.getByLabel('Cơ sở')).toHaveValue('p-dl');
  });

  test('trang chủ có link sang tờ giới thiệu ga và trang hạng đã có', async ({ page }) => {
    await mockProperties(page);
    await page.goto('/');
    await expect(page.getByRole('link', { name: 'Đọc thêm về ga Đà Lạt', exact: true })).toHaveAttribute(
      'href',
      '/stays/da-lat',
    );
    await expect(page.getByRole('link', { name: 'Đọc thêm về ga Phan Thiết' })).toHaveCount(0);
    await expect(page.getByRole('link', { name: 'Deluxe', exact: true })).toHaveAttribute(
      'href',
      '/room-types/DLX',
    );
  });

  test('360px: không cuộn ngang, cuống vé dính không che chân trang', async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 780 });
    await mockProperties(page);
    await page.goto('/stays/da-lat');
    await expect(page.getByTestId('sticky-stub')).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(360);
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    const covered = await page.evaluate(() => {
      const footer = document.querySelector('footer')?.getBoundingClientRect();
      const stub = document.querySelector('[data-testid="sticky-stub"]')?.getBoundingClientRect();
      return footer !== undefined && stub !== undefined && footer.bottom > stub.top + 1;
    });
    expect(covered).toBe(false);
    await axeClean(page);
  });

  test('ga chưa có trang trả 404', async ({ page }) => {
    const response = await page.goto('/stays/khong-co-ga');
    expect(response?.status()).toBe(404);
  });
});

test.describe('Hạng khoang Deluxe (HB-310)', () => {
  test('mặt sau vé in thông số có nguồn, có ở ba ga, không có giá; axe sạch', async ({ page }) => {
    await page.goto('/room-types/DLX');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Hạng Deluxe');
    const spec = page.getByTestId('cabin-spec');
    await expect(spec).toContainText('3 người lớn');
    await expect(spec).toContainText('3 chỗ');
    await expect(spec).not.toContainText('₫');
    await expect(spec).not.toContainText('m²');
    const served = page.getByRole('region', { name: 'Có ở ga' });
    await expect(served.getByRole('listitem')).toHaveText([/Đà Lạt/, /Phan Thiết/, /Vũng Tàu/]);
    await expect(served.getByRole('link', { name: 'Đà Lạt' })).toHaveAttribute('href', '/stays/da-lat');
    const jsonLd = await page.locator('script[type="application/ld+json"]').allTextContents();
    expect(jsonLd.some((text) => text.includes('"@type":"HotelRoom"'))).toBe(true);
    await axeClean(page);
  });

  test('mã hạng chưa có trang trả 404', async ({ page }) => {
    const response = await page.goto('/room-types/STD');
    expect(response?.status()).toBe(404);
  });
});
