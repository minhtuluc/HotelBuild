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

const PROMOTION = {
  id: 'pr1',
  code: 'EARLY10',
  type: 'PERCENT',
  value: 10,
  minNights: 2,
  channelScope: ['WEB'],
  roomTypeScope: ['rt1'],
  validFrom: '2026-11-01T00:00:00.000Z',
  validTo: '2026-11-30T16:59:00.000Z',
  maxUses: 100,
  usedCount: 3,
  stackable: false,
  status: 'ACTIVE',
  version: 1,
};

const PROPERTIES = '**/api/session/sys/properties*';
const ROOM_TYPES = '**/api/session/sys/room-types*';
const PROMOTIONS = '**/api/session/sys/promotions';

operationsWebOnly();
test.beforeEach(async ({ page, request }) => {
  await loginRefundStaff(page, request, 'OWNER');
});

function backend(
  page: Page,
  outcome: { status: number; body?: unknown } = { status: 201 },
): { created: () => string[] } {
  const created: string[] = [];
  void page.route(PROPERTIES, (route) => fulfillJson(route, 200, listBody([PROPERTY])));
  void page.route(ROOM_TYPES, (route) => fulfillJson(route, 200, listBody([ROOM_TYPE])));
  void page.route(PROMOTIONS, async (route) => {
    if (route.request().method() === 'POST') {
      created.push(route.request().postData() ?? '');
      return fulfillJson(
        route,
        outcome.status,
        outcome.body === undefined ? '' : JSON.stringify(outcome.body),
      );
    }
    return fulfillJson(route, 200, listBody([PROMOTION]));
  });
  return { created: () => created };
}

/** Điền form tối thiểu để vượt kiểm tra tại chỗ. */
async function fillValid(page: Page): Promise<void> {
  await page.getByLabel('Mã khuyến mãi').fill('early10');
  await page.getByLabel('Mức giảm (%)').fill('10');
  await page.getByLabel('Đêm tối thiểu').fill('2');
  await page.getByLabel('Hiệu lực từ').fill('2026-11-01T00:00');
  await page.getByLabel('Hiệu lực đến').fill('2026-11-30T23:59');
  await page.getByTestId('promotion-channels').getByLabel('Website').check();
  await page.getByTestId('promotion-roomtypes').getByLabel('DLX').check();
}

