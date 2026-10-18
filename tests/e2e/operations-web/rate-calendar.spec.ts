import AxeBuilder from '@axe-core/playwright';
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
  basePrice: 900_000,
  minPrice: 700_000,
  maxPrice: 1_400_000,
  allowShared: false,
  bedCount: 1,
  version: 1,
};

type RateSource = 'BASE' | 'SEASON' | 'OVERRIDE' | 'RATE_PLAN';

interface DaySpec {
  price: number;
  source?: RateSource;
  seasonName?: string;
}

interface CalendarMock {
  /** Các lệnh PUT đã nhận: thân và `If-Match` (phải vắng mặt — lệnh sinh bản ghi giá mới). */
  readonly puts: { body: string; ifMatch: string | undefined }[];
  /** Lịch theo từng ngày, mặc định BASE 900.000 ₫. */
  days: (date: string) => DaySpec;
  warnings: readonly string[];
  /** Phản hồi áp đặt cho PUT; `null` = 200 kèm lịch hiện tại. */
  reply: { status: number; body: string } | null;
  /** Mã lỗi HTTP cho GET (403 = thiếu quyền); `null` = 200. */
  readError: number | null;
  /** Khoảng ngày của lần GET gần nhất, dùng lại cho phản hồi PUT. */
  range: { from: string; to: string };
}

const RATE_CALENDAR = /\/api\/session\/sys\/room-types\/[^/]+\/rate-calendar/;

function datesBetween(from: string, to: string): readonly string[] {
  const start = Date.parse(`${from}T00:00:00Z`);
  const days = Math.round((Date.parse(`${to}T00:00:00Z`) - start) / 86_400_000) + 1;
  return Array.from({ length: days }, (_, index) =>
    new Date(start + index * 86_400_000).toISOString().slice(0, 10),
  );
}

/** Thân `GET/PUT rate-calendar` của API giả (HB-054 chưa có backend). */
function calendarBody(mock: CalendarMock, from: string, to: string): string {
  const entries = datesBetween(from, to).map((date) => {
    const day = mock.days(date);
    return {
      date,
      basePrice: ROOM_TYPE.basePrice,
      seasonMultiplier: 1,
      weekendMultiplier: 1,
      occupancyMultiplier: 1,
      losMultiplier: 1,
      channelMultiplier: 1,
      clamped: false,
      nightlyPrice: day.price,
      ...(day.source === undefined ? {} : { source: day.source }),
      ...(day.seasonName === undefined ? {} : { seasonName: day.seasonName }),
    };
  });
  return JSON.stringify({
    roomTypeId: ROOM_TYPE.id,
    from,
    to,
    entries,
    ...(mock.warnings.length === 0 ? {} : { warnings: mock.warnings }),
  });
}

function mockApi(page: Page): CalendarMock {
  const mock: CalendarMock = {
    puts: [],
    days: () => ({ price: 900_000, source: 'BASE' }),
    warnings: [],
    reply: null,
    readError: null,
    range: { from: '', to: '' },
  };
  // Biểu thức chính quy để tuyến danh sách `room-types` không nuốt tuyến lịch giá của một loại phòng.
  page.route(/\/api\/session\/sys\/properties/, (route) =>
    fulfillJson(route, 200, listBody([PROPERTY])),
  );
  page.route(/\/api\/session\/sys\/room-types(\?|$)/, (route) =>
    fulfillJson(route, 200, listBody([ROOM_TYPE])),
  );
  page.route(RATE_CALENDAR, async (route) => {
    const url = new URL(route.request().url());
    if (route.request().method() === 'GET') {
      const from = url.searchParams.get('from') ?? '';
      const to = url.searchParams.get('to') ?? '';
      mock.range = { from, to };
      if (mock.readError !== null) {
        await fulfillJson(
          route,
          mock.readError,
          errorBody('E_RBAC_FORBIDDEN', 'trace-403', url.pathname),
        );
        return;
      }
      await fulfillJson(route, 200, calendarBody(mock, from, to));
      return;
    }
    mock.puts.push({
      body: route.request().postData() ?? '',
      ifMatch: route.request().headers()['if-match'],
    });
    if (mock.reply !== null) {
      await fulfillJson(route, mock.reply.status, mock.reply.body);
      return;
    }
    await fulfillJson(route, 200, calendarBody(mock, mock.range.from, mock.range.to));
  });
  return mock;
}

const FROM = '2026-12-24';
const TO = '2026-12-26';

async function setRange(page: Page, from = FROM, to = TO): Promise<void> {
  await page.getByLabel('Từ ngày').fill(from);
  await page.getByLabel('Đến ngày').fill(to);
  await page.getByRole('button', { name: 'Tải lịch giá' }).click();
}

