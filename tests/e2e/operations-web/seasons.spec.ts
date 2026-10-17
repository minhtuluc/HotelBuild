import { expect, test, type Page } from '@playwright/test';
import { errorBody, fulfillJson, listBody } from './fake-api';
import { operationsWebOnly } from './guard';
import { loginRefundStaff } from './refund-fixture';

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
  basePrice: 1_100_000,
  minPrice: 680_000,
  maxPrice: 3_000_000,
  allowShared: false,
  bedCount: 1,
  version: 2,
};

const CALENDAR = {
  roomTypeId: 'rt1',
  from: '2026-06-01',
  to: '2026-06-02',
  entries: [
    {
      date: '2026-06-01',
      basePrice: 1_100_000,
      seasonMultiplier: 1.4,
      weekendMultiplier: 1,
      occupancyMultiplier: 1,
      losMultiplier: 1,
      channelMultiplier: 1,
      clamped: false,
      nightlyPrice: 1_540_000,
      source: 'SEASON',
      seasonName: 'Hè 2026',
    },
    {
      date: '2026-06-02',
      basePrice: 1_100_000,
      seasonMultiplier: 1,
      weekendMultiplier: 1,
      occupancyMultiplier: 1,
      losMultiplier: 1,
      channelMultiplier: 1,
      clamped: false,
      nightlyPrice: 1_100_000,
      source: 'BASE',
    },
  ],
};

/** Một mùa đang cấu hình do `GET /seasons` trả (AC1). */
const SEASON = {
  id: 's1',
  propertyId: 'p1',
  name: 'Hè 2026',
  startDate: '2026-06-01',
  endDate: '2026-08-31',
  multiplier: 1.4,
  priority: 5,
  weekendSurchargeEnabled: true,
  version: 2,
};

const PROPERTIES = '**/api/session/sys/properties*';
const ROOM_TYPES = '**/api/session/sys/room-types*';
const CALENDARS = '**/api/session/sys/room-types/*/rate-calendar*';
const SEASONS = '**/api/session/sys/seasons**';

operationsWebOnly();
test.beforeEach(async ({ page, request }) => {
  await loginRefundStaff(page, request, 'OWNER');
});

function backend(page: Page, seasons: readonly unknown[] = [SEASON]): { created: () => string[] } {
  const created: string[] = [];
  void page.route(PROPERTIES, (route) => fulfillJson(route, 200, listBody([PROPERTY])));
  void page.route(ROOM_TYPES, (route) => fulfillJson(route, 200, listBody([ROOM_TYPE])));
  void page.route(CALENDARS, (route) => fulfillJson(route, 200, JSON.stringify(CALENDAR)));
  void page.route(SEASONS, async (route) => {
    if (route.request().method() === 'POST') {
      created.push(route.request().postData() ?? '');
      return fulfillJson(route, 201, '');
    }
    return fulfillJson(route, 200, listBody(seasons));
  });
  return { created: () => created };
}

test.describe('SCR-27 mùa & hệ số trên API giả (HB-059)', () => {
  test('mùa thắng lấy từ máy chủ', async ({ page }) => {
    backend(page);
    await page.goto('/seasons');
    const table = page.getByTestId('seasons-calendar');
    await expect(table).toBeVisible();
    await expect(page.getByTestId('season-of-2026-06-01')).toHaveText('Hè 2026');
    await expect(page.getByTestId('season-of-2026-06-02')).toHaveText('—');
    await expect(table).toContainText('1.540.000 ₫');
    await expect(page.getByTestId('seasons-winner-note')).toContainText('GET rate-calendar');
  });

  test('form sai thì không gọi API', async ({ page }) => {
    const spy = backend(page);
    await page.goto('/seasons');
    await page.getByLabel('Tên mùa').fill('');
    await page.getByRole('button', { name: 'Tạo mùa' }).click();
    await expect(page.getByText('Vui lòng sửa 1 trường được đánh dấu')).toBeVisible();
    expect(spy.created()).toHaveLength(0);
  });

  test('chồng lấn được phép kèm cảnh báo', async ({ page }) => {
    const spy = backend(page);
    await page.goto('/seasons');
    await page.getByLabel('Tên mùa').fill('Mùa mới');
    await expect(page.getByTestId('seasons-overlap')).toContainText('Hè 2026');
    // Vẫn tạo được: chồng lấn không bị chặn.
    await page.getByRole('button', { name: 'Tạo mùa' }).click();
    await expect(page.getByTestId('seasons-saved')).toContainText('Mùa mới');
    expect(spy.created()).toHaveLength(1);
  });

  test('tạo mùa gửi đúng hợp đồng', async ({ page }) => {
    const spy = backend(page);
    await page.goto('/seasons');
    await page.getByLabel('Tên mùa').fill('Cao điểm hè');
    await page.getByLabel('Hệ số').fill('1,4');
    await page.getByLabel('Ưu tiên').fill('5');
    await page.getByRole('button', { name: 'Tạo mùa' }).click();
    await expect(page.getByTestId('seasons-saved')).toBeVisible();
    const body = spy.created()[0] ?? '';
    expect(body).toContain('"name":"Cao điểm hè"');
    expect(body).toContain('"multiplier":1.4');
    expect(body).toContain('"priority":5');
    expect(body).toContain('"propertyId":"p1"');
  });

  test('403 hiện thiếu quyền', async ({ page }) => {
    await page.route(PROPERTIES, (route) => fulfillJson(route, 200, listBody([PROPERTY])));
    await page.route(ROOM_TYPES, (route) => fulfillJson(route, 200, listBody([ROOM_TYPE])));
    await page.route(CALENDARS, (route) =>
      fulfillJson(
        route,
        403,
        errorBody('E_RBAC_FORBIDDEN', 'trace-403', '/api/session/sys/rate-calendar'),
      ),
    );
    await page.goto('/seasons');
    await expect(page.getByText('Bạn không có quyền xem nội dung này')).toBeVisible();
    await expect(page.getByTestId('seasons-calendar')).toHaveCount(0);
  });

  test('mất mạng là chưa xác định kết quả', async ({ page }) => {
    await page.route(PROPERTIES, (route) => fulfillJson(route, 200, listBody([PROPERTY])));
    await page.route(ROOM_TYPES, (route) => fulfillJson(route, 200, listBody([ROOM_TYPE])));
    await page.route(CALENDARS, (route) => fulfillJson(route, 200, JSON.stringify(CALENDAR)));
    await page.route(SEASONS, (route) =>
      route.request().method() === 'POST'
        ? route.abort('failed')
        : fulfillJson(route, 200, listBody([SEASON])),
    );
    await page.goto('/seasons');
    await page.getByLabel('Tên mùa').fill('Mùa A');
    await page.getByRole('button', { name: 'Tạo mùa' }).click();
    await expect(page.getByText(/Chưa xác định kết quả/)).toBeVisible();
  });

  test('hiện danh sách mùa', async ({ page }) => {
    backend(page);
    await page.goto('/seasons');
    const list = page.getByTestId('seasons-list');
    await expect(list).toBeVisible();
    await expect(list).toContainText('Hè 2026');
    await expect(list).toContainText('2026-06-01 → 2026-08-31');
    await expect(list).toContainText('1,40');
    await expect(list).toContainText('Có');
    await expect(page.getByTestId('season-Hè 2026')).toContainText('2');
  });

  test('cơ sở chưa có mùa thì ghi rõ', async ({ page }) => {
    backend(page, []);
    await page.goto('/seasons');
    await expect(page.getByTestId('seasons-list-empty')).toContainText('chưa có mùa');
  });
});
