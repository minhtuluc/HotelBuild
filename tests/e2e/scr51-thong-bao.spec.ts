import { expect, test } from '@playwright/test';
import { installNotiApi } from './fake-api/f8/notifications';
import { operationsWebOnly } from './operations-web/guard';
import { loginRefundStaff } from './operations-web/refund-fixture';

operationsWebOnly();

test.beforeEach(async ({ page, request }) => {
  await loginRefundStaff(page, request, 'OWNER');
});

test.describe('SCR-51 hàng đợi thông báo trên API giả (HB-169)', () => {
  test('hiện trạng thái, số lần thử, lỗi và người nhận đã che (AC1)', async ({ page }) => {
    installNotiApi(page);
    await page.goto('/noti/notifications');
    const failed = page.getByTestId('noti-row-n3');
    await expect(failed).toContainText('PAYMENT_RECEIPT');
    await expect(failed).toContainText('Zalo OA');
    await expect(failed).toContainText('Thất bại');
    await expect(failed).toContainText('3');
    await expect(page.getByTestId('noti-error-n3')).toHaveText('Nhà cung cấp Zalo trả 500');
    // Cảnh báo khi đã thất bại đủ 3 lần (BR-SYS-06).
    await expect(failed).toContainText('cần nhân viên kiểm tra thủ công');
    await expect(page.getByTestId('noti-row-n2')).toContainText('+8491****02');
  });

  test('nút gửi lại tắt khi chưa đủ 5 phút hoặc đã đủ 3 lần (AC1)', async ({ page }) => {
    installNotiApi(page);
    await page.goto('/noti/notifications');
    await expect(page.getByTestId('noti-resend-n1')).toBeEnabled();
    await expect(page.getByTestId('noti-resend-n2')).toBeDisabled();
    await expect(page.getByTestId('noti-block-n2')).toContainText('Chưa đủ 5 phút');
    await expect(page.getByTestId('noti-resend-n3')).toBeDisabled();
    await expect(page.getByTestId('noti-block-n3')).toContainText('Đã đủ 3 lần');
  });

  test('gửi lại kèm lý do bắt buộc rồi tải lại hàng đợi (AC1)', async ({ page }) => {
    const spy = installNotiApi(page);
    await page.goto('/noti/notifications');
    await page.getByTestId('noti-resend-n1').click();
    const form = page.getByTestId('noti-resend-form');
    await form.getByRole('button', { name: 'Gửi lại thông báo' }).click();
    await expect(page.getByText('reason: REQUIRED')).toBeVisible();
    expect(spy.resendBodies()).toHaveLength(0);

    await form.getByLabel('Lý do gửi lại').fill('Khách báo chưa nhận email');
    await form.getByRole('button', { name: 'Gửi lại thông báo' }).click();
    await expect(page.getByTestId('noti-saved')).toContainText('n1');
    expect(spy.resendBodies()).toHaveLength(1);
    expect(spy.resendBodies()[0] ?? '').toContain('Khách báo chưa nhận email');
  });

  test('lọc theo trạng thái và kênh đi vào truy vấn (AC1)', async ({ page }) => {
    const spy = installNotiApi(page);
    await page.goto('/noti/notifications');
    await page.getByLabel('Trạng thái').selectOption('FAILED');
    await page.getByLabel('Kênh gửi').selectOption('ZALO_OA');
    await page.getByLabel('Mẫu thông báo').fill('PAYMENT_RECEIPT');
    await page.getByRole('button', { name: 'Xem hàng đợi' }).click();
    await expect(page.getByTestId('noti-table')).toBeVisible();
    const last = spy.urls().at(-1) ?? '';
    expect(last).toContain('status=FAILED');
    expect(last).toContain('channel=ZALO_OA');
    expect(last).toContain('template=PAYMENT_RECEIPT');
  });

  test('403 thì thiếu quyền, không hiện hàng đợi và không nút gửi lại (AC2)', async ({ page }) => {
    installNotiApi(page, {
      readStatus: 403,
      readErrorBody: JSON.stringify({
        code: 'E_RBAC_FORBIDDEN',
        message: 'Không có quyền',
        traceId: 'trace-403',
        timestamp: '2026-10-02T00:00:00.000Z',
        path: '/api/session/sys/notifications',
      }),
    });
    await page.goto('/noti/notifications');
    await expect(page.getByText('Bạn không có quyền xem nội dung này')).toBeVisible();
    await expect(page.getByTestId('noti-table')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Gửi lại' })).toHaveCount(0);
  });
});
