import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

/**
 * HB-311b — bốn trang toàn chuỗi (đường đến, trải nghiệm, ưu đãi, thư viện ảnh) và menu "Khám phá".
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

async function axeClean(page: Page): Promise<void> {
  const result = await new AxeBuilder({ page }).analyze();
  const serious = result.violations.filter(
    (item) => item.impact === 'serious' || item.impact === 'critical',
  );
  expect(serious.map((item) => `${item.id}: ${item.nodes.length}`)).toEqual([]);
}

async function noHorizontalScroll(page: Page): Promise<void> {
  const overflow = await page.evaluate(() => {
    const root = document.scrollingElement ?? document.documentElement;
    return root.scrollWidth - root.clientWidth;
  });
  expect(overflow).toBeLessThanOrEqual(1);
}

const PAGES = [
  { path: '/getting-here', h1: 'Đường đến ba ga' },
  { path: '/experiences', h1: 'Trải nghiệm quanh ga' },
  { path: '/offers', h1: 'Ở lâu hơn, mỗi đêm rẻ hơn' },
  { path: '/gallery', h1: 'Thư viện ảnh' },
] as const;

test.describe('Trang toàn chuỗi và menu Khám phá (HB-311b)', () => {
  for (const item of PAGES) {
    test(`${item.path}: có h1, axe sạch, không cuộn ngang ở 360 px`, async ({ page }) => {
      await page.setViewportSize({ width: 360, height: 800 });
      await page.goto(item.path);
      await expect(page.getByRole('heading', { level: 1 })).toHaveText(item.h1);
      await noHorizontalScroll(page);
      await axeClean(page);
    });
  }

  test('đường đến: bảng chặng cả ba ga, link trang ga, link e-Visa chính thức', async ({ page }) => {
    await page.goto('/getting-here');
    for (const code of ['DL', 'PT', 'VT']) {
      await expect(page.getByTestId(`getting-here-${code}`).locator('tbody tr')).toHaveCount(2);
    }
    await expect(page.getByTestId('getting-here-PT')).toContainText('ga Phan Thiết');
    await expect(
      page.getByTestId('getting-here-VT').getByRole('link', { name: /Trang ga Vũng Tàu/ }),
    ).toHaveAttribute('href', '/stays/vung-tau');
    await expect(page.getByTestId('evisa-link')).toHaveAttribute('href', 'https://evisa.gov.vn/');
  });

  test('ưu đãi: ba bậc số đêm và thông số bốn gói', async ({ page }) => {
    await page.goto('/offers');
    const tiers = page.getByTestId('los-tiers').getByRole('listitem');
    await expect(tiers).toHaveCount(3);
    await expect(tiers.first()).toContainText('3–6 đêm');
    await expect(tiers.first()).toContainText('× 0,95');
    await expect(page.getByTestId('plan-LONGSTAY14')).toContainText('Ở tối thiểu 14 đêm');
    await expect(page.getByTestId('plan-NONREF')).toContainText('Đổi ngày có phí 10%');
    await expect(page.getByTestId('plan-NONREF')).toContainText('Không giảm theo số đêm');
  });

  test('trải nghiệm: ba hoạt động mỗi ga, nhãn mùa, nút tìm phòng chọn sẵn ga', async ({ page }) => {
    await page.goto('/experiences');
    const daLat = page.getByTestId('experiences-DL');
    await expect(daLat.getByRole('listitem')).toHaveCount(3);
    await expect(daLat).toContainText('Quanh năm');
    await expect(daLat).toContainText('Tháng 11 – 12');
    await expect(daLat.getByRole('link', { name: 'Xem phòng trống ở Đà Lạt' })).toHaveAttribute(
      'href',
      '/?ga=da-lat#search-block',
    );
  });

  test('thư viện ảnh: lọc theo ga, lightbox có link sang trang ga', async ({ page }) => {
    await page.goto('/gallery');
    const gallery = page.getByTestId('gallery');
    // HB-326: 9 ảnh ga + 15 ảnh hạng (3 mỗi hạng) + 9 ảnh hoạt động quanh ga.
    await expect(gallery.getByRole('listitem')).toHaveCount(33);
    await expect(gallery).toHaveAttribute('data-dense', 'true');
    await page.getByTestId('gallery-filter-station').getByRole('button', { name: 'Phan Thiết' }).click();
    // 3 ảnh ga Phan Thiết + 3 ảnh hoạt động quanh ga (HB-326); ảnh hạng không thuộc ga nào.
    await expect(page.getByTestId('gallery').getByRole('listitem')).toHaveCount(6);
    await expect(page.getByTestId('gallery-count')).toHaveText('6 ảnh');
    await page.getByTestId('gallery').getByRole('button').first().click();
    const link = page.getByTestId('gallery-lightbox').getByTestId('gallery-link');
    await expect(link).toHaveAttribute('href', '/stays/phan-thiet');
    await page.keyboard.press('Escape');
    await page.getByTestId('gallery-filter-group').getByRole('button', { name: 'Hạng phòng' }).click();
    await expect(page.getByTestId('gallery-count')).toHaveText('Chưa có ảnh cho lựa chọn này.');
  });

  test('menu Khám phá: mở bằng bàn phím, có đủ trang, Esc đóng và trả tiêu điểm', async ({ page }) => {
    await page.goto('/');
    const toggle = page.getByTestId('explore-toggle');
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await toggle.focus();
    await page.keyboard.press('Enter');
    await expect(toggle).toHaveAttribute('aria-expanded', 'true');
    const panel = page.getByTestId('explore-panel');
    await expect(panel).toBeVisible();
    await expect(panel.getByRole('link')).toHaveCount(9);
    await expect(panel.getByRole('link', { name: 'Thư viện ảnh' })).toHaveAttribute('href', '/gallery');
    await page.keyboard.press('Escape');
    await expect(panel).toBeHidden();
    await expect(toggle).toBeFocused();
    await toggle.click();
    await panel.getByRole('link', { name: 'Đường đến' }).click();
    await expect(page).toHaveURL(/\/getting-here$/);
    await expect(page.getByTestId('explore-panel')).toBeHidden();
  });

  test('menu Khám phá trên điện thoại là ngăn kéo đáy màn; trang tiếng Anh đủ', async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 800 });
    await page.goto('/en/offers');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Stay longer, pay less per night');
    await expect(page.getByTestId('los-tiers')).toContainText('× 0.95');
    await page.getByTestId('explore-toggle').click();
    const panel = page.getByTestId('explore-panel');
    await expect(panel).toBeVisible();
    const box = await panel.boundingBox();
    expect(box?.width).toBeGreaterThanOrEqual(359);
    expect(Math.round((box?.y ?? 0) + (box?.height ?? 0))).toBe(800);
    await expect(panel.getByRole('link', { name: 'Photo gallery' })).toHaveAttribute(
      'href',
      '/en/gallery',
    );
  });
});
