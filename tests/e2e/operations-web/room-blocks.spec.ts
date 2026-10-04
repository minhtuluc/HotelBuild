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

const ROOM = {
  id: 'r1',
  propertyId: 'p1',
  roomTypeId: 'rt1',
  code: '101',
  floor: 1,
  status: 'ACTIVE',
  connectingRoomId: null,
  version: 1,
};

const BLOCK = {
  id: 'bl1',
  roomId: 'r1',
  startDate: '2026-12-20',
  endDate: '2026-12-22',
  reason: 'MAINTENANCE',
  note: 'Thay bóng đèn',
};

const PROPERTIES = '**/api/v1/properties*';
const ROOMS = '**/api/v1/rooms*';
const BLOCKS = '**/api/v1/room-blocks**';

operationsWebOnly();

function backend(
  page: Page,
  blocks: readonly unknown[] = [BLOCK],
): { created: () => string[]; deleted: () => string[] } {
  const created: string[] = [];
  const deleted: string[] = [];
  void page.route(PROPERTIES, (route) => fulfillJson(route, 200, listBody([PROPERTY])));
  void page.route(ROOMS, (route) => fulfillJson(route, 200, listBody([ROOM])));
  void page.route(BLOCKS, async (route) => {
    const request = route.request();
    if (request.method() === 'POST') {
      created.push(request.postData() ?? '');
      return fulfillJson(route, 201, JSON.stringify(BLOCK));
    }
    if (request.method() === 'DELETE') {
      deleted.push(request.url());
      return fulfillJson(route, 204, '');
    }
    return fulfillJson(route, 200, listBody(blocks));
  });
  return { created: () => created, deleted: () => deleted };
}

test.describe('SCR-22 khoá phòng trên API giả (HB-039)', () => {
  test('hiện danh sách khoá phòng', async ({ page }) => {
    backend(page);
    await page.goto('/room-blocks');
    const table = page.getByTestId('room-blocks-table');
    await expect(table).toBeVisible();
    await expect(table).toContainText('101');
    await expect(table).toContainText('2026-12-20 → 2026-12-22');
    await expect(table).toContainText('Bảo trì');
    await expect(table).toContainText('(MAINTENANCE)');
    await expect(table).toContainText('Thay bóng đèn');
  });

  test('cảnh báo chồng lấn trước khi gửi', async ({ page }) => {
    backend(page);
    await page.goto('/room-blocks');
    await page.getByLabel('Phòng').selectOption('r1');
    await page.getByLabel('Từ ngày').fill('2026-12-21');
    await page.getByLabel('Đến ngày').fill('2026-12-24');
    await expect(page.getByTestId('room-block-overlap')).toContainText('chồng lấn');
  });

  test('tạo khoá rồi đọc lại', async ({ page }) => {
    const spy = backend(page);
    await page.goto('/room-blocks');
    await page.getByLabel('Phòng').selectOption('r1');
    await page.getByLabel('Từ ngày').fill('2026-12-25');
    await page.getByLabel('Đến ngày').fill('2026-12-27');
    await page.getByLabel('Lý do').selectOption('RENOVATION');
    await page.getByLabel('Ghi chú').fill('Sửa điều hoà');
    await page.getByRole('button', { name: 'Tạo khoá' }).click();
    await expect(page.getByTestId('room-blocks-table')).toBeVisible();
    expect(spy.created()).toHaveLength(1);
    expect(spy.created()[0]).toContain('"roomId":"r1"');
    expect(spy.created()[0]).toContain('"reason":"RENOVATION"');
    expect(spy.created()[0]).toContain('Sửa điều hoà');
  });

  test('ngày không hợp lệ thì không gọi API', async ({ page }) => {
    const spy = backend(page);
    await page.goto('/room-blocks');
    await page.getByLabel('Phòng').selectOption('r1');
    await page.getByLabel('Từ ngày').fill('2026-12-27');
    await page.getByLabel('Đến ngày').fill('2026-12-25');
    await page.getByRole('button', { name: 'Tạo khoá' }).click();
    await expect(page.getByText('Vui lòng sửa 1 trường được đánh dấu')).toBeVisible();
    expect(spy.created()).toHaveLength(0);
  });

  test('gỡ khoá kèm lý do', async ({ page }) => {
    const spy = backend(page);
    await page.goto('/room-blocks');
    await page.getByRole('button', { name: 'Gỡ khoá' }).click();
    await page.getByLabel('Lý do gỡ khoá').fill('Đã sửa xong');
    await page.getByRole('button', { name: 'Xác nhận gỡ' }).click();
    await expect(page.getByTestId('room-blocks-table')).toBeVisible();
    expect(spy.deleted()).toHaveLength(1);
    expect(decodeURIComponent((spy.deleted()[0] ?? '').replace(/\+/g, ' '))).toContain(
      'reason=Đã sửa xong',
    );
  });

  test('403 hiện thiếu quyền', async ({ page }) => {
    await page.route(PROPERTIES, (route) => fulfillJson(route, 200, listBody([PROPERTY])));
    await page.route(ROOMS, (route) => fulfillJson(route, 200, listBody([ROOM])));
    await page.route(BLOCKS, (route) =>
      fulfillJson(route, 403, errorBody('E_RBAC_FORBIDDEN', 'trace-403', '/api/v1/room-blocks')),
    );
    await page.goto('/room-blocks');
    await expect(page.getByText('Bạn không có quyền xem nội dung này')).toBeVisible();
    await expect(page.getByTestId('room-blocks-table')).toHaveCount(0);
  });

  test('mất mạng khi tạo là chưa xác định kết quả', async ({ page }) => {
    await page.route(PROPERTIES, (route) => fulfillJson(route, 200, listBody([PROPERTY])));
    await page.route(ROOMS, (route) => fulfillJson(route, 200, listBody([ROOM])));
    await page.route(BLOCKS, (route) => {
      if (route.request().method() === 'POST') return route.abort('failed');
      return fulfillJson(route, 200, listBody([BLOCK]));
    });
    await page.goto('/room-blocks');
    await page.getByLabel('Phòng').selectOption('r1');
    await page.getByLabel('Từ ngày').fill('2026-12-25');
    await page.getByLabel('Đến ngày').fill('2026-12-27');
    await page.getByRole('button', { name: 'Tạo khoá' }).click();
    await expect(page.getByText(/Chưa xác định kết quả/)).toBeVisible();
  });
});
