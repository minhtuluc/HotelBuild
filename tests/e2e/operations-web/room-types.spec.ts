import AxeBuilder from '@axe-core/playwright';
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
  capacityAdults: 2,
  capacityChildren: 1,
  basePrice: 900_000,
  minPrice: 700_000,
  maxPrice: 1_400_000,
  allowShared: false,
  bedCount: 1,
  version: 1,
};

/** Sàn cao hơn trần — máy chủ sẽ chặn, giao diện chỉ nhắc (BR-RATE-03, BR-RATE-04). */
const BROKEN_ROOM_TYPE = { ...ROOM_TYPE, id: 'rt2', code: 'BAD', minPrice: 2_000_000, maxPrice: 1_000_000 };

const PROPERTIES = '**/api/v1/properties';
const ROOM_TYPES = '**/api/v1/room-types*';

operationsWebOnly();

async function mockReads(page: Page, rows: readonly unknown[]): Promise<void> {
  await page.route(PROPERTIES, (route) => fulfillJson(route, 200, listBody([PROPERTY])));
  await page.route(ROOM_TYPES, (route) =>
    route.request().method() === 'GET'
      ? fulfillJson(route, 200, listBody(rows))
      : fulfillJson(route, 500, errorBody('E_GEN_SERVICE_UNAVAILABLE', 'trace-post', '/api/v1/room-types')),
  );
}

test.describe('SCR-20 loại phòng, sức chứa và sàn–trần trên API giả (HB-037)', () => {
  test('hiện sàn–trần và cảnh báo khi sàn cao hơn trần', async ({ page }) => {
    await mockReads(page, [ROOM_TYPE, BROKEN_ROOM_TYPE]);
    await page.goto('/room-types');
    const table = page.getByTestId('room-types-table');
    await expect(table).toBeVisible();
    await expect(table).toContainText('700.000 ₫');
    await expect(table).toContainText('1.400.000 ₫');
    await expect(page.getByTestId('room-type-warning-DLX')).toHaveText('');
    await expect(page.getByTestId('room-type-warning-BAD')).toContainText('Sàn cao hơn trần.');
  });

  test('tạo loại phòng gửi đủ trường và hiện mã vừa tạo', async ({ page }) => {
    let posted = '';
    await page.route(PROPERTIES, (route) => fulfillJson(route, 200, listBody([PROPERTY])));
    await page.route(ROOM_TYPES, async (route) => {
      if (route.request().method() === 'GET') {
        await fulfillJson(route, 200, listBody([ROOM_TYPE]));
        return;
      }
      posted = route.request().postData() ?? '';
      await fulfillJson(route, 201, JSON.stringify({ ...ROOM_TYPE, id: 'rt9', code: 'NEW' }));
    });
    await page.goto('/room-types');
    await page.getByRole('button', { name: 'Thêm loại phòng' }).click();
    await page.getByLabel('Cơ sở').selectOption('p1');
    await page.getByLabel('Mã loại phòng').fill('NEW');
    await page.getByLabel('Giá cơ bản (VND)').fill('800000');
    await page.getByLabel('Giá sàn (VND)').fill('600000');
    await page.getByLabel('Giá trần (VND)').fill('1200000');
    await page.getByRole('button', { name: 'Tạo' }).click();
    await expect(page.getByTestId('create-success')).toContainText('NEW');
    expect(posted).toContain('"basePrice":800000');
    expect(posted).toContain('"minPrice":600000');
  });

  test('422 giữ nguyên bản nhập và báo lỗi theo trường', async ({ page }) => {
    await page.route(PROPERTIES, (route) => fulfillJson(route, 200, listBody([PROPERTY])));
    await page.route(ROOM_TYPES, (route) =>
      route.request().method() === 'GET'
        ? fulfillJson(route, 200, listBody([ROOM_TYPE]))
        : fulfillJson(
            route,
            422,
            JSON.stringify({
              code: 'E_RATE_CONFIGURATION_INVALID',
              message: 'Sàn lớn hơn trần',
              traceId: 'trace-422',
              timestamp: '2026-10-02T00:00:00.000Z',
              path: '/api/v1/room-types',
              details: [{ field: 'minPrice', issue: 'ABOVE_CEILING' }],
            }),
          ),
    );
    await page.goto('/room-types');
    await page.getByRole('button', { name: 'Thêm loại phòng' }).click();
    await page.getByLabel('Cơ sở').selectOption('p1');
    await page.getByLabel('Mã loại phòng').fill('BAD');
    await page.getByLabel('Giá cơ bản (VND)').fill('800000');
    await page.getByLabel('Giá sàn (VND)').fill('900000');
    await page.getByLabel('Giá trần (VND)').fill('1200000');
    await page.getByRole('button', { name: 'Tạo' }).click();
    await expect(page.getByText('minPrice: ABOVE_CEILING')).toBeVisible();
    await expect(page.getByLabel('Mã loại phòng')).toHaveValue('BAD');
  });

  test('để trống giá thì chặn tại chỗ, không gọi API', async ({ page }) => {
    let postCalls = 0;
    await page.route(PROPERTIES, (route) => fulfillJson(route, 200, listBody([PROPERTY])));
    await page.route(ROOM_TYPES, async (route) => {
      if (route.request().method() === 'GET') {
        await fulfillJson(route, 200, listBody([ROOM_TYPE]));
        return;
      }
      postCalls += 1;
      await fulfillJson(route, 201, JSON.stringify(ROOM_TYPE));
    });
    await page.goto('/room-types');
    await page.getByRole('button', { name: 'Thêm loại phòng' }).click();
    await page.getByLabel('Cơ sở').selectOption('p1');
    await page.getByLabel('Mã loại phòng').fill('NEW');
    await page.getByRole('button', { name: 'Tạo' }).click();
    await expect(page.getByText('basePrice: REQUIRED')).toBeVisible();
    expect(postCalls).toBe(0);
  });

  test('không cuộn ngang ở 360 px (NFR-USE-04)', async ({ page }) => {
    await mockReads(page, [ROOM_TYPE]);
    await page.setViewportSize({ width: 360, height: 800 });
    await page.goto('/room-types');
    await expect(page.getByTestId('room-types-table')).toBeVisible();
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
  });

  test('danh sách không có vi phạm axe serious/critical', async ({ page }) => {
    await mockReads(page, [ROOM_TYPE]);
    await page.goto('/room-types');
    await expect(page.getByTestId('room-types-table')).toBeVisible();
    const results = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
      .analyze();
    const blocking = results.violations.filter(
      (violation) => violation.impact === 'serious' || violation.impact === 'critical',
    );
    expect(blocking.map((violation) => violation.id)).toEqual([]);
  });
});
