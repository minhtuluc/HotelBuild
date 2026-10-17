import { expect, test } from '@playwright/test';
import { OPERATION_STATUSES, installReportApi } from './fake-api/f8/reports';
import type { F8ReportSpy } from './fake-api/f8/reports';
import { operationsWebOnly } from './operations-web/guard';
import { loginRefundStaff } from './operations-web/refund-fixture';

operationsWebOnly();

test.beforeEach(async ({ page, request }) => {
  await loginRefundStaff(page, request, 'OWNER');
});

test.describe('SCR-52/SCR-53 báo cáo F8 trên API giả (HB-164)', () => {
  test('SCR-52 hiện công suất và ADR/RevPAR nguyên số máy chủ trả (AC1)', async ({ page }) => {
    installReportApi(page);
    await page.goto('/reports/occupancy');
    const occupancy = page.getByTestId('occupancy-row-2026-12-24');
    await expect(occupancy).toContainText('12');
    await expect(occupancy).toContainText('20');
    await expect(occupancy).toContainText('60');
    // Công thức và tử số–mẫu số hiển thị, giao diện không tính lại.
    await expect(page.getByText('Công suất = phòng-đêm đã bán ÷ phòng-đêm khả dụng')).toBeVisible();
    const adr = page.getByTestId('adr-row-2026-12-24');
    await expect(adr).toContainText('13.440.000 ₫');
    await expect(adr).toContainText('1.120.000 ₫');
    await expect(adr).toContainText('672.000 ₫');
    await expect(
      page.getByText('ADR = doanh thu thuần ÷ phòng-đêm đã bán', { exact: false }),
    ).toBeVisible();
  });

  test('SCR-53 hiện doanh thu 7 kênh và dòng tổng cộng theo máy chủ (AC1)', async ({ page }) => {
    installReportApi(page);
    await page.goto('/reports/revenue-by-channel');
    await expect(page.getByTestId('revenue-row-WEB')).toContainText('8.112.000 ₫');
    await expect(page.getByTestId('revenue-row-OTA_BOOKING')).toContainText('959.175 ₫');
    await expect(page.getByTestId('revenue-row-OTA_BOOKING')).toContainText('4.369.575 ₫');
    const total = page.getByTestId('revenue-total');
    await expect(total).toContainText('13.440.750 ₫');
    await expect(total).toContainText('12.481.575 ₫');
    await expect(total).toContainText('8');
  });

  test('xuất CSV gửi đúng hợp đồng rồi theo dõi tác vụ tới khi xong (AC2)', async ({ page }) => {
    const spy: F8ReportSpy = installReportApi(page, {
      operationStatuses: [OPERATION_STATUSES.RUNNING, OPERATION_STATUSES.SUCCEEDED],
    });
    await page.goto('/reports/occupancy');
    await page.getByTestId('occupancy-table').waitFor();
    await page.getByRole('button', { name: 'Xuất CSV' }).first().click();
    await expect(page.getByTestId('report-operation')).toContainText('xong');
    await expect(page.getByTestId('report-operation')).toContainText('reports/op-1.csv');
    expect(spy.polls()).toBeGreaterThanOrEqual(2);
    expect(spy.exports()).toHaveLength(1);
    const body = spy.exports()[0] ?? '';
    expect(body).toContain('"report":"occupancy"');
    expect(body).toContain('"format":"CSV"');
    expect(body).toContain('"from"');
  });

  test('tác vụ xuất lỗi thì hiện mã lỗi, không báo thành công (AC2)', async ({ page }) => {
    installReportApi(page, { operationStatuses: [OPERATION_STATUSES.FAILED] });
    await page.goto('/reports/revenue-by-channel');
    await page.getByTestId('revenue-table').waitFor();
    await page.getByRole('button', { name: 'Xuất XLSX' }).click();
    const panel = page.getByTestId('report-operation');
    await expect(panel).toContainText('lỗi');
    await expect(panel).toContainText('E_GEN_INTERNAL');
  });

  test('kỳ sai thì chặn tại chỗ, không gọi thêm API (AC1)', async ({ page }) => {
    const spy = installReportApi(page);
    await page.goto('/reports/occupancy');
    await page.getByTestId('occupancy-table').waitFor();
    const before = spy.reportCalls();
    await page.getByLabel('Từ ngày').fill('2026-12-27');
    await page.getByLabel('Đến ngày').fill('2026-12-24');
    await page.getByRole('button', { name: 'Xem báo cáo' }).click();
    await expect(page.getByText('to: BEFORE_START')).toBeVisible();
    expect(spy.reportCalls()).toBe(before);
  });

  test('403 khi đọc thì thiếu quyền, không hiện bảng và nút xuất (AC3)', async ({ page }) => {
    installReportApi(page, {
      readStatus: 403,
      readErrorBody: JSON.stringify({
        code: 'E_RBAC_FORBIDDEN',
        message: 'Không có quyền',
        traceId: 'trace-403',
        timestamp: '2026-10-02T00:00:00.000Z',
        path: '/api/session/sys/reports/occupancy',
      }),
    });
    await page.goto('/reports/revenue-by-channel');
    await expect(page.getByText('Bạn không có quyền xem nội dung này')).toBeVisible();
    await expect(page.getByTestId('revenue-table')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Xuất CSV' })).toHaveCount(0);
  });

  test('xuất báo cáo dùng đúng kỳ đang xem trên màn (TC-REP-02)', async ({ page }) => {
    const spy = installReportApi(page);
    await page.goto('/reports/revenue-by-channel');
    await page.getByLabel('Từ ngày').fill('2026-12-24');
    await page.getByLabel('Đến ngày').fill('2026-12-27');
    await page.getByRole('button', { name: 'Xem báo cáo' }).click();
    await page.getByTestId('revenue-table').waitFor();
    await page.getByRole('button', { name: 'Xuất CSV' }).click();
    await expect(page.getByTestId('report-operation')).toContainText('xong');
    const body = spy.exports()[0] ?? '';
    expect(body).toContain('"report":"revenue-by-channel"');
    expect(body).toContain('"from":"2026-12-24"');
    expect(body).toContain('"to":"2026-12-27"');
  });
});
