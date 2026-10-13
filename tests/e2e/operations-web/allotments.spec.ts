import { expect, test, type Page, type Route } from '@playwright/test';
import { errorBody, fulfillJson, listBody } from './fake-api';
import { operationsWebOnly } from './guard';
import { allotmentPutRequestSchema } from '../../../packages/contracts/src/index';
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

const PROPERTIES = '**/api/session/sys/properties**';
const ROOM_TYPES = '**/api/session/sys/room-types**';
const CHANNELS = '**/api/session/sys/channels**';
const ALLOTMENTS = '**/api/session/sys/channel-allotments**';

operationsWebOnly();
test.beforeEach(async ({ page, request }) => {
  await loginRefundStaff(page, request, 'MANAGER');
});

function withEtag(route: Route, body: string, tag = ETAG): Promise<void> {
  return route.fulfill({
    status: 200,
    contentType: 'application/json',
    // `ETag` không thuộc danh sách header an toàn của CORS nên phải khai báo lộ ra cho JS đọc.
    headers: { ETag: tag, 'Access-Control-Expose-Headers': 'ETag' },
    body,
  });
}

/** API giả tối thiểu cho SCR-25; `rows` và cờ lỗi điều khiển được từng ca. */
function backend(
  page: Page,
  options: {
    etag?: string | undefined;
    failure?: 'quota' | 'lost' | 'conflict';
    empty?: boolean;
  } = { etag: ETAG },
): { puts: () => string[]; ifMatch: () => (string | undefined)[]; keys: () => string[] } {
  const puts: string[] = [];
  const keys: string[] = [];
  const ifMatch: (string | undefined)[] = [];
  let rows = options.empty ? [] : ALLOTMENT_ROWS.map((row) => ({ ...row })),
    tag = ETAG;
  void page.route(PROPERTIES, (route) => fulfillJson(route, 200, listBody([PROPERTY])));
  void page.route(ROOM_TYPES, (route) => fulfillJson(route, 200, listBody([ROOM_TYPE])));
  void page.route(CHANNELS, (route) => fulfillJson(route, 200, listBody([CHANNEL])));
  void page.route(ALLOTMENTS, async (route) => {
    if (route.request().method() === 'PUT') {
      ifMatch.push(route.request().headers()['if-match']);
      puts.push(route.request().postData() ?? '');
      keys.push(route.request().headers()['idempotency-key'] ?? '');
      if (options.failure === 'quota')
        return fulfillJson(
          route,
          409,
          JSON.stringify({
            ...JSON.parse(
              errorBody('E_INV_ALLOTMENT_EXCEEDS_ROOMS', 'synthetic', '/channel-allotments'),
            ),
            details: [{ field: 'items[2026-12-24].allotment', issue: 'EXCEEDS_ACTIVE_SUPPLY' }],
          }),
        );
      if (options.failure === 'conflict') {
        tag = '"8"';
        return fulfillJson(
          route,
          412,
          errorBody('E_GEN_VERSION_CONFLICT', 'synthetic', '/channel-allotments'),
        );
      }
      const body = allotmentPutRequestSchema.parse(JSON.parse(route.request().postData() ?? '{}'));
      rows = rows.map((row) => ({
        ...row,
        allotment: body.items.find((item) => item.date === row.date)?.allotment ?? row.allotment,
      }));
      tag = '"' + (BigInt(tag.slice(1, -1)) + 1n) + '"';
      if (options.failure === 'lost') return route.abort('failed');
      return route.fulfill({ status: 204, headers: { ETag: tag }, body: '' });
    }
    const url = new URL(route.request().url()),
      from = url.searchParams.get('from') ?? '',
      to = url.searchParams.get('to') ?? '';
    const body = listBody(rows.filter((row) => row.date >= from && row.date <= to));
    if (options.etag === undefined) return fulfillJson(route, 200, body);
    return withEtag(route, body, tag);
  });
  return { puts: () => puts, ifMatch: () => ifMatch, keys: () => keys };
}

async function openScreen(page: Page): Promise<void> {
  await page.goto('/channel-allotments');
  // Lô giả lập nằm ở 24–25/12; đặt khoảng tường minh để ca kiểm không phụ thuộc ngày chạy.
  await expect(page.getByLabel('Từ ngày')).toBeEnabled();
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
    await page
      .getByTestId('allotment-row-2026-12-24')
      .getByLabel('Hạn mức ngày 2026-12-24')
      .fill('8');
    await expect(page.getByTestId('allotment-issue-2026-12-24')).toHaveText('');
    expect(spy.puts()).toHaveLength(0);
  });

  test('lưu lô trong một request kèm If-Match, chỉ ngày đã đổi (AC3, AC4)', async ({ page }) => {
    const spy = backend(page);
    await openScreen(page);
    await page.getByLabel('Hạn mức ngày 2026-12-25').fill('7');
    await page.getByTestId('allotment-editor').getByRole('button', { name: 'Lưu lô' }).click();
    await expect(page.getByTestId('allotments-saved')).toContainText('Đã cập nhật lô');
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
    await page.goto('/channel-allotments');
    await expect(page.getByTestId('allotments-table')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Thử lại' })).toBeVisible();
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
      const url = new URL(route.request().url()),
        from = url.searchParams.get('from') ?? '',
        to = url.searchParams.get('to') ?? '';
      return withEtag(
        route,
        listBody(ALLOTMENT_ROWS.filter((row) => row.date >= from && row.date <= to)),
      );
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
      const url = new URL(route.request().url()),
        from = url.searchParams.get('from') ?? '',
        to = url.searchParams.get('to') ?? '';
      return withEtag(
        route,
        listBody(ALLOTMENT_ROWS.filter((row) => row.date >= from && row.date <= to)),
      );
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
      fulfillJson(
        route,
        403,
        errorBody('E_RBAC_FORBIDDEN', 'trace-403', '/api/v1/channel-allotments'),
      ),
    );
    await page.goto('/channel-allotments');
    await expect(page.getByText('Bạn không có quyền xem nội dung này')).toBeVisible();
    await expect(page.getByTestId('allotments-table')).toHaveCount(0);
  });
});

