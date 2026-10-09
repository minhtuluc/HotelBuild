import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

/** SCR-02/SCR-03 chỉ có ở web khách (ADR-018). */
function customerWebOnly(): void {
  test.beforeEach(({}, testInfo) => {
    test.skip(!testInfo.project.name.startsWith('customer-web'), 'ca này chỉ chạy trên customer-web');
  });
}

const AVAILABILITY = '**/api/session/journey/inventory/availability*';
const QUOTES = '**/api/session/journey/quotes*';
const STAY = 'checkIn=2026-12-24&checkOut=2026-12-26&adults=2&children=0';

customerWebOnly();

test.describe('SCR-02/SCR-03 kết quả tìm phòng & giá từng đêm (HB-081)', () => {
  test('SCR-02 hiện loại phòng, giá từ/đêm và tổng từ của cả kỳ (AC1)', async ({ page }) => {
    await page.goto(`/search?propertyId=synthetic-property&${STAY}`);
    const row = page.getByTestId('availability-row-synthetic-room');
    await expect(row).toContainText('Synthetic room');
    await expect(row).toContainText('STD');
    await expect(row).toContainText('3');
    await expect(row).toContainText('1.000.000 ₫');
    await expect(row).toContainText('2.000.000 ₫');
    await expect(row.getByRole('link')).toHaveAttribute(
      'href',
      `/rooms/synthetic-room?propertyId=synthetic-property&${STAY}&roomCount=1`,
    );
  });

  test('SCR-02 không còn loại phòng nào thì hiện trạng thái rỗng (AC1)', async ({ page }) => {
    await page.route(AVAILABILITY, (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          checkIn: '2026-12-24',
          checkOut: '2026-12-26',
          nights: 2,
          data: [],
          meta: { limit: 20, nextCursor: null, hasMore: false, total: 0 },
        }),
      }),
    );
    await page.goto(`/search?propertyId=synthetic-property&${STAY}`);
    await expect(page.getByTestId('availability-table')).toHaveCount(0);
    await expect(page.getByTestId('search-results')).toContainText('Hết phòng');
  });

  test('SCR-02 thiếu thông tin tìm phòng thì hướng dẫn thay vì gọi API (AC1)', async ({ page }) => {
    let calls = 0;
    await page.route(AVAILABILITY, (route) => {
      calls += 1;
      return route.continue();
    });
    await page.goto('/search?checkIn=2026-12-24');
    await expect(page.getByTestId('search-results').getByRole('alert')).toContainText(
      'Thiếu thông tin tìm phòng',
    );
    await expect(page.getByRole('link', { name: 'Về trang chủ' })).toBeVisible();
    expect(calls).toBe(0);
  });

  test('SCR-03 in nguyên bảng giá từng đêm và tổng hợp của báo giá (AC1)', async ({ page }) => {
    await page.goto(`/rooms/synthetic-room?propertyId=synthetic-property&${STAY}`);
    const first = page.getByTestId('night-row-2026-12-24');
    await expect(first).toContainText('1.000.000 ₫');
    await expect(first).toContainText('—');
    await expect(page.getByTestId('night-row-2026-12-25')).toContainText('1.000.000 ₫');
    const summary = page.getByTestId('quote-summary');
    await expect(summary).toContainText('2.000.000 ₫');
    await expect(summary).toContainText('600.000 ₫ (30%)');
    await expect(page.getByTestId('room-detail')).toContainText('Phiên bản engine báo giá');
    await expect(page.getByTestId('quote-expired')).toHaveCount(0);
  });

  test('SCR-03 báo giá hết hạn thì hướng dẫn lấy giá mới, không tự cập nhật (AC2)', async ({
    page,
  }) => {
    let quotes = 0;
    await page.route(QUOTES, (route) => {
      quotes += 1;
      return route.continue();
    });
    await page.goto(`/rooms/synthetic-room?propertyId=journey-expired&${STAY}`);
    const banner = page.getByTestId('quote-expired');
    await expect(banner).toBeVisible();
    await expect(banner).toContainText('Báo giá đã hết hạn');
    const before = quotes;

    await banner.getByRole('button', { name: 'Lấy giá mới' }).click();
    await expect(banner).toBeVisible();
    expect(quotes).toBe(before + 1);
  });

  test('SCR-03 không có vi phạm axe serious/critical và không cuộn ngang 360 px (AC2)', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 360, height: 800 });
    await page.goto(`/rooms/synthetic-room?propertyId=synthetic-property&${STAY}`);
    await expect(page.getByTestId('nights-table')).toBeVisible();
    const results = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
      .analyze();
    const blocking = results.violations.filter(
      (violation) => violation.impact === 'serious' || violation.impact === 'critical',
    );
    expect(blocking).toEqual([]);
    const overflow = await page.evaluate(() => {
      const element = document.scrollingElement;
      return element === null ? 0 : element.scrollWidth - element.clientWidth;
    });
    expect(overflow).toBeLessThanOrEqual(1);
  });
});
