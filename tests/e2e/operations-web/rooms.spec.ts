import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { errorBody, fulfillJson, listBody } from './fake-api';
import { operationsWebOnly } from './guard';

const ROOM_TYPE = {
  id: 'rt1',
  propertyId: 'p1',
  code: 'DLX',
  capacityAdults: 2,
  capacityChildren: 1,
  basePrice: 900_000,
  minPrice: 700_000,
  maxPrice: 1_400_000,
  allowShared: false,
  bedCount: 1,
  version: 1,
};

const ROOM_A = {
  id: 'r1',
  propertyId: 'p1',
  roomTypeId: 'rt1',
  code: '101',
  floor: 1,
  status: 'ACTIVE',
  connectingRoomId: null,
  version: 2,
};

const ROOM_B = {
  id: 'r2',
  propertyId: 'p1',
  roomTypeId: 'rt1',
  code: '102',
  floor: 1,
  status: 'MAINTENANCE',
  connectingRoomId: null,
  version: 1,
};

const ROOMS = '**/api/v1/rooms';
const ROOM_TYPES = '**/api/v1/room-types*';
const CONNECTING = '**/api/v1/rooms/r1/connecting-room';

operationsWebOnly();

async function mockReads(page: Page, rooms: readonly unknown[]): Promise<void> {
  await page.route(ROOMS, (route) => fulfillJson(route, 200, listBody(rooms)));
  await page.route(ROOM_TYPES, (route) => fulfillJson(route, 200, listBody([ROOM_TYPE])));
}

