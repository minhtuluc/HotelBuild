import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

/**
 * HB-317 — giữ ngữ cảnh hành trình trên URL (FEAT-01), chọn nhanh số đêm (FEAT-03), sao chép link báo giá
 * và bản in A4 (FEAT-06). Chạy trên API giả của hành trình (cơ sở `synthetic-property`, hạng `STD`).
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

const STAY =
  'propertyId=synthetic-property&checkIn=2026-12-24&checkOut=2026-12-27&adults=2&children=0';

async function axeClean(page: Page): Promise<void> {
  const result = await new AxeBuilder({ page }).analyze();
  const serious = result.violations.filter(
    (item) => item.impact === 'serious' || item.impact === 'critical',
  );
  expect(serious.map((item) => `${item.id}: ${item.nodes.length}`)).toEqual([]);
}

test.describe('Giữ ngữ cảnh và tiện ích đặt vé (HB-317)', () => {
  test('khối tìm phòng điền sẵn ngày và số khách từ URL; giá trị sai bị bỏ', async ({ page }) => {
    await page.goto('/?checkIn=2026-12-24&checkOut=2026-12-27&adults=3&children=1#search-block');
    const form = page.getByTestId('search-form');
    await expect(form.getByLabel('Nhận phòng')).toHaveValue('2026-12-24');
    await expect(form.getByLabel('Trả phòng')).toHaveValue('2026-12-27');
    await expect(form.getByLabel('Người lớn')).toHaveValue('3');
    await expect(form.getByLabel('Trẻ em')).toHaveValue('1');
    await page.goto('/?checkIn=2026-02-30&adults=99#search-block');
    await expect(page.getByTestId('search-form').getByLabel('Người lớn')).toHaveValue('2');
  });

  test('chọn nhanh 3 đêm điền ngày trả, in ba chặng trên vé; axe sạch', async ({ page }) => {
    await page.goto('/?checkIn=2026-12-24&checkOut=2026-12-25#search-block');
    const chips = page.getByTestId('quick-nights');
    await chips.getByRole('button', { name: '3 đêm' }).click();
    await expect(page.getByTestId('search-form').getByLabel('Trả phòng')).toHaveValue(
      '2026-12-27',
    );
    await expect(chips.getByRole('button', { name: '3 đêm' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await expect(page.getByTestId('ticket-segments').getByRole('listitem')).toHaveCount(3);
    await axeClean(page);
  });

  test('kết quả → trang hạng giữ kỳ → nút chính về lại kết quả cùng kỳ', async ({ page }) => {
    await page.goto(`/search?${STAY}`);
    await page.getByTestId('class-link-STD').click();
    await expect(page).toHaveURL(/\/room-types\/STD\?propertyId=synthetic-property&checkIn=2026-12-24/);
    const cta = page.getByTestId('cabin-cta');
    await expect(cta).toHaveText('Xem phòng trống cho kỳ này');
    await expect(page.getByTestId('journey-summary')).toContainText('24/12/2026');
    await cta.click();
    await expect(page).toHaveURL(/\/search\?propertyId=synthetic-property&checkIn=2026-12-24/);
    await expect(page.getByTestId('availability-table')).toBeVisible();
  });

  test('trang ga có ngày trên URL: nút chính về khối tìm phòng với ga và ngày', async ({ page }) => {
    await page.goto('/stays/phan-thiet?propertyId=khac&checkIn=2026-12-24&checkOut=2026-12-26');
    await expect(page.getByTestId('station-cta')).toHaveAttribute(
      'href',
      '/?ga=phan-thiet&checkIn=2026-12-24&checkOut=2026-12-26#search-block',
    );
    await page.goto('/stays/phan-thiet');
    await expect(page.getByTestId('station-cta')).toHaveText('Xem phòng trống');
  });

  test('báo giá: sao chép link mang gói đang xem; mở link chọn đúng gói', async ({
    page,
    context,
  }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    await page.goto(`/rooms/synthetic-room?${STAY}`);
    await expect(page.getByTestId('nights-table')).toBeVisible();
    await page.locator('select[name="ratePlanCode"]').selectOption('SAVER3');
    await expect(page.getByTestId('nights-table')).toBeVisible();
    await page.getByTestId('quote-copy-link').click();
    await expect(page.getByTestId('quote-copy-note')).toContainText('Đã sao chép link');
    const copied = await page.evaluate(() => navigator.clipboard.readText());
    expect(copied).toContain('/rooms/synthetic-room?');
    expect(copied).toContain('ratePlanCode=SAVER3');
    await page.goto(copied);
    await expect(page.locator('select[name="ratePlanCode"]')).toHaveValue('SAVER3');
  });

  test('bản in A4 của báo giá: ẩn điều hướng và nút, giữ bảng giá từng đêm', async ({ page }) => {
    await page.goto(`/rooms/synthetic-room?${STAY}`);
    await expect(page.getByTestId('nights-table')).toBeVisible();
    await page.emulateMedia({ media: 'print' });
    await expect(page.locator('header.ph-header')).toBeHidden();
    await expect(page.locator('footer')).toBeHidden();
    await expect(page.getByTestId('quote-copy-link')).toBeHidden();
    await expect(page.getByTestId('nights-table')).toBeVisible();
  });
});