async function openRange(page: Page, from = FROM, to = TO): Promise<void> {
  await setRange(page, from, to);
  await expect(page.getByTestId('rate-calendar-table')).toBeVisible();
}

operationsWebOnly();
test.beforeEach(async ({ page, request }) => {
  await loginRefundStaff(page, request, 'OWNER');
});

test.describe('SCR-26 lịch giá & giá cơ bản (HB-058)', () => {
  test('hiện lịch giá kèm nguồn và mùa', async ({ page }) => {
    const mock = mockApi(page);
    mock.days = (date) => {
      if (date === '2026-12-24') {
        return { price: 1_200_000, source: 'SEASON', seasonName: 'Mùa cao điểm' };
      }
      if (date === '2026-12-25') return { price: 900_000, source: 'OVERRIDE' };
      return { price: 900_000, source: 'BASE' };
    };
    await page.goto('/rate-calendar');
    await openRange(page);
    await expect(page.getByTestId('rate-price-text-2026-12-24')).toHaveText('1.200.000 ₫');
    await expect(page.getByTestId('rate-source-2026-12-24')).toHaveText('Theo mùa (SEASON)');
    await expect(page.getByTestId('rate-season-2026-12-24')).toHaveText('Mùa cao điểm');
    await expect(page.getByTestId('rate-source-2026-12-25')).toHaveText('Ghi đè (OVERRIDE)');
    await expect(page.getByTestId('rate-season-2026-12-25')).toHaveText('—');
    await expect(page.getByTestId('rate-source-2026-12-26')).toHaveText('Giá cơ bản (BASE)');
  });

  test('không tự suy giá ở giao diện', async ({ page }) => {
    const mock = mockApi(page);
    mock.days = () => ({ price: 1_200_000, source: 'SEASON', seasonName: 'Mùa cao điểm' });
    await page.goto('/rate-calendar');
    await openRange(page);
    await expect(page.getByTestId('rate-season-2026-12-24')).toHaveText('Mùa cao điểm');
    // Cùng dữ liệu vào, máy chủ trả phản hồi khác: màn hình phải đổi theo máy chủ, không nội suy.
    mock.days = () => ({ price: 1_500_000, source: 'OVERRIDE' });
    await page.getByRole('button', { name: 'Tải lại' }).click();
    await expect(page.getByTestId('rate-price-text-2026-12-24')).toHaveText('1.500.000 ₫');
    await expect(page.getByTestId('rate-source-2026-12-24')).toHaveText('Ghi đè (OVERRIDE)');
    await expect(page.getByTestId('rate-season-2026-12-24')).toHaveText('—');
  });

  test('cảnh báo ngoài sàn–trần', async ({ page }) => {
    const mock = mockApi(page);
    mock.days = (date) => ({ price: date === '2026-12-24' ? 700_000 : 900_000, source: 'BASE' });
    await page.goto('/rate-calendar');
    await openRange(page);
    await page.getByTestId('rate-price-2026-12-24').fill('699999');
    await expect(page.getByTestId('rate-warning-2026-12-24')).toHaveText('Thấp hơn giá sàn.');
    await page.getByTestId('rate-price-2026-12-24').fill('1400001');
    await expect(page.getByTestId('rate-warning-2026-12-24')).toHaveText('Cao hơn giá trần.');
    // Giao diện chỉ nhắc: dưới sàn vẫn gửi, máy chủ mới là nơi chặn (BR-RATE-03/04).
    await page.getByTestId('rate-price-2026-12-24').fill('699999');
    await page.getByLabel('Lý do thay đổi').fill('Giá khách quen');
    await page.getByRole('button', { name: 'Lưu giá' }).click();
    await expect(page.getByTestId('rate-save-success')).toBeVisible();
    expect(mock.puts).toHaveLength(1);
  });

  test('lệch 20% bắt buộc xác nhận', async ({ page }) => {
    const mock = mockApi(page);
    await page.goto('/rate-calendar');
    await openRange(page);
    await page.getByLabel('Lý do thay đổi').fill('Cao điểm');
    await page.getByTestId('rate-price-2026-12-24').fill('1100000');
    await page.getByRole('button', { name: 'Lưu giá' }).click();
    await expect(page.getByText('2026-12-24: LARGE_CHANGE_UNCONFIRMED')).toBeVisible();
    expect(mock.puts).toHaveLength(0);
    // Đúng ±20% thì không cần xác nhận.
    await page.getByTestId('rate-price-2026-12-24').fill('1080000');
    await page.getByRole('button', { name: 'Lưu giá' }).click();
    await expect(page.getByTestId('rate-save-success')).toBeVisible();
    expect(mock.puts).toHaveLength(1);
  });

  test('cờ xác nhận đúng theo mức lệch', async ({ page }) => {
    const mock = mockApi(page);
    await page.goto('/rate-calendar');
    await openRange(page);
    await page.getByLabel('Lý do thay đổi').fill('Khách đoàn');
    await page.getByTestId('rate-price-2026-12-24').fill('1000000');
    await page.getByRole('button', { name: 'Lưu giá' }).click();
    await expect(page.getByTestId('rate-save-success')).toBeVisible();
    expect(mock.puts[0]?.body).toContain('"price":1000000');
    expect(mock.puts[0]?.body).not.toContain('confirmOwnerOverride');
    expect(mock.puts[0]?.ifMatch).toBeUndefined();
    // Lệch lớn + đã tick: đặt cờ trong chính yêu cầu gửi đi (BR-RBAC-04).
    await page.getByLabel('Lý do thay đổi').fill('Cao điểm');
    await page.getByLabel('Tôi xác nhận thay đổi lớn').check();
    await page.getByTestId('rate-price-2026-12-24').fill('1200000');
    await page.getByRole('button', { name: 'Lưu giá' }).click();
    await expect(page.getByTestId('rate-save-success')).toBeVisible();
    expect(mock.puts[1]?.body).toContain('"confirmOwnerOverride":true');
  });

  test('422 giữ nguyên bản nhập', async ({ page }) => {
    const mock = mockApi(page);
    mock.reply = {
      status: 422,
      body: JSON.stringify({
        code: 'E_RATE_CONFIGURATION_INVALID',
        message: 'Dưới sàn',
        traceId: 'trace-422',
        timestamp: '2026-12-24T00:00:00.000Z',
        path: '/api/session/sys/room-types/rt1/rate-calendar',
        details: [{ field: '2026-12-24', issue: 'BELOW_FLOOR' }],
      }),
    };
    await page.goto('/rate-calendar');
    await openRange(page);
    await page.getByTestId('rate-price-2026-12-24').fill('800000');
    await page.getByLabel('Lý do thay đổi').fill('Giảm nhẹ');
    await page.getByRole('button', { name: 'Lưu giá' }).click();
    await expect(page.getByText('2026-12-24: BELOW_FLOOR')).toBeVisible();
    await expect(page.getByTestId('rate-price-2026-12-24')).toHaveValue('800000');
  });

  test('hiện warnings của máy chủ', async ({ page }) => {
    const mock = mockApi(page);
    mock.warnings = ['LONGSTAY14 chưa có giá riêng — đang bằng giá FLEX7'];
    await page.goto('/rate-calendar');
    await openRange(page);
    await expect(page.getByTestId('rate-warnings')).toContainText(
      'LONGSTAY14 chưa có giá riêng — đang bằng giá FLEX7',
    );
  });

  test('412 và 403', async ({ page }) => {
    const mock = mockApi(page);
    mock.readError = 403;
    await page.goto('/rate-calendar');
    await expect(page.getByText('Bạn không có quyền xem nội dung này')).toBeVisible();
    await expect(page.getByTestId('rate-calendar-table')).toHaveCount(0);
    mock.readError = null;
    await setRange(page);
    await expect(page.getByTestId('rate-calendar-table')).toBeVisible();
    // 412 khi ghi: hiện xung đột để tải lại và so sánh, không tự ghi đè.
    mock.reply = {
      status: 412,
      body: errorBody(
        'E_GEN_VERSION_CONFLICT',
        'trace-412',
        '/api/session/sys/room-types/rt1/rate-calendar',
      ),
    };
    await page.getByTestId('rate-price-2026-12-24').fill('1000000');
    await page.getByLabel('Lý do thay đổi').fill('Khách đoàn');
    await page.getByRole('button', { name: 'Lưu giá' }).click();
    await expect(page.getByText('Dữ liệu đã thay đổi', { exact: false })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Tải lại và so sánh' })).toBeVisible();
    expect(mock.puts).toHaveLength(1);
  });

  test('lịch giá không có vi phạm axe serious/critical và không cuộn ngang ở 360 px', async ({
    page,
  }) => {
    const mock = mockApi(page);
    mock.days = (date) => ({
      price: date === '2026-12-24' ? 1_200_000 : 900_000,
      source: 'SEASON',
      seasonName: 'Mùa cao điểm',
    });
    mock.warnings = ['LONGSTAY14 chưa có giá riêng'];
    await page.setViewportSize({ width: 360, height: 800 });
    await page.goto('/rate-calendar');
    await openRange(page);
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