test.describe('SCR-21 sơ đồ buồng & phòng thông nhau trên API giả (HB-038)', () => {
  test('hiện danh sách phòng theo tầng kèm loại phòng và trạng thái', async ({ page }) => {
    await mockReads(page, [ROOM_A, ROOM_B]);
    await page.goto('/rooms');
    const table = page.getByTestId('rooms-table');
    await expect(table).toBeVisible();
    await expect(table).toContainText('101');
    await expect(table).toContainText('DLX');
    await expect(table).toContainText('Đang dùng (ACTIVE)');
    await expect(table).toContainText('Bảo trì (MAINTENANCE)');
  });

  test('gán phòng thông nhau rồi đọc lại thấy liên kết hai chiều', async ({ page }) => {
    let paired = false;
    let sentIfMatch: string | undefined;
    let sentBody = '';
    await page.route(ROOMS, (route) =>
      fulfillJson(
        route,
        200,
        listBody(
          paired
            ? [
                { ...ROOM_A, connectingRoomId: 'r2', version: 3 },
                { ...ROOM_B, connectingRoomId: 'r1', version: 2 },
              ]
            : [ROOM_A, ROOM_B],
        ),
      ),
    );
    await page.route(ROOM_TYPES, (route) => fulfillJson(route, 200, listBody([ROOM_TYPE])));
    await page.route(CONNECTING, async (route) => {
      sentIfMatch = route.request().headers()['if-match'];
      sentBody = route.request().postData() ?? '';
      paired = true;
      await fulfillJson(route, 200, JSON.stringify({ ...ROOM_A, connectingRoomId: 'r2', version: 3 }));
    });
    await page.goto('/rooms');
    await page.getByTestId('room-101').getByRole('button', { name: 'Gán phòng thông nhau' }).click();
    await page.getByLabel('Phòng thông nhau').selectOption('r2');
    await page.getByRole('button', { name: 'Lưu' }).click();
    await expect(page.getByTestId('assign-success')).toContainText('101');
    expect(sentIfMatch).toBe('"2"');
    expect(sentBody).toBe('{"connectingRoomId":"r2"}');
    await expect(page.getByTestId('room-connecting-101')).toHaveText('102');
    await expect(page.getByTestId('room-connecting-102')).toHaveText('101');
  });

  test('gỡ liên kết gửi null', async ({ page }) => {
    let sentBody = '';
    await page.route(ROOMS, (route) =>
      fulfillJson(
        route,
        200,
        listBody([
          { ...ROOM_A, connectingRoomId: 'r2' },
          { ...ROOM_B, connectingRoomId: 'r1' },
        ]),
      ),
    );
    await page.route(ROOM_TYPES, (route) => fulfillJson(route, 200, listBody([ROOM_TYPE])));
    await page.route(CONNECTING, async (route) => {
      sentBody = route.request().postData() ?? '';
      await fulfillJson(route, 200, JSON.stringify(ROOM_A));
    });
    await page.goto('/rooms');
    await page.getByTestId('room-101').getByRole('button', { name: 'Gỡ liên kết' }).click();
    await expect(page.getByTestId('assign-success')).toContainText('101');
    expect(sentBody).toBe('{"connectingRoomId":null}');
  });

  test('dữ liệu liên kết một chiều thì cảnh báo', async ({ page }) => {
    await mockReads(page, [{ ...ROOM_A, connectingRoomId: 'r2' }, ROOM_B]);
    await page.goto('/rooms');
    await expect(page.getByTestId('room-asymmetric-101')).toBeVisible();
  });

  test('412 khi gán thì hiện xung đột, không tự ghi đè', async ({ page }) => {
    await mockReads(page, [ROOM_A, ROOM_B]);
    await page.route(CONNECTING, (route) =>
      fulfillJson(
        route,
        412,
        errorBody('E_GEN_VERSION_CONFLICT', 'trace-412', '/api/v1/rooms/r1/connecting-room'),
      ),
    );
    await page.goto('/rooms');
    await page.getByTestId('room-101').getByRole('button', { name: 'Gán phòng thông nhau' }).click();
    await page.getByLabel('Phòng thông nhau').selectOption('r2');
    await page.getByRole('button', { name: 'Lưu' }).click();
    const conflict = page.getByText(/Dữ liệu đã thay đổi/);
    await expect(conflict).toBeVisible();
    await expect(conflict).toContainText('2');
  });

  test('403 khi đọc hiện thiếu quyền, không lộ danh sách phòng', async ({ page }) => {
    await page.route(ROOMS, (route) =>
      fulfillJson(route, 403, errorBody('E_AUTH_OUT_OF_SCOPE', 'trace-403', '/api/v1/rooms')),
    );
    await page.route(ROOM_TYPES, (route) => fulfillJson(route, 200, listBody([ROOM_TYPE])));
    await page.goto('/rooms');
    await expect(page.getByText('Bạn không có quyền xem nội dung này')).toBeVisible();
    await expect(page.getByTestId('rooms-table')).toHaveCount(0);
  });

  test('mất mạng khi gán là chưa xác định kết quả', async ({ page }) => {
    await mockReads(page, [ROOM_A, ROOM_B]);
    await page.route(CONNECTING, (route) => route.abort('failed'));
    await page.goto('/rooms');
    await page.getByTestId('room-101').getByRole('button', { name: 'Gán phòng thông nhau' }).click();
    await page.getByLabel('Phòng thông nhau').selectOption('r2');
    await page.getByRole('button', { name: 'Lưu' }).click();
    await expect(page.getByText(/Chưa xác định kết quả/)).toBeVisible();
    await expect(page.getByTestId('assign-success')).toHaveCount(0);
  });

  test('danh sách không có vi phạm axe serious/critical và không cuộn ngang ở 360 px', async ({
    page,
  }) => {
    await mockReads(page, [ROOM_A, ROOM_B]);
    await page.setViewportSize({ width: 360, height: 800 });
    await page.goto('/rooms');
    await expect(page.getByTestId('rooms-table')).toBeVisible();
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
    const results = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
      .analyze();
    const blocking = results.violations.filter(
      (violation) => violation.impact === 'serious' || violation.impact === 'critical',
    );
    expect(blocking.map((violation) => violation.id)).toEqual([]);
  });
});
