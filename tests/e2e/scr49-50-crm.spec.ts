import { expect, test } from '@playwright/test';
import { installCrmApi } from './fake-api/f8/crm';
import { operationsWebOnly } from './operations-web/guard';
import { loginRefundStaff } from './operations-web/refund-fixture';

operationsWebOnly();

test.beforeEach(async ({ page, request }) => {
  await loginRefundStaff(page, request, 'OWNER');
});

test.describe('SCR-49/SCR-50 CRM quản trị trên API giả (HB-167)', () => {
  test('SCR-49 hiện hồ sơ khách, hạng và trạng thái danh sách đen (AC2)', async ({ page }) => {
    installCrmApi(page);
    await page.goto('/crm/guests');
    const an = page.getByTestId('guest-g1');
    await expect(an).toContainText('Nguyễn Văn An');
    await expect(an).toContainText('+84912000001');
    await expect(an).toContainText('Vàng');
    await expect(an).toContainText('1200');
    await expect(an).toContainText('Không chặn');
    await expect(page.getByTestId('guest-g2')).toContainText('Đang chặn');
    // Không có thao tác xoá cứng hồ sơ (§2.14).
    await expect(page.getByRole('button', { name: /xo[áa]/i })).toHaveCount(0);
  });

  test('SCR-49 tra cứu gửi đúng bộ lọc đã chọn (AC2)', async ({ page }) => {
    const spy = installCrmApi(page);
    await page.goto('/crm/guests');
    await page.getByLabel('Tìm theo tên hoặc SĐT').fill('An');
    await page.getByLabel('Hạng khách').selectOption('GOLD');
    await page.getByLabel('Danh sách đen').selectOption('NO');
    await page.getByRole('button', { name: 'Tra cứu' }).click();
    await expect(page.getByTestId('guests-table')).toBeVisible();
    const last = spy.urls().at(-1) ?? '';
    expect(last).toContain('q=An');
    expect(last).toContain('loyaltyTier=GOLD');
    expect(last).toContain('blacklisted=false');
  });

  test('SCR-49 ẩn danh hoá cần lý do và xác nhận, không xoá hồ sơ (AC1)', async ({ page }) => {
    const spy = installCrmApi(page);
    await page.goto('/crm/guests');
    await page.getByTestId('guest-g1').getByRole('button', { name: 'Ẩn danh hoá' }).click();
    const panel = page.getByTestId('guest-action');
    await expect(panel).toContainText('Hồ sơ không bị xoá');
    await panel.getByRole('button', { name: 'Xác nhận ẩn danh hoá' }).click();
    await expect(page.getByText('reason: REQUIRED')).toBeVisible();
    await expect(page.getByText('confirmed: NOT_CONFIRMED')).toBeVisible();
    expect(spy.anonymizeBodies()).toHaveLength(0);

    await panel.getByLabel('Lý do ẩn danh hoá').fill('Khách yêu cầu xoá dữ liệu');
    await panel.getByLabel('Tôi xác nhận ẩn danh hoá hồ sơ này').check();
    await panel.getByRole('button', { name: 'Xác nhận ẩn danh hoá' }).click();
    await expect(page.getByTestId('crm-saved')).toContainText('Nguyễn Văn An');
    expect(spy.anonymizeBodies()).toHaveLength(1);
    const body = spy.anonymizeBodies()[0] ?? '';
    expect(body).toContain('Khách yêu cầu xoá dữ liệu');
    expect(body).toContain('"requestedAt"');
  });

  test('SCR-49 thêm và gỡ danh sách đen đều kèm lý do (AC1)', async ({ page }) => {
    const spy = installCrmApi(page);
    await page.goto('/crm/guests');
    await page.getByTestId('guest-g1').getByRole('button', { name: 'Thêm vào danh sách đen' }).click();
    await page.getByRole('button', { name: 'Thêm vào danh sách đen' }).last().click();
    await expect(page.getByText('blacklistReason: REQUIRED')).toBeVisible();
    expect(spy.blacklistBodies()).toHaveLength(0);
    await page.getByLabel('Lý do vào danh sách đen').fill('Quỵt tiền phòng');
    await page.getByRole('button', { name: 'Thêm vào danh sách đen' }).last().click();
    await expect(page.getByTestId('crm-saved')).toContainText('danh sách đen');
    expect(spy.blacklistBodies()[0] ?? '').toContain('Quỵt tiền phòng');

    await page.getByTestId('guest-g2').getByRole('button', { name: 'Gỡ khỏi danh sách đen' }).click();
    await page.getByLabel('Lý do gỡ khỏi danh sách đen').fill('Đã thanh toán xong');
    await page.getByRole('button', { name: 'Gỡ khỏi danh sách đen' }).last().click();
    await expect(page.getByTestId('crm-saved')).toContainText('Trần Thị Bình');
    expect(spy.releaseUrls()[0] ?? '').toContain('reason=%C4%90%C3%A3+thanh+to%C3%A1n+xong');
  });

  test('SCR-50 hiện hạng và điểm nguyên số máy chủ trả (AC2)', async ({ page }) => {
    installCrmApi(page);
    await page.goto('/crm/loyalty?guestId=g1');
    await expect(page.getByTestId('loyalty-tier')).toHaveText('Vàng');
    await expect(page.getByTestId('loyalty-points')).toHaveText('1200');
    const table = page.getByTestId('loyalty-table');
    await expect(table).toContainText('3');
    await expect(table).toContainText('7');
    await expect(table).toContainText('02/10/2026 07:00 (giờ VN)');
  });

  test('SCR-49 403 thì thiếu quyền, không hiện bảng hồ sơ (AC3)', async ({ page }) => {
    installCrmApi(page, {
      readStatus: 403,
      readErrorBody: JSON.stringify({
        code: 'E_RBAC_FORBIDDEN',
        message: 'Không có quyền',
        traceId: 'trace-403',
        timestamp: '2026-10-02T00:00:00.000Z',
        path: '/api/session/sys/guests',
      }),
    });
    await page.goto('/crm/guests');
    await expect(page.getByText('Bạn không có quyền xem nội dung này')).toBeVisible();
    await expect(page.getByTestId('guests-table')).toHaveCount(0);
  });
});
