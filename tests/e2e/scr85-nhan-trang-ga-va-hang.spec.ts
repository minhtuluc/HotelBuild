import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

/**
 * HB-311 — nhân trang nội dung: ba trang ga (`/stays/{da-lat,phan-thiet,vung-tau}`) và năm trang hạng
 * (`/room-types/{STD,SUP,DLX,FAM,DOR}`). Cơ sở do API trả khớp trang ga theo `slug` (TD-82), không theo tên.
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

/** Tên cố ý không chứa tên ga: chỉ `slug` mới khớp được. */
const PROPERTIES = [
  { id: 'p-dl', name: 'Cơ sở số 1', slug: 'da-lat', checkInTime: '13:30', checkOutTime: '11:30' },
  { id: 'p-pt', name: 'Cơ sở số 3', slug: 'phan-thiet', checkInTime: '15:00', checkOutTime: '11:00' },
  { id: 'p-vt', name: 'Cơ sở số 2', slug: 'vung-tau', checkInTime: '14:00', checkOutTime: '12:00' },
];

async function mockProperties(page: Page): Promise<void> {
  await page.route('**/api/session/journey/public/properties', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        data: PROPERTIES,
        meta: { limit: 20, nextCursor: null, hasMore: false, total: PROPERTIES.length },
      }),
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

const STATIONS = [
  { slug: 'da-lat', title: 'Ga Đà Lạt', checkIn: '13:30', checkOut: '11:30' },
  { slug: 'phan-thiet', title: 'Ga Phan Thiết', checkIn: '15:00', checkOut: '11:00' },
  { slug: 'vung-tau', title: 'Ga Vũng Tàu', checkIn: '14:00', checkOut: '12:00' },
] as const;

const CLASSES = [
  { code: 'STD', title: 'Hạng Standard', capacity: '2 người lớn' },
  { code: 'SUP', title: 'Hạng Superior', capacity: '2 người lớn' },
  { code: 'DLX', title: 'Hạng Deluxe', capacity: '3 người lớn' },
  { code: 'FAM', title: 'Hạng Family', capacity: '4 người lớn' },
  { code: 'DOR', title: 'Hạng Dorm', capacity: '1 giường / người' },
] as const;

test.describe('Ba trang ga (HB-311)', () => {
  for (const station of STATIONS) {
    test(`/stays/${station.slug}: tiêu đề, giờ khớp theo slug, CTA chọn sẵn ga`, async ({ page }) => {
      await mockProperties(page);
      await page.goto(`/stays/${station.slug}`);
      await expect(page.getByRole('heading', { level: 1 })).toHaveText(station.title);
      const timetable = page.getByTestId('station-timetable');
      await expect(timetable).toContainText(station.checkIn);
      await expect(timetable).toContainText(station.checkOut);
      await expect(page.getByTestId('station-cta')).toHaveAttribute(
        'href',
        `/?ga=${station.slug}#search-block`,
      );
      await expect(page.getByTestId('price-includes')).toBeVisible();
    });
  }

  test('CTA của ga Vũng Tàu chọn sẵn đúng cơ sở theo slug ở khối tìm phòng', async ({ page }) => {
    await mockProperties(page);
    await page.goto('/stays/vung-tau');
    await page.getByTestId('station-cta').click();
    await expect(page).toHaveURL(/\/\?ga=vung-tau#search-block$/);
    await expect(page.getByLabel('Cơ sở')).toHaveValue('p-vt');
  });

  test('ga Phan Thiết: axe sạch; 360px không cuộn ngang', async ({ page }) => {
    await mockProperties(page);
    await page.goto('/stays/phan-thiet');
    await axeClean(page);
    await page.setViewportSize({ width: 360, height: 780 });
    await page.goto('/stays/phan-thiet');
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(360);
  });
});

test.describe('Năm trang hạng (HB-311)', () => {
  for (const cabin of CLASSES) {
    test(`/room-types/${cabin.code}: tiêu đề, sức chứa, có ở ba ga, không có giá`, async ({ page }) => {
      await page.goto(`/room-types/${cabin.code}`);
      await expect(page.getByRole('heading', { level: 1 })).toHaveText(cabin.title);
      const spec = page.getByTestId('cabin-spec');
      await expect(spec).toContainText(cabin.capacity);
      await expect(spec).not.toContainText('₫');
      const served = page.getByRole('region', { name: 'Có ở ga' });
      await expect(served.getByRole('link')).toHaveCount(3);
    });
  }

  test('Dorm: khối giá đã gồm có mục riêng của Dorm; Standard thì không', async ({ page }) => {
    await page.goto('/room-types/DOR');
    await expect(page.getByTestId('price-includes')).toContainText('Thêm cho Dorm');
    await axeClean(page);
    await page.goto('/room-types/STD');
    await expect(page.getByTestId('price-includes')).not.toContainText('Thêm cho Dorm');
  });

  test('bản dịch: /en/stays/vung-tau và /ru/room-types/FAM', async ({ page }) => {
    await mockProperties(page);
    await page.goto('/en/stays/vung-tau');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Vung Tau Station');
    await page.goto('/ru/room-types/FAM');
    await expect(page.locator('html')).toHaveAttribute('lang', 'ru');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Категория Family');
  });
});
