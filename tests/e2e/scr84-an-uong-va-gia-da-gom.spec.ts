import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

/**
 * HB-318 — trang ăn uống ở ga (`/dining`) và khối "Giá đã gồm" (theo docs/02-nghiep-vu/tien-nghi-trong-gia.md)
 * trên trang ẩm thực, trang hạng phòng và trang ga.
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

test.describe('Ăn uống ở ga và giá đã gồm (HB-318)', () => {
  test('/dining: ba nhịp có giờ và trạng thái, quanh ba ga, khối giá đã gồm có Dorm, axe sạch', async ({
    page,
  }) => {
    await page.goto('/dining');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Ăn uống ở ga');
    const services = page.getByTestId('dining-services').getByRole('listitem');
    await expect(services).toHaveCount(3);
    await expect(services.nth(0)).toContainText('06:30–10:00');
    await expect(services.nth(0)).toContainText('Gọi riêng tại quầy');
    await expect(services.nth(1)).toContainText('Đã gồm trong giá phòng');
    await expect(services.nth(2)).toContainText('Ga không phục vụ');
    for (const name of ['Ga Đà Lạt', 'Ga Phan Thiết', 'Ga Vũng Tàu']) {
      await expect(page.locator('.ph-dining-nearby dt', { hasText: name })).toBeVisible();
    }
    const includes = page.getByTestId('price-includes');
    await expect(includes).toContainText('Wi‑Fi');
    await expect(includes).toContainText('Thêm cho Dorm');
    await expect(includes).toContainText('Giặt là');
    await expect(includes.getByRole('link')).toHaveCount(0);
    await expect(page.getByTestId('dining-cta')).toHaveAttribute('href', '/#search-block');
    await axeClean(page);
  });

  test('chân trang có link sang trang ăn uống, giữ tiền tố ngôn ngữ', async ({ page }) => {
    await page.goto('/ja');
    const footer = page.getByRole('navigation', { name: 'フッターナビゲーション' });
    await footer.getByRole('link', { name: '食事' }).click();
    await expect(page).toHaveURL(/\/ja\/dining$/);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('駅での食事');
    await expect(page.getByTestId('price-includes')).toContainText('料金に含まれるもの');
  });

  test('trang hạng Deluxe: khối giá đã gồm không có mục Dorm, có link sang trang ăn uống', async ({
    page,
  }) => {
    await page.goto('/room-types/DLX');
    const includes = page.getByTestId('price-includes');
    await expect(includes).toContainText('Mọi hạng phòng');
    await expect(includes).not.toContainText('Thêm cho Dorm');
    await expect(includes.getByRole('link', { name: /Ăn uống ở ga/ })).toHaveAttribute(
      'href',
      '/dining',
    );
    await axeClean(page);
  });

  test('trang ga có khối giá đã gồm; 360px trang ăn uống không cuộn ngang', async ({ page }) => {
    await page.goto('/en/stays/da-lat');
    await expect(page.getByTestId('price-includes')).toContainText('The price includes');
    await page.setViewportSize({ width: 360, height: 800 });
    for (const path of ['/dining', '/ru/dining']) {
      await page.goto(path);
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
        ),
        path,
      ).toBe(true);
    }
  });
});
