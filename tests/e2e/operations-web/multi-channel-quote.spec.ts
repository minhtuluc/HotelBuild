import { expect, test, type Page } from '@playwright/test';
import { errorBody, fulfillJson, listBody } from './fake-api';
import { operationsWebOnly } from './guard';

const PROPERTY = {
  id: 'p1',
  name: 'Pine Hill Đà Lạt',
  status: 'ACTIVE',
  activeRoomCount: 20,
  overbookLimitPct: 5,
  checkInTime: '14:00',
  checkOutTime: '12:00',
  version: 3,
};

const ROOM_TYPE = {
  id: 'rt1',
  propertyId: 'p1',
  code: 'DLX',
  capacityAdults: 3,
  capacityChildren: 0,
  basePrice: 1_100_000,
  minPrice: 680_000,
  maxPrice: 3_000_000,
  allowShared: false,
  bedCount: 3,
  version: 2,
};

/** Số "lạ" để chứng minh giao diện in nguyên giá trị máy chủ trả (AC2). */
const QUOTE = {
  roomTypeId: 'rt1',
  checkIn: '2026-12-24',
  checkOut: '2026-12-27',
  options: [
    {
      channelCode: 'WEB',
      nightlyFrom: 1_421_000,
      totalFrom: 4_263_000,
      commissionPct: 0,
      grossTotal: 8_112_000,
      commissionAmount: 0,
      netTotal: 8_112_000,
      warnings: [],
    },
    {
      channelCode: 'OTA_BOOKING',
      nightlyFrom: 1_776_250,
      totalFrom: 5_328_750,
      commissionPct: 18,
      grossTotal: 5_328_750,
      commissionAmount: 959_175,
      netTotal: 4_369_575,
      warnings: ['Giá thuần thấp hơn WEB'],
    },
  ],
};

const PROPERTIES = '**/api/v1/properties*';
const ROOM_TYPES = '**/api/v1/room-types*';
const QUOTES = '**/api/v1/quotes/multi-channel';

operationsWebOnly();

function backend(page: Page): { posts: () => string[] } {
  const posts: string[] = [];
  void page.route(PROPERTIES, (route) => fulfillJson(route, 200, listBody([PROPERTY])));
  void page.route(ROOM_TYPES, (route) => fulfillJson(route, 200, listBody([ROOM_TYPE])));
  void page.route(QUOTES, async (route) => {
    posts.push(route.request().postData() ?? '');
    return fulfillJson(route, 200, JSON.stringify(QUOTE));
  });
  return { posts: () => posts };
}

async function viewQuote(page: Page): Promise<void> {
  await page.getByLabel('Nhận phòng').fill('2026-12-24');
  await page.getByLabel('Trả phòng').fill('2026-12-27');
  await page.getByRole('button', { name: 'Xem báo giá' }).click();
}

test.describe('SCR-30 báo giá đa kênh trên API giả (HB-062)', () => {
  test('hiện bảng so sánh kênh', async ({ page }) => {
    backend(page);
    await page.goto('/multi-channel-quote');
    await viewQuote(page);
    const table = page.getByTestId('mcq-table');
    await expect(table).toBeVisible();
    await expect(page.getByTestId('mcq-row-WEB')).toContainText('Website');
    await expect(page.getByTestId('mcq-row-OTA_BOOKING')).toContainText('Booking.com');
    await expect(table).toContainText('Giá gộp');
    await expect(table).toContainText('Giá thuần');
  });

  test('hiển thị đúng số máy chủ trả', async ({ page }) => {
    backend(page);
    await page.goto('/multi-channel-quote');
    await viewQuote(page);
    // Không làm tròn lại, không nhân hệ số: in nguyên giá trị.
    await expect(page.getByTestId('mcq-row-WEB')).toContainText('8.112.000 ₫');
    await expect(page.getByTestId('mcq-row-OTA_BOOKING')).toContainText('4.369.575 ₫');
    await expect(page.getByTestId('mcq-row-OTA_BOOKING')).toContainText('(18%)');
  });

  test('cảnh báo OTA thấp hơn WEB theo máy chủ', async ({ page }) => {
    backend(page);
    await page.goto('/multi-channel-quote');
    await viewQuote(page);
    await expect(page.getByTestId('mcq-warnings-OTA_BOOKING')).toContainText(
      'Giá thuần thấp hơn WEB',
    );
    await expect(page.getByTestId('mcq-warnings-WEB')).toHaveText('');
  });

  test('mặc định đủ kênh', async ({ page }) => {
    const spy = backend(page);
    await page.goto('/multi-channel-quote');
    await viewQuote(page);
    // Click completion does not await HTTP; inspect the request after its result is displayed.
    await expect(page.getByTestId('mcq-table')).toBeVisible();
    expect(spy.posts()).toHaveLength(1);
    const body = spy.posts()[0] ?? '';
    for (const code of ['WEB', 'PHONE', 'WALKIN', 'AGENCY', 'OTA_BOOKING', 'OTA_AGODA', 'OTA_AIRBNB']) {
      expect(body).toContain(`"${code}"`);
    }
    expect(body).not.toContain('WALK_IN');
  });

  test('chỉ đọc không chốt giá', async ({ page }) => {
    const spy = backend(page);
    await page.goto('/multi-channel-quote');
    await viewQuote(page);
    await expect(page.getByTestId('mcq-table')).toBeVisible();
    // Không có nút chốt giá/gửi khách, và chỉ đúng một lời gọi khi xem.
    await expect(page.getByRole('button', { name: /chốt giá|gửi khách/i })).toHaveCount(0);
    expect(spy.posts()).toHaveLength(1);
  });

  test('kỳ sai thì không gọi API', async ({ page }) => {
    const spy = backend(page);
    await page.goto('/multi-channel-quote');
    await page.getByLabel('Nhận phòng').fill('2026-12-27');
    await page.getByLabel('Trả phòng').fill('2026-12-24');
    await page.getByRole('button', { name: 'Xem báo giá' }).click();
    await expect(page.getByText('Vui lòng sửa 1 trường được đánh dấu')).toBeVisible();
    expect(spy.posts()).toHaveLength(0);
  });

  test('403 và lỗi giữ kết quả cũ', async ({ page }) => {
    await page.route(PROPERTIES, (route) => fulfillJson(route, 200, listBody([PROPERTY])));
    await page.route(ROOM_TYPES, (route) => fulfillJson(route, 200, listBody([ROOM_TYPE])));
    await page.route(QUOTES, (route) =>
      fulfillJson(route, 403, errorBody('E_RBAC_FORBIDDEN', 'trace-403', '/api/v1/quotes/multi-channel')),
    );
    await page.goto('/multi-channel-quote');
    await viewQuote(page);
    await expect(page.getByText('Bạn không có quyền xem nội dung này')).toBeVisible();
    await expect(page.getByTestId('mcq-table')).toHaveCount(0);

    // Lần sau: mạng lỗi → giữ nguyên bảng đã có, chỉ hiện băng lỗi.
    let fail = false;
    await page.route(QUOTES, (route) =>
      fail ? route.abort('failed') : fulfillJson(route, 200, JSON.stringify(QUOTE)),
    );
    await page.goto('/multi-channel-quote');
    await viewQuote(page);
    await expect(page.getByTestId('mcq-table')).toBeVisible();
    fail = true;
    await page.getByRole('button', { name: 'Xem báo giá' }).click();
    await expect(page.getByTestId('screen-alert')).toBeVisible();
    await expect(page.getByTestId('mcq-row-WEB')).toBeVisible();
  });
});
