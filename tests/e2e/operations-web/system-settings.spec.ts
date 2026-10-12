import { expect, test, type Page } from '@playwright/test';
import { errorBody, fulfillJson, listBody } from './fake-api';
import { operationsWebOnly } from './guard';
import {loginRefundStaff} from './refund-fixture';

const NUMBER_SETTING = {
  key: 'pricing.maxDiscountPct',
  value: '20',
  valueType: 'NUMBER',
  description: 'Trần giảm giá tối đa',
  updatedBy: 'u1',
  updatedAt: '2026-11-12T07:00:00.000Z',
  version: 4,
};

const BOOLEAN_SETTING = {
  key: 'job.hold.releaseEnabled',
  value: 'true',
  valueType: 'BOOLEAN',
  description: 'Bật giải phóng hold hết hạn',
  updatedBy: 'u2',
  updatedAt: '2026-11-12T06:00:00.000Z',
  version: 2,
};

const AUDIT = {
  id: 'a1',
  actorId: 'u1',
  action: 'SystemSettingUpdate',
  entityType: 'SystemSetting',
  entityId: 'pricing.maxDiscountPct',
  reason: 'Tăng trần',
  beforeJson: null,
  afterJson: null,
  createdAt: '2026-11-12T07:00:00.000Z',
};

const SETTINGS = '**/api/v1/system-settings**';
const AUDIT_LOGS = '**/api/session/sys/audit-logs*';

operationsWebOnly();
test.beforeEach(async({page,request})=>{await loginRefundStaff(page,request,'OWNER');});

function backend(page: Page): { puts: () => string[]; ifMatch: () => (string | undefined)[] } {
  const puts: string[] = [];
  const ifMatch: (string | undefined)[] = [];
  void page.route(SETTINGS, async (route) => {
    if (route.request().method() === 'PUT') {
      ifMatch.push(route.request().headers()['if-match']);
      puts.push(route.request().postData() ?? '');
      return fulfillJson(route, 204, '');
    }
    return fulfillJson(route, 200, listBody([NUMBER_SETTING, BOOLEAN_SETTING]));
  });
  return { puts: () => puts, ifMatch: () => ifMatch };
}

