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

const OTA = {
  id: 'c1',
  code: 'OTA_BOOKING',
  name: 'Booking.com',
  multiplier: 1,
  commissionPct: 18,
  holdMinutes: 30,
  overbookAllowed: false,
  version: 4,
};

const WEB = {
  id: 'c2',
  code: 'WEB',
  name: 'Website',
  multiplier: 0.95,
  commissionPct: 0,
  holdMinutes: 20,
  overbookAllowed: true,
  version: 1,
};

const AGENCY = {
  id: 'c3',
  code: 'AGENCY',
  name: 'Đại lý',
  multiplier: 0.8,
  commissionPct: 40,
  holdMinutes: 0,
  overbookAllowed: false,
  version: 2,
};

const DETAIL = { ...OTA, propertyOverrides: [] };

const DETAIL_WITH_OVERRIDE = {
  ...OTA,
  propertyOverrides: [{ propertyId: 'p1', multiplier: 1.1, effectiveFrom: '2026-11-01' }],
};

const CHANNELS = '**/api/v1/channels';
const CHANNEL_DETAIL = '**/api/v1/channels/c1';
const PROPERTIES = '**/api/v1/properties*';

operationsWebOnly();

function backend(
  page: Page,
  detail: unknown = DETAIL,
): { patches: () => string[]; ifMatch: () => (string | undefined)[] } {
  const patches: string[] = [];
  const ifMatch: (string | undefined)[] = [];
  void page.route(PROPERTIES, (route) => fulfillJson(route, 200, listBody([PROPERTY])));
  void page.route(CHANNELS, (route) => fulfillJson(route, 200, listBody([OTA, WEB, AGENCY])));
  void page.route(CHANNEL_DETAIL, async (route) => {
    if (route.request().method() === 'PATCH') {
      ifMatch.push(route.request().headers()['if-match']);
      patches.push(route.request().postData() ?? '');
      return fulfillJson(route, 204, '');
    }
    return fulfillJson(route, 200, JSON.stringify(detail));
  });
  return { patches: () => patches, ifMatch: () => ifMatch };
}

test.describe('SCR-28 kênh trên API giả (HB-060)', () => {
  test('hiện danh sách kênh', async ({ page }) => {
    backend(page);
    await page.goto('/channels');
    const table = page.getByTestId('channels-table');
    await expect(table).toBeVisible();
    await expect(page.getByTestId('channel-OTA_BOOKING')).toContainText('Booking.com');
    await expect(page.getByTestId('channel-OTA_BOOKING')).toContainText('1,00');
    await expect(page.getByTestId('channel-OTA_BOOKING')).toContainText('18');
    await expect(page.getByTestId('channel-OTA_BOOKING')).toContainText('30');
  });

  test('cảnh báo dưới sàn', async ({ page }) => {
    backend(page);
    await page.goto('/channels');
    // Sàn của 18% là 1/(1−0,18) ≈ 1,22 > 1,00.
    await expect(page.getByTestId('channel-floor-OTA_BOOKING')).toContainText('1,22');
    await expect(page.getByTestId('channel-warnings-OTA_BOOKING')).toContainText(
      'Hệ số thấp hơn ngưỡng sàn',
    );
  });

  test('AGENCY được miễn', async ({ page }) => {
    backend(page);
    await page.goto('/channels');
    await expect(page.getByTestId('channel-agency-exempt')).toContainText('miễn quy tắc sàn');
    await expect(page.getByTestId('channel-warnings-AGENCY')).toHaveCount(0);
  });

  test('kênh trực tiếp dưới 1,00 cảnh báo', async ({ page }) => {
    backend(page);
    await page.goto('/channels');
    await expect(page.getByTestId('channel-warnings-WEB')).toContainText('dưới 1,00');
  });

  test('lưu gửi If-Match và trường đã đổi', async ({ page }) => {
    const spy = backend(page);
    await page.goto('/channels');
    await page.getByTestId('channel-OTA_BOOKING').getByRole('button', { name: 'Sửa' }).click();
    await expect(page.getByTestId('channel-editor')).toBeVisible();
    await page.getByLabel('Hệ số', { exact: true }).fill('1,25');
    await page.getByLabel('Lý do thay đổi').fill('Nâng hệ số quý 4');
    await page.getByRole('button', { name: 'Lưu', exact: true }).click();
    await expect(page.getByTestId('channels-note')).toBeVisible();
    expect(spy.ifMatch()[0]).toBe('"4"');
    const body = spy.patches()[0] ?? '';
    expect(body).toContain('"multiplier":1.25');
    expect(body).toContain('Nâng hệ số quý 4');
    // Không gửi trường không đổi.
    expect(body).not.toContain('commissionPct');
    expect(body).not.toContain('holdMinutes');
  });

  test('ghi đè theo cơ sở là dòng mới', async ({ page }) => {
    const spy = backend(page, DETAIL_WITH_OVERRIDE);
    await page.goto('/channels');
    await page.getByTestId('channel-OTA_BOOKING').getByRole('button', { name: 'Sửa' }).click();
    await expect(page.getByTestId('channel-overrides')).toContainText('2026-11-01');
    await page.getByLabel('Cơ sở ghi đè').selectOption('p1');
    await page.getByLabel('Hệ số ghi đè').fill('1,15');
    await page.getByLabel('Hiệu lực từ').fill('2026-12-01');
    await page.getByRole('button', { name: 'Thêm dòng ghi đè' }).click();
    await expect(page.getByTestId('channel-overrides')).toBeVisible();
    const body = spy.patches()[0] ?? '';
    expect(body).toContain('"propertyOverrides"');
    expect(body).toContain('"effectiveFrom":"2026-12-01"');
    expect(body).toContain('"multiplier":1.15');
  });

  test('412 giữ nguyên bản nhập, 403 hiện thiếu quyền', async ({ page }) => {
    await page.route(PROPERTIES, (route) => fulfillJson(route, 200, listBody([PROPERTY])));
    await page.route(CHANNELS, (route) => fulfillJson(route, 200, listBody([OTA])));
    await page.route(CHANNEL_DETAIL, async (route) => {
      if (route.request().method() === 'PATCH') {
        return fulfillJson(
          route,
          412,
          errorBody('E_GEN_VERSION_CONFLICT', 'trace-412', '/api/v1/channels/c1'),
        );
      }
      return fulfillJson(route, 200, JSON.stringify(DETAIL));
    });
    await page.goto('/channels');
    await page.getByTestId('channel-OTA_BOOKING').getByRole('button', { name: 'Sửa' }).click();
    await page.getByLabel('Lý do thay đổi').fill('Đổi hệ số');
    await page.getByLabel('Hệ số', { exact: true }).fill('1,3');
    await page.getByRole('button', { name: 'Lưu', exact: true }).click();
    // Trạng thái `conflict` (§8.1) thay nội dung như SCR-19: hiện xung đột + nút tải lại, KHÔNG tự ghi đè.
    const conflict = page.getByText(/Dữ liệu đã thay đổi/);
    await expect(conflict).toBeVisible();
    await expect(conflict).toContainText('4');
    await expect(page.getByRole('button', { name: 'Tải lại và so sánh' })).toBeVisible();

    await page.route(CHANNELS, (route) =>
      fulfillJson(route, 403, errorBody('E_RBAC_FORBIDDEN', 'trace-403', '/api/v1/channels')),
    );
    await page.goto('/channels');
    await expect(page.getByText('Bạn không có quyền xem nội dung này')).toBeVisible();
    await expect(page.getByTestId('channels-table')).toHaveCount(0);
  });
});
