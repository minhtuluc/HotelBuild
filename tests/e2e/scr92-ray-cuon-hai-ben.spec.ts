import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

/**
 * HB-327 — hai lề trang chủ trên màn rộng: đường ray bám cuộn (trái) và cuống vé bấm lỗ (phải). Màn hẹp hơn
 * 1520 px thì hai lề ẩn hẳn, dải mục lục ngang (HB-325) làm việc này.
 */
test.beforeEach(({}, testInfo) => {
  test.skip(!testInfo.project.name.startsWith('customer-web'), 'ca này chỉ chạy trên customer-web');
});

test.describe('đường ray hai lề trang chủ (HB-327)', () => {
  test('1600 px: đường ray thay dải mục lục ngang; bấm ga nhảy tới dải, bấm lỗ vé tới đó', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1600, height: 900 });
    await page.goto('/');
    const rails = page.getByTestId('scroll-rails');
    const rail = rails.getByRole('navigation');
    await expect(rail).toBeVisible();
    await expect(page.getByTestId('page-toc')).toBeHidden();
    await expect(rail.getByRole('link')).toHaveText([
      'Ba ga',
      'Hạng phòng',
      'Giá',
      'Trả vé',
      'Bốn bước',
      'Hỏi đáp',
    ]);

    await rail.getByRole('link', { name: 'Trả vé' }).click();
    await expect(page).toHaveURL(/#tra-ve$/);
    await expect(rail.getByRole('link', { name: 'Trả vé' })).toHaveAttribute(
      'aria-current',
      'true',
    );
    await expect(rails.locator('.ph-stub-hole[data-punched="true"]')).toHaveCount(4);

    // Hai lề không đè lên chữ của dải nội dung.
    const [railRight, headingLeft] = await Promise.all([
      rail.evaluate((node) => node.getBoundingClientRect().right),
      page.locator('#refund-title').evaluate((node) => node.getBoundingClientRect().left),
    ]);
    expect(headingLeft).toBeGreaterThan(railRight);

    const result = await new AxeBuilder({ page }).include('[data-testid="scroll-rails"]').analyze();
    const serious = result.violations.filter(
      (item) => item.impact === 'serious' || item.impact === 'critical',
    );
    expect(serious.map((item) => item.id)).toEqual([]);
  });

  for (const width of [1280, 360]) {
    test(`${width} px: hai lề ẩn, dải mục lục ngang hiện, không cuộn ngang`, async ({ page }) => {
      await page.setViewportSize({ width, height: 800 });
      await page.goto('/');
      await expect(page.getByTestId('scroll-rails')).toBeHidden();
      await expect(page.getByTestId('page-toc')).toBeVisible();
      const overflow = await page.evaluate(() => {
        const root = document.scrollingElement ?? document.documentElement;
        return root.scrollWidth - root.clientWidth;
      });
      expect(overflow).toBeLessThanOrEqual(1);
    });
  }
});
