import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

/**
 * HB-322 — trang ga sâu hơn (bảng chặng UX-05, "Một ngày tại ga" CONT-02, lịch mùa FEAT-02) và trang hạng
 * sâu hơn (bố cục khoang, "Nói thẳng" CONT-01). Đồng hồ trình duyệt cố định ở 15/11/2026 (giờ VN) để mùa
 * hiện tại và cuối tuần gần nhất không phụ thuộc ngày chạy.
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

test.describe('Trang ga và trang hạng sâu hơn (HB-322)', () => {
  test.beforeEach(async ({ page }) => {
    await page.clock.setFixedTime(new Date('2026-11-15T03:00:00Z'));
  });

  test('trang ga: bảng chặng, ba buổi trong ngày, bốn mùa; đúng một mùa hiện tại', async ({
    page,
  }) => {
    await page.goto('/stays/da-lat');
    const legs = page.getByTestId('arrival-legs');
    await expect(legs.getByRole('columnheader')).toHaveText(['Thời gian', 'Chặng']);
    await expect(legs.locator('tbody tr')).toHaveCount(2);
    await expect(legs.locator('tbody tr').first()).toContainText('Liên Khương');
    await expect(page.getByTestId('station-day').getByRole('listitem')).toHaveCount(3);
    const almanac = page.getByTestId('season-almanac');
    await expect(almanac.getByRole('listitem')).toHaveCount(4);
    await expect(page.getByTestId('season-0')).toHaveAttribute('data-current', 'true');
    await expect(almanac.locator('[data-current="true"]')).toHaveCount(1);
    await expect(page.getByTestId('season-0')).toContainText('Tháng 11 – 12');
    await expect(page.getByTestId('season-0')).toContainText('Mùa hiện tại');
  });

  test('chọn cuối tuần trong mùa: khối tìm phòng điền sẵn ga và ngày', async ({ page }) => {
    await page.goto('/stays/da-lat');
    const cta = page.getByTestId('season-cta-1');
    // Mùa khô (tháng 1–3): thứ Sáu đầu tiên là 01/01/2027.
    await expect(cta).toHaveAttribute(
      'href',
      '/?ga=da-lat&checkIn=2027-01-01&checkOut=2027-01-03#search-block',
    );
    await page.getByTestId('season-cta-0').click();
    await expect(page).toHaveURL(/\?ga=da-lat&checkIn=2026-11-20&checkOut=2026-11-22#search-block$/);
    const form = page.getByTestId('search-form');
    await expect(form.getByLabel('Nhận phòng')).toHaveValue('2026-11-20');
    await expect(form.getByLabel('Trả phòng')).toHaveValue('2026-11-22');
  });

  test('trang ga axe sạch, không cuộn ngang ở 360 px', async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 800 });
    await page.goto('/stays/phan-thiet');
    await expect(page.getByTestId('season-almanac')).toBeVisible();
    await noHorizontalScroll(page);
    await axeClean(page);
  });

  test('trang hạng: "Trong khoang" và "Nói thẳng"; Dorm có dòng phòng chung', async ({ page }) => {
    await page.goto('/room-types/STD');
    await expect(page.getByRole('heading', { name: 'Trong khoang' })).toBeVisible();
    await expect(page.getByTestId('cabin-layout')).toContainText('Hai chỗ ngủ');
    const honest = page.getByTestId('cabin-honest');
    await expect(honest.getByRole('listitem')).toHaveCount(3);
    await expect(honest).not.toContainText('Dorm là phòng chung');
    await page.goto('/room-types/DOR');
    await expect(page.getByTestId('cabin-honest').getByRole('listitem')).toHaveCount(4);
    await expect(page.getByTestId('cabin-honest')).toContainText('Dorm là phòng chung');
  });

  test('trang hạng axe sạch, không cuộn ngang ở 360 px; tiếng Anh có đủ khối mới', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 360, height: 800 });
    await page.goto('/room-types/FAM');
    await expect(page.getByTestId('cabin-honest')).toBeVisible();
    await noHorizontalScroll(page);
    await axeClean(page);
    await page.goto('/en/stays/vung-tau');
    await expect(page.getByTestId('arrival-legs')).toContainText('Bach Dang');
    await expect(page.getByRole('heading', { name: 'A day at the station' })).toBeVisible();
    await expect(page.getByTestId('season-0')).toContainText('November – January');
  });
});
