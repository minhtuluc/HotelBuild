import { expect, test, type Page, type Route } from '@playwright/test';
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

/** DOR bán theo giường: `sellingUnits` là số đơn vị bán đang hoạt động (BR-PROP-03). */
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
  sellingUnits: 8,
  version: 2,
};

const CHANNEL = {
  id: 'c1',
  code: 'OTA_BOOKING',
  name: 'Booking.com',
  multiplier: 1,
  commissionPct: 18,
  holdMinutes: 30,
  overbookAllowed: false,
  version: 4,
};

const ALLOTMENT_ROWS = [
  { date: '2026-12-24', allotment: 5, used: 2 },
  { date: '2026-12-25', allotment: 6, used: 0 },
];

const ETAG = '"7"';

const PROPERTIES = '**/api/v1/properties**';
const ROOM_TYPES = '**/api/v1/room-types**';
const CHANNELS = '**/api/v1/channels**';
const ALLOTMENTS = '**/api/v1/channel-allotments**';

operationsWebOnly();

function withEtag(route: Route, body: string): Promise<void> {
  return route.fulfill({
    status: 200,
    contentType: 'application/json',
    // `ETag` không thuộc danh sách header an toàn của CORS nên phải khai báo lộ ra cho JS đọc.
    headers: { ETag: ETAG, 'Access-Control-Expose-Headers': 'ETag' },
    body,
  });
}

/** API giả tối thiểu cho SCR-25; `rows` và cờ lỗi điều khiển được từng ca. */
function backend(
  page: Page,
  options: { etag?: string | undefined } = { etag: ETAG },
): { puts: () => string[]; ifMatch: () => (string | undefined)[] } {
  const puts: string[] = [];
  const ifMatch: (string | undefined)[] = [];
  void page.route(PROPERTIES, (route) => fulfillJson(route, 200, listBody([PROPERTY])));
  void page.route(ROOM_TYPES, (route) => fulfillJson(route, 200, listBody([ROOM_TYPE])));
  void page.route(CHANNELS, (route) => fulfillJson(route, 200, listBody([CHANNEL])));
  void page.route(ALLOTMENTS, async (route) => {
    if (route.request().method() === 'PUT') {
      ifMatch.push(route.request().headers()['if-match']);
      puts.push(route.request().postData() ?? '');
      return fulfillJson(route, 204, '');
    }
    const body = listBody(ALLOTMENT_ROWS);
    if (options.etag === undefined) return fulfillJson(route, 200, body);
    return withEtag(route, body);
  });
  return { puts: () => puts, ifMatch: () => ifMatch };
}

async function openScreen(page: Page): Promise<void> {
  await page.goto('/channel-allotments');
  // Lô giả lập nằm ở 24–25/12; đặt khoảng tường minh để ca kiểm không phụ thuộc ngày chạy.
  await page.getByLabel('Từ ngày').fill('2026-12-24');
  await page.getByLabel('Đến ngày').fill('2026-12-25');
  await page.getByRole('button', { name: 'Xem hạn mức' }).click();
  await expect(page.getByTestId('allotments-table')).toBeVisible();
}