test.describe('SCR-29 khuyến mãi trên API giả (HB-061)', () => {
  test('hiện danh sách khuyến mãi', async ({ page }) => {
    backend(page);
    await page.goto('/promotions');
    const table = page.getByTestId('promotions-table');
    await expect(table).toBeVisible();
    await expect(table).toContainText('EARLY10');
    await expect(table).toContainText('Phần trăm');
    await expect(page.getByTestId('promotion-usage-EARLY10')).toHaveText('3/100');
    await expect(table).toContainText('Đang chạy');
  });

  test('thiếu trường thì không gọi API', async ({ page }) => {
    const spy = backend(page);
    await page.goto('/promotions');
    await page.getByRole('button', { name: 'Tạo khuyến mãi' }).click();
    await expect(page.getByText(/Vui lòng sửa \d+ trường được đánh dấu/)).toBeVisible();
    expect(spy.created()).toHaveLength(0);
  });

  test('type đổi thì đổi kiểm tra value', async ({ page }) => {
    const spy = backend(page);
    await page.goto('/promotions');
    await page.getByLabel('Mã khuyến mãi').fill('BIG');
    await page.getByLabel('Mức giảm (%)').fill('150');
    await page.getByRole('button', { name: 'Tạo khuyến mãi' }).click();
    await expect(page.getByText('value: OUT_OF_RANGE')).toBeVisible();
    expect(spy.created()).toHaveLength(0);

    await page.getByLabel('Loại giảm').selectOption('AMOUNT');
    await expect(page.getByLabel('Mức giảm (VND)')).toBeVisible();
    await page.getByLabel('Mức giảm (VND)').fill('500000');
    await page.getByLabel('Đêm tối thiểu').fill('1');
    await page.getByLabel('Hiệu lực từ').fill('2026-11-01T00:00');
    await page.getByLabel('Hiệu lực đến').fill('2026-11-30T23:59');
    await page.getByTestId('promotion-channels').getByLabel('Website').check();
    await page.getByTestId('promotion-roomtypes').getByLabel('DLX').check();
    await page.getByRole('button', { name: 'Tạo khuyến mãi' }).click();
    await expect(page.getByTestId('promotions-saved')).toContainText('BIG');
    expect(spy.created()[0]).toContain('"type":"AMOUNT"');
    expect(spy.created()[0]).toContain('"value":500000');
  });

  test('422 chạm sàn giữ bản nhập', async ({ page }) => {
    backend(page, {
      status: 422,
      body: {
        code: 'E_RATE_BELOW_FLOOR',
        message: 'Khuyến mãi làm giá dưới sàn',
        traceId: 't-floor',
        timestamp: '2026-10-05T00:00:00.000Z',
        path: '/api/session/sys/promotions',
        details: [{ field: 'value', issue: 'BELOW_FLOOR' }],
      },
    });
    await page.goto('/promotions');
    await fillValid(page);
    await page.getByRole('button', { name: 'Tạo khuyến mãi' }).click();
    await expect(page.getByTestId('promotions-config-issue')).toContainText('thấp hơn sàn');
    await expect(page.getByTestId('promotions-config-issue')).toContainText('value: BELOW_FLOOR');
    // Giữ nguyên bản nhập để người dùng sửa mức giảm.
    await expect(page.getByLabel('Mã khuyến mãi')).toHaveValue('early10');
    await expect(page.getByLabel('Mức giảm (%)')).toHaveValue('10');
  });

  test('E_RATE_PROMO_INVALID hiện theo trường', async ({ page }) => {
    backend(page, {
      status: 422,
      body: {
        code: 'E_RATE_PROMO_INVALID',
        message: 'Mã đã hết lượt',
        traceId: 't-promo',
        timestamp: '2026-10-05T00:00:00.000Z',
        path: '/api/session/sys/promotions',
        details: [{ field: 'code', issue: 'MAX_USES_REACHED' }],
      },
    });
    await page.goto('/promotions');
    await fillValid(page);
    await page.getByRole('button', { name: 'Tạo khuyến mãi' }).click();
    const issue = page.getByTestId('promotions-config-issue');
    await expect(issue).toContainText('không hợp lệ');
    await expect(issue).toContainText('code: MAX_USES_REACHED');
  });

  test('tạo xong đọc lại danh sách', async ({ page }) => {
    const spy = backend(page);
    await page.goto('/promotions');
    await fillValid(page);
    await page.getByRole('button', { name: 'Tạo khuyến mãi' }).click();
    await expect(page.getByTestId('promotions-saved')).toContainText('EARLY10');
    await expect(page.getByTestId('promotions-table')).toBeVisible();
    const body = spy.created()[0] ?? '';
    expect(body).toContain('"code":"EARLY10"');
    expect(body).toContain('"channelScope":["WEB"]');
    expect(body).toContain('"roomTypeScope":["rt1"]');
  });

  test('403 và mất mạng', async ({ page }) => {
    await page.route(PROPERTIES, (route) => fulfillJson(route, 200, listBody([PROPERTY])));
    await page.route(ROOM_TYPES, (route) => fulfillJson(route, 200, listBody([ROOM_TYPE])));
    await page.route(PROMOTIONS, (route) => {
      if (route.request().method() === 'POST') return route.abort('failed');
      return fulfillJson(
        route,
        403,
        errorBody('E_RBAC_FORBIDDEN', 'trace-403', '/api/session/sys/promotions'),
      );
    });
    await page.goto('/promotions');
    await expect(page.getByText('Bạn không có quyền xem nội dung này')).toBeVisible();
    await expect(page.getByTestId('promotions-table')).toHaveCount(0);

    await page.route(PROMOTIONS, (route) =>
      route.request().method() === 'POST'
        ? route.abort('failed')
        : fulfillJson(route, 200, listBody([PROMOTION])),
    );
    await page.goto('/promotions');
    await fillValid(page);
    await page.getByRole('button', { name: 'Tạo khuyến mãi' }).click();
    // Mất mạng khi ghi: chưa xác định kết quả (không báo thất bại chắc chắn).
    await expect(page.getByText(/Chưa xác định kết quả/)).toBeVisible();
    await expect(page.getByRole('button', { name: 'Tra cứu kết quả' })).toBeVisible();
  });
});

