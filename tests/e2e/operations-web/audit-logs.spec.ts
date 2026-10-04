import { readFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';
import { errorBody, fulfillJson } from './fake-api';
import { operationsWebOnly } from './guard';

const AUDIT = '**/api/v1/audit-logs*';

interface Row {
  id: string;
  actorId: string;
  action: string;
  entityType: string;
  entityId: string;
  reason: string | null;
  beforeJson: string | null;
  afterJson: string | null;
  createdAt: string;
}

const row = (over: Partial<Row> & Pick<Row, 'id'>): Row => ({
  actorId: 'u1',
  action: 'SystemSettingUpdate',
  entityType: 'SystemSetting',
  entityId: 'pricing.maxDiscountPct',
  reason: 'Đổi ngưỡng',
  beforeJson: '{"value":"10"}',
  afterJson: '{"value":"15"}',
  createdAt: '2026-11-12T07:00:00.000Z',
  ...over,
});

function page(rows: readonly Row[], nextCursor: string | null = null, hasMore = false): string {
  return JSON.stringify({
    data: rows,
    meta: { limit: 50, nextCursor, hasMore, total: rows.length },
  });
}

operationsWebOnly();

test.describe('SCR-16 nhật ký kiểm toán trên API giả (HB-043)', () => {
  test('hiện bảng nhật ký', async ({ page: browserPage }) => {
    await browserPage.route(AUDIT, (route) => fulfillJson(route, 200, page([row({ id: 'a1' })])));
    await browserPage.goto('/audit-logs');
    const table = browserPage.getByTestId('audit-table');
    await expect(table).toBeVisible();
    await expect(table).toContainText('u1');
    await expect(table).toContainText('SystemSettingUpdate');
    await expect(table).toContainText('SystemSetting');
    await expect(table).toContainText('pricing.maxDiscountPct');
    await expect(table).toContainText('Đổi ngưỡng');
    await expect(table).toContainText('12/11/2026 14:00 (giờ VN)');
  });

  test('lọc gửi đúng tham số', async ({ page: browserPage }) => {
    const urls: string[] = [];
    await browserPage.route(AUDIT, (route) => {
      const url = route.request().url();
      urls.push(url);
      const query = new URL(url).searchParams;
      const rows = query.get('action') === 'Login' ? [row({ id: 'a2', action: 'Login' })] : [];
      return fulfillJson(route, 200, page(rows));
    });
    await browserPage.goto('/audit-logs');
    await browserPage.getByLabel('Người thao tác').fill('u1');
    await browserPage.getByLabel('Hành động').fill('Login');
    await browserPage.getByRole('button', { name: 'Lọc', exact: true }).click();
    await expect(browserPage.getByTestId('audit-table')).toContainText('Login');
    const last = urls.at(-1) ?? '';
    expect(last).toContain('limit=50');
    expect(last).toContain('actorId=u1');
    expect(last).toContain('action=Login');
  });

  test('tải thêm nối đúng trang', async ({ page: browserPage }) => {
    await browserPage.route(AUDIT, (route) => {
      const cursor = new URL(route.request().url()).searchParams.get('cursor');
      if (cursor === 'c2') {
        // Trang 2 cố tình trả lại a1 để chứng minh không nhân đôi dòng.
        return fulfillJson(route, 200, page([row({ id: 'a1' }), row({ id: 'a3', actorId: 'u3' })]));
      }
      return fulfillJson(route, 200, page([row({ id: 'a1' })], 'c2', true));
    });
    await browserPage.goto('/audit-logs');
    await expect(browserPage.getByTestId('audit-count')).toContainText('1');
    await browserPage.getByTestId('audit-more').click();
    await expect(browserPage.getByTestId('audit-count')).toContainText('2');
    const table = browserPage.getByTestId('audit-table');
    await expect(table.getByRole('cell', { name: 'u3' })).toBeVisible();
    // a1 được trang 2 trả lại nhưng bị bỏ trùng → đúng 2 hàng.
    await expect(table.locator('tbody tr')).toHaveCount(2);
  });

  test('không có thao tác ghi', async ({ page: browserPage }) => {
    await browserPage.route(AUDIT, (route) => fulfillJson(route, 200, page([row({ id: 'a1' })])));
    await browserPage.goto('/audit-logs');
    await expect(browserPage.getByTestId('audit-table')).toBeVisible();
    await expect(browserPage.getByRole('button', { name: /^(Sửa|Xoá|Tạo|Thêm)/ })).toHaveCount(0);
    await expect(browserPage.getByRole('link', { name: /^(Sửa|Xoá|Tạo|Thêm)/ })).toHaveCount(0);
  });

  test('xuất CSV đúng dữ liệu đang xem', async ({ page: browserPage }) => {
    await browserPage.route(AUDIT, (route) =>
      fulfillJson(route, 200, page([row({ id: 'a1' }), row({ id: 'a2', reason: 'Có, "nháy"' })])),
    );
    await browserPage.goto('/audit-logs');
    await expect(browserPage.getByTestId('audit-table')).toBeVisible();
    const [download] = await Promise.all([
      browserPage.waitForEvent('download'),
      browserPage.getByTestId('audit-export').click(),
    ]);
    const path = await download.path();
    if (path === null) throw new Error('trình duyệt không tạo tệp tải về');
    const content = await readFile(path, 'utf8');
    expect(content.startsWith('\uFEFF')).toBe(true);
    expect(content).toContain('Thời điểm,Người thao tác,Hành động,Loại đối tượng,Mã đối tượng,Lý do');
    expect(content).toContain('12/11/2026 14:00 (giờ VN)');
    expect(content).toContain('"Có, ""nháy"""');
    expect(content).not.toContain('beforeJson');
    expect(content).not.toContain('{"value"');
  });

  test('403 hiện thiếu quyền', async ({ page: browserPage }) => {
    await browserPage.route(AUDIT, (route) =>
      fulfillJson(route, 403, errorBody('E_AUTH_OUT_OF_SCOPE', 'trace-403', '/api/v1/audit-logs')),
    );
    await browserPage.goto('/audit-logs');
    await expect(browserPage.getByText('Bạn không có quyền xem nội dung này')).toBeVisible();
    await expect(browserPage.getByTestId('audit-table')).toHaveCount(0);
  });

  test('lỗi mạng giữ bảng cũ', async ({ page: browserPage }) => {
    let fail = false;
    await browserPage.route(AUDIT, (route) => {
      if (fail) return route.abort('failed');
      return fulfillJson(route, 200, page([row({ id: 'a1' })]));
    });
    await browserPage.goto('/audit-logs');
    await expect(browserPage.getByTestId('audit-table')).toBeVisible();
    fail = true;
    await browserPage.getByTestId('audit-reload').click();
    await expect(browserPage.getByTestId('screen-alert')).toBeVisible();
    await expect(browserPage.getByTestId('audit-table')).toContainText('u1');
    await expect(browserPage.getByText('Chưa có dữ liệu')).toHaveCount(0);
  });
});