test.describe('SCR-25 allotment theo kênh trên API giả (HB-042)', () => {
  test('hiện bảng allotment theo kênh (AC1)', async ({ page }) => {
    backend(page);
    await openScreen(page);
    const row = page.getByTestId('allotment-row-2026-12-24');
    await expect(row).toContainText('2026-12-24');
    await expect(page.getByTestId('allotment-used-2026-12-24')).toHaveText('2');
    await expect(page.getByLabel('Hạn mức ngày 2026-12-24')).toHaveValue('5');
    await expect(page.getByLabel('Hạn mức ngày 2026-12-25')).toHaveValue('6');
  });

  test('cảnh báo vượt đơn vị bán ACTIVE (AC2)', async ({ page }) => {
    const spy = backend(page);
    await openScreen(page);
    await page.getByLabel('Hạn mức ngày 2026-12-24').fill('9');
    await expect(page.getByTestId('allotment-issue-2026-12-24')).toContainText(
      'Vượt số đơn vị bán đang hoạt động',
    );
    // Cảnh báo chỉ để nhắc: người dùng vẫn gửi được (máy chủ chặn là cuối).
    await page.getByTestId('allotment-row-2026-12-24').getByLabel('Hạn mức ngày 2026-12-24').fill('8');
    await expect(page.getByTestId('allotment-issue-2026-12-24')).toHaveText('');
    expect(spy.puts()).toHaveLength(0);
  });

  test('lưu lô trong một request kèm If-Match, chỉ ngày đã đổi (AC3, AC4)', async ({ page }) => {
    const spy = backend(page);
    await openScreen(page);
    await page.getByLabel('Hạn mức ngày 2026-12-25').fill('7');
    await page.getByTestId('allotment-editor').getByRole('button', { name: 'Lưu lô' }).click();
    await expect(page.getByTestId('allotments-saved')).toContainText('1');
    expect(spy.puts()).toHaveLength(1);
    expect(spy.ifMatch()[0]).toBe(ETAG);
    const body = spy.puts()[0] ?? '';
    expect(body).toContain('"items":[{"date":"2026-12-25","allotment":7}]');
    expect(body).toContain('"channelId":"c1"');
    expect(body).not.toContain('2026-12-24');
  });

  test('nhập sai hoặc không đổi thì không gọi API', async ({ page }) => {
    const spy = backend(page);
    await openScreen(page);
    await page.getByLabel('Hạn mức ngày 2026-12-24').fill('-2');
    await page.getByTestId('allotment-editor').getByRole('button', { name: 'Lưu lô' }).click();
    await expect(page.getByText('items[0].allotment: OUT_OF_RANGE')).toBeVisible();
    expect(spy.puts()).toHaveLength(0);

    await page.getByLabel('Hạn mức ngày 2026-12-24').fill('5');
    await page.getByTestId('allotment-editor').getByRole('button', { name: 'Lưu lô' }).click();
    await expect(page.getByText('(biểu mẫu): UNCHANGED')).toBeVisible();
    expect(spy.puts()).toHaveLength(0);
  });

  test('thiếu ETag thì không gửi lệnh thiếu điều kiện', async ({ page }) => {
    const spy = backend(page, { etag: undefined });
    await openScreen(page);
    await page.getByLabel('Hạn mức ngày 2026-12-24').fill('7');
    await page.getByTestId('allotment-editor').getByRole('button', { name: 'Lưu lô' }).click();
    await expect(page.getByText('(biểu mẫu): MISSING_ETAG')).toBeVisible();
    expect(spy.puts()).toHaveLength(0);
  });

  test('412 giữ nguyên bản nhập (AC5)', async ({ page }) => {
    const puts: string[] = [];
    void page.route(PROPERTIES, (route) => fulfillJson(route, 200, listBody([PROPERTY])));
    void page.route(ROOM_TYPES, (route) => fulfillJson(route, 200, listBody([ROOM_TYPE])));
    void page.route(CHANNELS, (route) => fulfillJson(route, 200, listBody([CHANNEL])));
    void page.route(ALLOTMENTS, async (route) => {
      if (route.request().method() === 'PUT') {
        puts.push(route.request().postData() ?? '');
        return fulfillJson(
          route,
          412,
          errorBody('E_GEN_VERSION_CONFLICT', 'trace-412', '/api/v1/channel-allotments'),
        );
      }
      return withEtag(route, listBody(ALLOTMENT_ROWS));
    });
    await openScreen(page);
    await page.getByLabel('Hạn mức ngày 2026-12-24').fill('6');
    await page.getByTestId('allotment-editor').getByRole('button', { name: 'Lưu lô' }).click();
    // Trạng thái `conflict` (§8.1) như SCR-19/SCR-26: hiện xung đột + nút tải lại, KHÔNG tự ghi đè.
    await expect(page.getByText('Dữ liệu đã thay đổi', { exact: false })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Tải lại và so sánh' })).toBeVisible();
    expect(puts).toHaveLength(1);
  });

  test('mất mạng khi lưu là chưa xác định kết quả (AC7)', async ({ page }) => {
    void page.route(PROPERTIES, (route) => fulfillJson(route, 200, listBody([PROPERTY])));
    void page.route(ROOM_TYPES, (route) => fulfillJson(route, 200, listBody([ROOM_TYPE])));
    void page.route(CHANNELS, (route) => fulfillJson(route, 200, listBody([CHANNEL])));
    void page.route(ALLOTMENTS, async (route) => {
      if (route.request().method() === 'PUT') return route.abort('failed');
      return withEtag(route, listBody(ALLOTMENT_ROWS));
    });
    await openScreen(page);
    // 7 ≤ 8 đơn vị bán nên qua được kiểm tại chỗ; lỗi mạng mới là thứ cần kiểm.
    await page.getByLabel('Hạn mức ngày 2026-12-25').fill('7');
    await page.getByTestId('allotment-editor').getByRole('button', { name: 'Lưu lô' }).click();
    await expect(page.getByText('Chưa xác định kết quả', { exact: false })).toBeVisible();
  });

  test('403 hiện thiếu quyền, không lộ bảng (AC6)', async ({ page }) => {
    void page.route(PROPERTIES, (route) => fulfillJson(route, 200, listBody([PROPERTY])));
    void page.route(ROOM_TYPES, (route) => fulfillJson(route, 200, listBody([ROOM_TYPE])));
    void page.route(CHANNELS, (route) => fulfillJson(route, 200, listBody([CHANNEL])));
    void page.route(ALLOTMENTS, (route) =>
      fulfillJson(route, 403, errorBody('E_RBAC_FORBIDDEN', 'trace-403', '/api/v1/channel-allotments')),
    );
    await page.goto('/channel-allotments');
    await expect(page.getByText('Bạn không có quyền xem nội dung này')).toBeVisible();
    await expect(page.getByTestId('allotments-table')).toHaveCount(0);
  });
});
