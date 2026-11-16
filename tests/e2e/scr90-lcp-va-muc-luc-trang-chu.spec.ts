import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

/**
 * HB-325 — ảnh đầu trang nhiều cỡ (LCP Lighthouse mobile < 2,5 s) và mục lục bám cuộn trang chủ (UX-06).
 * Khung điện thoại giống cấu hình Lighthouse mobile: 412 px, mật độ điểm ảnh 1,75.
 */
test.beforeEach(({}, testInfo) => {
  test.skip(!testInfo.project.name.startsWith('customer-web'), 'ca này chỉ chạy trên customer-web');
});

test.describe('ảnh đầu trang ga trên điện thoại (HB-325)', () => {
  test.use({ viewport: { width: 412, height: 823 }, deviceScaleFactor: 1.75, isMobile: true });

  test('áp phích có srcset; trình duyệt tải bản 640w thay vì ảnh gốc 1200px', async ({ page }) => {
    const loaded: string[] = [];
    page.on('response', (response) => {
      if (response.url().includes('/images/pine-hill/ga-DL-poster')) loaded.push(response.url());
    });
    await page.goto('/stays/da-lat');
    const poster = page.locator('figure.ph-content-poster img.ph-photo');
    await expect(poster).toHaveAttribute('src', '/images/pine-hill/ga-DL-poster.webp');
    await expect(poster).toHaveAttribute('srcset', /ga-DL-poster-640w\.webp 640w/);
    await expect(poster).toHaveAttribute('fetchpriority', 'high');
    await expect
      .poll(() => poster.evaluate((node) => node instanceof HTMLImageElement && node.complete))
      .toBe(true);
    const current = await poster.evaluate((node) =>
      node instanceof HTMLImageElement ? node.currentSrc : '',
    );
    expect(current).toMatch(/ga-DL-poster-640w\.webp$/);
    expect(loaded.some((url) => url.endsWith('/ga-DL-poster.webp'))).toBe(false);
  });
});

test.describe('mục lục bám cuộn trang chủ (HB-325, UX-06)', () => {
  test('sáu mục, nhảy tới dải và đánh dấu aria-current; dải neo luôn trong màn hình', async ({
    page,
  }) => {
    await page.goto('/');
    const toc = page.getByTestId('page-toc');
    await expect(toc.getByRole('link')).toHaveText([
      'Ba ga',
      'Hạng phòng',
      'Giá',
      'Trả vé',
      'Bốn bước',
      'Hỏi đáp',
    ]);
    await toc.getByRole('link', { name: 'Trả vé' }).click();
    await expect(page).toHaveURL(/#tra-ve$/);
    await expect(toc.getByRole('link', { name: 'Trả vé' })).toHaveAttribute('aria-current', 'true');
    await expect(toc).toBeInViewport();
    // Tiêu đề dải không nằm dưới dải neo dính.
    const [tocBottom, headingTop] = await Promise.all([
      toc.evaluate((node) => node.getBoundingClientRect().bottom),
      page.locator('#refund-title').evaluate((node) => node.getBoundingClientRect().top),
    ]);
    expect(headingTop).toBeGreaterThanOrEqual(tocBottom);
  });

  test('360 px: không cuộn ngang, axe sạch; tiếng Anh có nhãn dịch', async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 800 });
    await page.goto('/');
    await expect(page.getByTestId('page-toc')).toBeVisible();
    const overflow = await page.evaluate(() => {
      const root = document.scrollingElement ?? document.documentElement;
      return root.scrollWidth - root.clientWidth;
    });
    expect(overflow).toBeLessThanOrEqual(1);
    const result = await new AxeBuilder({ page }).analyze();
    const serious = result.violations.filter(
      (item) => item.impact === 'serious' || item.impact === 'critical',
    );
    expect(serious.map((item) => item.id)).toEqual([]);
    await page.goto('/en');
    await expect(page.getByTestId('page-toc').getByRole('link').first()).toHaveText('Stations');
  });
});