test('quota409 keeps all invalid dates and entered quota; warning does not prevent onePUT', async ({
  page,
}) => {
  const options = { etag: ETAG, failure: 'quota' as const };
  const spy = backend(page, options);
  await openScreen(page);
  await page.getByLabel('Hạn mức ngày 2026-12-24').fill('9');
  await page.getByRole('button', { name: 'Lưu lô', exact: true }).click();
  await expect(page.getByText('items[2026-12-24].allotment: EXCEEDS_ACTIVE_SUPPLY')).toBeVisible();
  await expect(page.getByLabel('Hạn mức ngày 2026-12-24')).toHaveValue('9');
  await expect(page.getByLabel('Hạn mức ngày 2026-12-24')).toBeEnabled();
  expect(spy.puts()).toHaveLength(1);
});
test('empty configuration stays blank/unknownused; explicitzero sends one changed date', async ({
  page,
}) => {
  const spy = backend(page, { etag: ETAG, empty: true });
  await openScreen(page);
  await expect(page.getByLabel('Hạn mức ngày 2026-12-24')).toHaveValue('');
  await expect(page.getByTestId('allotment-used-2026-12-24')).toHaveText('—');
  await page.getByLabel('Hạn mức ngày 2026-12-24').fill('0');
  await page.getByRole('button', { name: 'Lưu lô', exact: true }).click();
  await expect(page.getByTestId('allotments-saved')).toBeVisible();
  expect(spy.puts()).toHaveLength(1);
  expect(allotmentPutRequestSchema.parse(JSON.parse(spy.puts()[0]!)).items).toEqual([
    { date: '2026-12-24', allotment: 0 },
  ]);
});
test('lost batch remains unknown after reload/read; manual replay keeps exactUUID/body/tag', async ({
  page,
}) => {
  const options: { etag: string; failure?: 'lost' } = { etag: ETAG, failure: 'lost' };
  const spy = backend(page, options);
  await openScreen(page);
  await page.getByLabel('Hạn mức ngày 2026-12-24').fill('6');
  await page.getByRole('button', { name: 'Lưu lô', exact: true }).click();
  await expect(page.getByTestId('admin-unknown')).toBeVisible();
  await page.reload();
  await expect(page.getByTestId('admin-unknown')).toContainText(spy.keys()[0]!);
  await page.getByRole('button', { name: 'Tra cứu kết quả', exact: true }).click();
  await expect(page.getByTestId('admin-unknown')).toBeVisible();
  await expect(page.getByRole('combobox', { name: 'Kênh', exact: true })).toBeDisabled();
  expect(spy.puts()).toHaveLength(1);
  delete options.failure;
  await page.getByRole('button', { name: 'Gửi lại đúng yêu cầu', exact: true }).click();
  await expect(page.getByTestId('allotments-saved')).toBeVisible();
  expect(spy.puts()).toHaveLength(2);
  expect(spy.puts()[1]).toBe(spy.puts()[0]);
  expect(spy.keys()[1]).toBe(spy.keys()[0]);
  expect(spy.ifMatch()[1]).toBe(spy.ifMatch()[0]);
});
test('412 fresh compare retains draft then explicit adoption uses newtag/newUUID', async ({
  page,
}) => {
  const options: { etag: string; failure?: 'conflict' } = { etag: ETAG, failure: 'conflict' };
  const spy = backend(page, options);
  await openScreen(page);
  await page.getByLabel('Hạn mức ngày 2026-12-24').fill('6');
  await page.getByRole('button', { name: 'Lưu lô', exact: true }).click();
  await expect(page.getByTestId('admin-conflict')).toBeVisible();
  await page.getByRole('button', { name: 'Tải lại và so sánh', exact: true }).click();
  await expect(
    page.getByRole('button', { name: 'Dùng phiên bản hiện tại để lưu bản nhập', exact: true }),
  ).toBeEnabled();
  await expect(page.getByLabel('Hạn mức ngày 2026-12-24')).toHaveValue('6');
  expect(spy.puts()).toHaveLength(1);
  delete options.failure;
  await page
    .getByRole('button', { name: 'Dùng phiên bản hiện tại để lưu bản nhập', exact: true })
    .click();
  await page.getByRole('button', { name: 'Lưu lô', exact: true }).click();
  await expect(page.getByTestId('allotments-saved')).toBeVisible();
  expect(spy.puts()).toHaveLength(2);
  expect(spy.keys()[1]).not.toBe(spy.keys()[0]);
  expect(spy.ifMatch()).toEqual([ETAG, '"8"']);
});
