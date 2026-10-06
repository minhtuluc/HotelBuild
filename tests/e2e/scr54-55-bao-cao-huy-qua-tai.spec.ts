import { expect, test } from '@playwright/test';
import { OPERATION_STATUSES, installReportApi } from './fake-api/f8/reports';
import { operationsWebOnly } from './operations-web/guard';

operationsWebOnly();

test.describe('SCR-54/SCR-55 báo cáo huỷ & quá tải trên API giả (HB-165)', () => {
  test('SCR-54 hiện tỷ lệ huỷ, tiền hoàn theo bậc và công thức (AC1)', async ({ page }) => {
    installReportApi(page);
    await page.goto('/reports/cancellations');
    const summary = page.getByTestId('cancel-summary');
    await expect(summary).toContainText('Tỷ lệ huỷ: 12.5%');
    await expect(summary).toContainText('Số ca huỷ: 3');
    await expect(summary).toContainText('1.304.000 ₫');
    await expect(page.getByTestId('cancel-row-FLEX7-72')).toContainText('72h');
    await expect(page.getByTestId('cancel-row-NONREF--1')).toContainText('bậc bắt tất');
    await expect(page.getByText('Tỷ lệ huỷ = số booking CANCELLED', { exact: false })).toBeVisible();
  });

  test('SCR-54 lọc theo gói giá đi vào cả lần đọc và lệnh xuất (AC1)', async ({ page }) => {
    const spy = installReportApi(page);
    await page.goto('/reports/cancellations');
    await page.getByLabel('Gói giá').selectOption('SAVER3');
    await page.getByRole('button', { name: 'Xem báo cáo' }).click();
    await expect(page.getByTestId('cancellations-table')).toBeVisible();
    expect(spy.reportUrls().at(-1) ?? '').toContain('ratePlanCode=SAVER3');
    await page.getByRole('button', { name: 'Xuất CSV' }).click();
    await expect(page.getByTestId('report-operation')).toContainText('xong');
    expect(spy.exports()[0] ?? '').toContain('"ratePlanCode":"SAVER3"');
  });

  test('SCR-54 xuất báo cáo theo dõi tác vụ tới khi xong (AC1)', async ({ page }) => {
    const spy = installReportApi(page, {
      operationStatuses: [OPERATION_STATUSES.RUNNING, OPERATION_STATUSES.SUCCEEDED],
    });
    await page.goto('/reports/cancellations');
    await page.getByTestId('cancellations-table').waitFor();
    await page.getByRole('button', { name: 'Xuất XLSX' }).click();
    const panel = page.getByTestId('report-operation');
    await expect(panel).toContainText('xong');
    await expect(panel).toContainText('reports/op-1.csv');
    expect(spy.polls()).toBeGreaterThanOrEqual(2);
    expect(spy.exports()[0] ?? '').toContain('"report":"cancellations"');
    expect(spy.exports()[0] ?? '').toContain('"format":"XLSX"');
  });

  test('SCR-54 403 thì thiếu quyền, không bảng và không nút xuất (AC2)', async ({ page }) => {
    installReportApi(page, {
      readStatus: 403,
      readErrorBody: JSON.stringify({
        code: 'E_RBAC_FORBIDDEN',
        message: 'Không có quyền',
        traceId: 'trace-403',
        timestamp: '2026-10-02T00:00:00.000Z',
        path: '/api/v1/reports/cancellations',
      }),
    });
    await page.goto('/reports/cancellations');
    await expect(page.getByText('Bạn không có quyền xem nội dung này')).toBeVisible();
    await expect(page.getByTestId('cancellations-table')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Xuất CSV' })).toHaveCount(0);
  });

  test('SCR-55 hiện số ca, trạng thái và chi phí xử lý nguyên số máy chủ (AC1)', async ({ page }) => {
    installReportApi(page);
    await page.goto('/reports/overbooking');
    const summary = page.getByTestId('overbooking-summary');
    await expect(summary).toContainText('Số ca quá tải: 2');
    await expect(summary).toContainText('1.550.000 ₫');
    const resolved = page.getByTestId('overbooking-row-ob-1');
    await expect(resolved).toContainText('Đã xử lý (RESOLVED)');
    await expect(resolved).toContainText('200.000 ₫');
    await expect(resolved).toContainText('1.100.000 ₫');
    await expect(resolved).toContainText('150.000 ₫');
    await expect(resolved).toContainText('23/12/2026 16:00 (giờ VN)');
    const open = page.getByTestId('overbooking-row-ob-2');
    await expect(open).toContainText('Đang mở (OPEN)');
    // Ca chưa xử lý thì cột "xử lý xong" để trống, không bịa mốc.
    await expect(open).toContainText('—');
    await expect(page.getByText('Chi phí xử lý = Σ chiết khấu ghép phòng', { exact: false })).toBeVisible();
  });

  test('SCR-55 lọc theo trạng thái ca và không có nút xuất (hợp đồng chưa khai) (AC1, AC2)', async ({
    page,
  }) => {
    const spy = installReportApi(page);
    await page.goto('/reports/overbooking');
    await page.getByLabel('Trạng thái ca').selectOption('RESOLVED');
    await page.getByRole('button', { name: 'Xem báo cáo' }).click();
    await expect(page.getByTestId('overbooking-table')).toBeVisible();
    expect(spy.reportUrls().at(-1) ?? '').toContain('status=RESOLVED');
    await expect(page.getByRole('button', { name: 'Xuất CSV' })).toHaveCount(0);
  });

  test('kỳ sai thì chặn tại chỗ, không gọi thêm API (AC2)', async ({ page }) => {
    const spy = installReportApi(page);
    await page.goto('/reports/overbooking');
    await page.getByTestId('overbooking-table').waitFor();
    const before = spy.reportCalls();
    await page.getByLabel('Từ ngày').fill('2026-12-27');
    await page.getByLabel('Đến ngày').fill('2026-12-24');
    await page.getByRole('button', { name: 'Xem báo cáo' }).click();
    await expect(page.getByText('to: BEFORE_START')).toBeVisible();
    expect(spy.reportCalls()).toBe(before);
  });
});