test.describe('SCR-17 tham số hệ thống trên API giả (HB-044)', () => {
  test('hiện bảng tham số', async ({ page }) => {
    backend(page);
    await page.goto('/system-settings');
    const table = page.getByTestId('settings-table');
    await expect(table).toBeVisible();
    await expect(page.getByTestId('setting-pricing.maxDiscountPct')).toContainText('20');
    await expect(page.getByTestId('setting-pricing.maxDiscountPct')).toContainText('NUMBER');
    await expect(page.getByTestId('setting-pricing.maxDiscountPct')).toContainText('u1');
    await expect(page.getByTestId('setting-pricing.maxDiscountPct')).toContainText(
      '12/11/2026 14:00 (giờ VN)',
    );
    await expect(page.getByTestId('setting-pricing.maxDiscountPct')).toContainText('4');
  });

  test('kiểu giá trị sai thì không gọi API', async ({ page }) => {
    const spy = backend(page);
    await page.goto('/system-settings');
    await page.getByTestId('setting-pricing.maxDiscountPct').getByRole('button', { name: 'Sửa' }).click();
    await page.getByLabel('Giá trị mới').fill('hai mươi');
    await page.getByLabel('Lý do thay đổi').fill('Đổi trần');
    await page.getByRole('button', { name: 'Lưu' }).click();
    await expect(page.getByText('value: NOT_NUMBER')).toBeVisible();
    expect(spy.puts()).toHaveLength(0);
  });

  test('lưu gửi If-Match và lý do', async ({ page }) => {
    const spy = backend(page);
    await page.goto('/system-settings');
    await page.getByTestId('setting-pricing.maxDiscountPct').getByRole('button', { name: 'Sửa' }).click();
    await page.getByLabel('Giá trị mới').fill('25');
    await page.getByRole('button', { name: 'Lưu' }).click();
    await expect(page.getByText('reason: REQUIRED')).toBeVisible();
    expect(spy.puts()).toHaveLength(0);

    await page.getByLabel('Lý do thay đổi').fill('Nâng trần dịp lễ');
    await page.getByRole('button', { name: 'Lưu' }).click();
    await expect(page.getByTestId('settings-saved')).toContainText('pricing.maxDiscountPct');
    expect(spy.ifMatch()[0]).toBe('"4"');
    expect(spy.puts()[0]).toContain('"value":"25"');
    expect(spy.puts()[0]).toContain('Nâng trần dịp lễ');
  });

  test('412 hiện xung đột', async ({ page }) => {
    void page.route(SETTINGS, async (route) => {
      if (route.request().method() === 'PUT') {
        return fulfillJson(
          route,
          412,
          errorBody('E_GEN_VERSION_CONFLICT', 'trace-412', '/api/v1/system-settings/x'),
        );
      }
      return fulfillJson(route, 200, listBody([NUMBER_SETTING]));
    });
    await page.goto('/system-settings');
    await page.getByTestId('setting-pricing.maxDiscountPct').getByRole('button', { name: 'Sửa' }).click();
    await page.getByLabel('Giá trị mới').fill('25');
    await page.getByLabel('Lý do thay đổi').fill('Nâng trần');
    await page.getByRole('button', { name: 'Lưu' }).click();
    const conflict = page.getByText(/Dữ liệu đã thay đổi/);
    await expect(conflict).toBeVisible();
    await expect(conflict).toContainText('4');
    await expect(page.getByRole('button', { name: 'Tải lại và so sánh' })).toBeVisible();
  });

  test('403 hiện thiếu quyền và không render ô sửa', async ({ page }) => {
    void page.route(SETTINGS, (route) =>
      fulfillJson(route, 403, errorBody('E_RBAC_FORBIDDEN', 'trace-403', '/api/v1/system-settings')),
    );
    await page.goto('/system-settings');
    await expect(page.getByText('Bạn không có quyền xem nội dung này')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Sửa' })).toHaveCount(0);
  });

  test('lịch sử mở sang SCR-16 kèm lọc', async ({ page }) => {
    backend(page);
    await page.route(AUDIT_LOGS, (route) => fulfillJson(route, 200, listBody([AUDIT])));
    await page.goto('/system-settings');
    const history = page.getByTestId('setting-history-pricing.maxDiscountPct');
    await expect(history).toHaveAttribute(
      'href',
      '/audit-logs?entityType=SystemSetting&entityId=pricing.maxDiscountPct',
    );
    await history.click();
    // SCR-16 đọc lọc từ URL và gửi đúng tham số truy vấn.
    await expect(page).toHaveURL(/entityType=SystemSetting/);
    await expect(page.getByLabel('Loại đối tượng')).toHaveValue('SystemSetting');
    await expect(page.getByLabel('Mã đối tượng')).toHaveValue('pricing.maxDiscountPct');
    await expect(page.getByTestId('audit-table')).toContainText('SystemSettingUpdate');
  });

  test('mất mạng là chưa xác định kết quả', async ({ page }) => {
    void page.route(SETTINGS, (route) =>
      route.request().method() === 'PUT'
        ? route.abort('failed')
        : fulfillJson(route, 200, listBody([NUMBER_SETTING])),
    );
    await page.goto('/system-settings');
    await page.getByTestId('setting-pricing.maxDiscountPct').getByRole('button', { name: 'Sửa' }).click();
    await page.getByLabel('Giá trị mới').fill('25');
    await page.getByLabel('Lý do thay đổi').fill('Nâng trần');
    await page.getByRole('button', { name: 'Lưu' }).click();
    await expect(page.getByText(/Chưa xác định kết quả/)).toBeVisible();
    await expect(page.getByRole('button', { name: 'Tra cứu kết quả' })).toBeVisible();
  });
});
