import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

/** SCR-01 chỉ có ở web khách (ADR-018) — ca này chạy trên project customer-web. */
function customerWebOnly(): void {
  test.beforeEach(({}, testInfo) => {
    test.skip(!testInfo.project.name.startsWith('customer-web'), 'ca này chỉ chạy trên customer-web');
  });
}

const JOURNEY_PUBLIC_PROPERTIES = '**/api/session/journey/public/properties';

customerWebOnly();

async function openHome(page: Page): Promise<void> {
  await page.goto('/');
  await expect(page.getByTestId('search-block')).toBeVisible();
}

test.describe('SCR-01 trang chủ & khối tìm phòng (HB-080)', () => {
  test('hiện khối tìm phòng với cơ sở lấy từ tuyến công khai (AC1)', async ({ page }) => {
    await openHome(page);
    await expect(page.getByRole('heading', { name: 'Tìm phòng trống' })).toBeVisible();
    await expect(page.getByLabel('Cơ sở')).toHaveValue('synthetic-property');
    await expect(page.getByLabel('Cơ sở').locator('option')).toHaveText(['Synthetic Pine Hill']);
    await expect(page.getByLabel('Người lớn')).toHaveValue('2');
    await expect(page.getByLabel('Trẻ em')).toHaveValue('0');
  });

  test('gửi tìm điều hướng sang SCR-02 kèm tham số kỳ và số khách (AC1)', async ({ page }) => {
    await openHome(page);
    await page.getByLabel('Nhận phòng').fill('2026-12-24');
    await page.getByLabel('Trả phòng').fill('2026-12-27');
    await page.getByLabel('Người lớn').fill('3');
    await page.getByLabel('Trẻ em').fill('1');
    await page.getByRole('button', { name: 'Tìm phòng' }).click();
    await expect(page).toHaveURL(/\/search\?/);
    const url = new URL(page.url());
    expect(url.pathname).toBe('/search');
    expect(url.searchParams.get('propertyId')).toBe('synthetic-property');
    expect(url.searchParams.get('checkIn')).toBe('2026-12-24');
    expect(url.searchParams.get('checkOut')).toBe('2026-12-27');
    expect(url.searchParams.get('adults')).toBe('3');
    expect(url.searchParams.get('children')).toBe('1');
  });

  test('validate tại chỗ chặn gửi khi kỳ không có đêm nào và giữ bản nhập (AC1)', async ({
    page,
  }) => {
    await openHome(page);
    await page.getByLabel('Nhận phòng').fill('2026-12-27');
    await page.getByLabel('Trả phòng').fill('2026-12-27');
    await page.getByRole('button', { name: 'Tìm phòng' }).click();
    await expect(page.getByText('checkOut: BEFORE_START')).toBeVisible();
    expect(new URL(page.url()).pathname).toBe('/');
    // Bản nhập không bị mất khi bị chặn tại chỗ.
    await expect(page.getByLabel('Nhận phòng')).toHaveValue('2026-12-27');
    await expect(page.getByLabel('Trả phòng')).toHaveValue('2026-12-27');
  });

  test('lỗi đọc danh sách cơ sở hiện băng lỗi, thử lại thì hiện lại form (AC2)', async ({
    page,
  }) => {
    await page.route(JOURNEY_PUBLIC_PROPERTIES, (route) =>
      route.fulfill({ status: 500, contentType: 'application/json', body: '{}' }),
    );
    await openHome(page);
    await expect(page.getByTestId('search-block').getByRole('alert')).toContainText(
      'Không tải được danh sách cơ sở',
    );
    await expect(page.getByTestId('search-form')).toHaveCount(0);

    await page.unroute(JOURNEY_PUBLIC_PROPERTIES);
    await page.getByRole('button', { name: 'Thử lại' }).click();
    await expect(page.getByTestId('search-form')).toBeVisible();
    await expect(page.getByLabel('Cơ sở')).toHaveValue('synthetic-property');
  });

  test('không có vi phạm axe serious/critical (AC2)', async ({ page }) => {
    await openHome(page);
    const results = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
      .analyze();
    const blocking = results.violations.filter(
      (violation) => violation.impact === 'serious' || violation.impact === 'critical',
    );
    expect(blocking).toEqual([]);
  });

  test('không cuộn ngang ở bề rộng 360 px (AC2)', async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 800 });
    await openHome(page);
    const overflow = await page.evaluate(() => {
      const element = document.scrollingElement;
      return element === null ? 0 : element.scrollWidth - element.clientWidth;
    });
    expect(overflow).toBeLessThanOrEqual(1);
  });
});
