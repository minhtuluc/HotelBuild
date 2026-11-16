import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Locator, type Page } from '@playwright/test';

/**
 * HB-326 — ảnh minh hoạ cho các chỗ còn chờ ảnh: ảnh nhiều góc của hạng, ảnh hoạt động quanh ga
 * (/experiences), ảnh ăn uống (/dining). Ảnh tải được (không vỡ), có alt, có `srcset`.
 */
test.beforeEach(({}, testInfo) => {
  test.skip(!testInfo.project.name.startsWith('customer-web'), 'ca này chỉ chạy trên customer-web');
});

/** Ảnh đã tải xong và không vỡ (bề rộng thật > 0). Cuộn tới trước vì ảnh `lazy`. */
async function expectLoaded(images: Locator): Promise<void> {
  const count = await images.count();
  for (let index = 0; index < count; index++) {
    const image = images.nth(index);
    await image.scrollIntoViewIfNeeded();
    await expect
      .poll(() =>
        image.evaluate((node) => node instanceof HTMLImageElement && node.complete && node.naturalWidth > 0),
      )
      .toBe(true);
    await expect(image).not.toHaveAttribute('alt', '');
    await expect(image).toHaveAttribute('srcset', /640w/);
  }
}

async function noHorizontalScroll(page: Page): Promise<void> {
  const overflow = await page.evaluate(() => {
    const root = document.scrollingElement ?? document.documentElement;
    return root.scrollWidth - root.clientWidth;
  });
  expect(overflow).toBeLessThanOrEqual(1);
}

test.describe('Ảnh minh hoạ cho các chỗ còn chờ ảnh (HB-326)', () => {
  test('trang hạng: gallery có ba ảnh (ảnh hạng và hai ảnh nhiều góc)', async ({ page }) => {
    await page.goto('/room-types/DOR');
    const gallery = page.getByTestId('gallery');
    await expect(gallery.getByRole('listitem')).toHaveCount(3);
    await gallery.getByRole('button').nth(1).click();
    await expect(page.getByTestId('gallery-figure').locator('img')).toHaveAttribute(
      'src',
      '/images/pine-hill/hang-DOR-2.webp',
    );
  });

  test('/experiences: chín hoạt động đều có ảnh tải được, alt tiếng Việt', async ({ page }) => {
    await page.goto('/experiences');
    const photos = page.locator('.ph-experience img.ph-experience-photo');
    await expect(photos).toHaveCount(9);
    await expect(photos.first()).toHaveAttribute('alt', 'Con đường vòng qua đồi thông Đà Lạt dưới trời xanh');
    await expectLoaded(photos);
  });

  test('/dining: ba dịch vụ đều có ảnh tải được', async ({ page }) => {
    await page.goto('/dining');
    const photos = page.getByTestId('dining-services').locator('img.ph-dining-photo');
    await expect(photos).toHaveCount(3);
    await expectLoaded(photos);
  });

  test('360 px: /experiences và /dining không cuộn ngang, axe sạch; tiếng Anh có alt dịch', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 360, height: 800 });
    for (const path of ['/experiences', '/dining']) {
      await page.goto(path);
      await noHorizontalScroll(page);
      const result = await new AxeBuilder({ page }).analyze();
      const serious = result.violations.filter(
        (item) => item.impact === 'serious' || item.impact === 'critical',
      );
      expect(serious.map((item) => `${path} ${item.id}`)).toEqual([]);
    }
    await page.goto('/en/dining');
    await expect(page.locator('img.ph-dining-photo').first()).toHaveAttribute(
      'alt',
      'Two banh mi sandwiches with fresh herbs in paper wrapping',
    );
  });
});