/** HB-311 (TD-08): sửa / tắt khuyến mãi qua `PUT /promotions/{id}`. */
function editBackend(page: Page, status = 204) {
  const puts: { body: string; ifMatch: string | null }[] = [];
  backend(page);
  void page.route('**/api/session/sys/promotions/*', async (route) => {
    const request = route.request();
    puts.push({ body: request.postData() ?? '', ifMatch: await request.headerValue('if-match') });
    return fulfillJson(
      route,
      status,
      status === 204
        ? ''
        : errorBody('E_GEN_VERSION_CONFLICT', 'trace-put', '/api/session/sys/promotions/pr1'),
    );
  });
  return { puts: () => puts };
}

test.describe('SCR-29 sửa / tắt khuyến mãi (HB-311)', () => {
  test('gia hạn theo giờ VN: chỉ gửi trường đổi, kèm lý do và If-Match', async ({ page }) => {
    const spy = editBackend(page);
    await page.goto('/promotions');
    await page.getByTestId('promotion-EARLY10').getByRole('button', { name: 'Sửa' }).click();
    const panel = page.getByTestId('promotion-edit');
    await expect(panel).toContainText('Sửa khuyến mãi EARLY10 (phiên bản 1)');
    await expect(panel.getByLabel('Hiệu lực đến')).toHaveValue('2026-11-30T23:59');
    await panel.getByLabel('Hiệu lực đến').fill('2026-12-15T23:59');
    await panel.getByLabel('Lý do thay đổi').fill('Gia hạn tới giữa tháng 12');
    await panel.getByRole('button', { name: 'Lưu thay đổi' }).click();
    await expect(page.getByTestId('promotions-updated')).toContainText('EARLY10');
    expect(JSON.parse(spy.puts()[0]?.body ?? '{}')).toEqual({
      validTo: '2026-12-15T16:59:00.000Z',
      reason: 'Gia hạn tới giữa tháng 12',
    });
    expect(spy.puts()[0]?.ifMatch).toBe('"1"');
  });

  test('không cho hạ lượt tối đa dưới số lượt đã dùng', async ({ page }) => {
    const spy = editBackend(page);
    await page.goto('/promotions');
    await page.getByTestId('promotion-EARLY10').getByRole('button', { name: 'Sửa' }).click();
    const panel = page.getByTestId('promotion-edit');
    await panel.getByLabel('Lượt tối đa').fill('2');
    await panel.getByLabel('Lý do thay đổi').fill('Thu hẹp');
    await panel.getByRole('button', { name: 'Lưu thay đổi' }).click();
    await expect(page.getByTestId('promotion-edit-issues')).toContainText(
      'không được nhỏ hơn số lượt đã dùng',
    );
    expect(spy.puts()).toHaveLength(0);
  });

  test('tắt sớm gửi status INACTIVE; xung đột phiên bản báo trong khung', async ({ page }) => {
    const spy = editBackend(page, 412);
    await page.goto('/promotions');
    await page.getByTestId('promotion-EARLY10').getByRole('button', { name: 'Tắt' }).click();
    const panel = page.getByTestId('promotion-toggle');
    await expect(panel).toContainText('Đã dùng 3 lượt');
    await panel.getByLabel('Lý do thay đổi').fill('Hết ngân sách');
    await panel.getByRole('button', { name: 'Tắt khuyến mãi' }).click();
    await expect(page.getByTestId('promotion-toggle-conflict')).toBeVisible();
    expect(JSON.parse(spy.puts()[0]?.body ?? '{}')).toEqual({
      status: 'INACTIVE',
      reason: 'Hết ngân sách',
    });
    await expect(page.getByTestId('promotions-table')).toBeVisible();
  });
});

test('MANAGER không có nút sửa / tắt khuyến mãi', async ({ page, request }) => {
  await loginRefundStaff(page, request, 'MANAGER');
  backend(page);
  await page.goto('/promotions');
  await expect(page.getByTestId('promotions-table')).toContainText('EARLY10');
  await expect(page.getByTestId('promotion-EARLY10').getByRole('button')).toHaveCount(0);
});
