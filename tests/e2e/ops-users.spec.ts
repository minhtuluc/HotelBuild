import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { installUsersApi } from './fake-api/users/users';
import { operationsWebOnly } from './operations-web/guard';
import { loginCollectionStaff } from './operations-web/collect-fixture';

/**
 * SCR-15 (HB-021) — người dùng, vai trò, phạm vi cơ sở trên API giả F1 (`fake-api/users`).
 *
 * Server HB-016 chưa có: ca này kiểm giao diện trên **hợp đồng đã phát hành**, chưa phải nghiệm thu với API
 * thật. Trọng tâm: mật khẩu tạm hiện một lần (AC2), If-Match + 412 (AC3), ẩn lựa chọn nhưng vẫn hiện 403
 * nguyên văn (AC4), xoá PIN có xác nhận (AC5), thiếu quyền (AC6), axe + 360 px (AC7).
 */
operationsWebOnly();

async function open(page: Page, options: Parameters<typeof installUsersApi>[1] = {}) {
  await loginCollectionStaff(page);
  const spy = await installUsersApi(page, options);
  await page.goto('/admin/users');
  return spy;
}

async function expectAxeClean(page: Page): Promise<void> {
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze();
  const blocking = results.violations.filter(
    (violation) => violation.impact === 'serious' || violation.impact === 'critical',
  );
  expect(blocking.map((violation) => violation.id)).toEqual([]);
}

test('AC1 — bảng người dùng, lọc theo vai trò/từ khoá, tải thêm theo con trỏ', async ({ page }) => {
  const spy = await open(page, { pageSize: 2 });
  await expect(page.getByTestId('user-row-u-me')).toBeVisible();
  await expect(page.getByTestId('user-row-u1')).toHaveCount(0);
  await page.getByTestId('users-more').click();
  await expect(page.getByTestId('user-row-u1')).toBeVisible();
  await page.getByTestId('users-more').click();
  const row = page.getByTestId('user-row-u2');
  await expect(row).toContainText('quan.ly');
  await expect(row).toContainText('Đà Lạt, Nha Trang');
  await expect(row).toContainText('Đang tạm khoá đến');
  await expect(row).toContainText('Chưa có PIN');
  await expect(page.getByTestId('user-row-u3')).toContainText('Đã vô hiệu');
  await expect(page.getByTestId('user-row-u-owner')).toContainText('Toàn chuỗi');
  expect(spy.listUrls.some((url) => url.includes('cursor='))).toBe(true);

  await page.locator('[data-testid="users-filters"] select[name="role"]').selectOption('MANAGER');
  await page.locator('input[name="q"]').fill('quan');
  await page.getByTestId('users-apply').click();
  await expect(page.getByTestId('user-row-u2')).toBeVisible();
  await expect(page.getByTestId('user-row-u1')).toHaveCount(0);
  const last = spy.listUrls.at(-1) ?? '';
  expect(last).toContain('role=MANAGER');
  expect(last).toContain('q=quan');
});

test('AC2 — mật khẩu tạm sinh ở trình duyệt, hiện một lần, có nút sao chép', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  const spy = await open(page);
  await page.getByTestId('users-create-open').click();
  await page.locator('input[name="username"]').fill('moi.nv');
  await page.locator('input[name="fullName"]').fill('Nhân viên Mới');
  await page.locator('input[name="phone"]').fill('0912345678');
  await page.locator('[data-testid="create-form"] select[name="role"]').selectOption('FRONT_DESK');
  await page.getByRole('checkbox', { name: 'Đà Lạt' }).check();
  await page.getByTestId('form-submit').click();

  const shown = await page.getByTestId('handover-password').innerText();
  expect(shown).toHaveLength(16);
  expect(spy.creates).toHaveLength(1);
  expect(spy.creates[0]?.body).toMatchObject({
    username: 'moi.nv',
    phone: '+84912345678',
    role: 'FRONT_DESK',
    propertyScope: ['p1'],
    temporaryPassword: shown,
  });
  await page.getByTestId('handover-copy').click();
  await expect(page.getByText('Đã sao chép')).toBeVisible();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(shown);
  await expect(page.getByTestId('user-row-u-new-5')).toContainText('moi.nv');
  await page.getByTestId('handover-done').click();
  await expect(page.getByTestId('handover')).toHaveCount(0);
  await expect(page.getByText(shown)).toHaveCount(0);
});

test('AC2 — tên đăng nhập trùng: hiện mã máy chủ, không hiện mật khẩu', async ({ page }) => {
  await open(page);
  await page.getByTestId('users-create-open').click();
  await page.locator('input[name="username"]').fill('le.tan');
  await page.locator('input[name="fullName"]').fill('Trùng Tên');
  await page.getByRole('checkbox', { name: 'Đà Lạt' }).check();
  await page.getByTestId('form-submit').click();
  await expect(page.getByTestId('write-rejected')).toContainText('E_AUTH_USERNAME_TAKEN');
  await expect(page.getByTestId('handover')).toHaveCount(0);
});

test('AC2 — biểu mẫu sai báo lỗi theo trường và không gửi', async ({ page }) => {
  const spy = await open(page);
  await page.getByTestId('users-create-open').click();
  await page.locator('input[name="username"]').fill('ab');
  await page.getByTestId('form-submit').click();
  const issues = page.getByTestId('form-issues');
  await expect(issues).toContainText('Tên đăng nhập');
  await expect(issues).toContainText('Họ tên');
  expect(spy.creates).toHaveLength(0);
});

test('AC2 — mất phản hồi tạo: chưa xác định, thử lại dùng cùng khoá và cùng mật khẩu', async ({ page }) => {
  const spy = await open(page, { dropFirstCreate: true });
  await page.getByTestId('users-create-open').click();
  await page.locator('input[name="username"]').fill('moi.nv');
  await page.locator('input[name="fullName"]').fill('Nhân viên Mới');
  await page.getByRole('checkbox', { name: 'Đà Lạt' }).check();
  await page.getByTestId('form-submit').click();
  await expect(page.getByTestId('write-unknownOutcome')).toContainText('Chưa xác định kết quả');
  await page.getByTestId('form-submit').click();
  await expect(page.getByTestId('handover')).toBeVisible();
  expect(spy.creates).toHaveLength(2);
  expect(spy.creates[1]?.key).toBe(spy.creates[0]?.key);
  expect(spy.creates[1]?.body.temporaryPassword).toBe(spy.creates[0]?.body.temporaryPassword);
});

test('AC3 — sửa quyền gửi If-Match; 412 báo xung đột, tải lại bản mới rồi lưu được', async ({ page }) => {
  const spy = await open(page, { staleFirstSave: true });
  await page.getByTestId('edit-u1').click();
  await page.locator('[data-testid="access-form"] select[name="role"]').selectOption('MANAGER');
  await page.getByTestId('form-submit').click();
  await expect(page.getByTestId('write-conflict')).toContainText('Dữ liệu đã thay đổi');
  expect(spy.accessPuts[0]?.ifMatch).toBe('"4"');
  // Bản mới (phiên bản 9, vai trò RESERVATION_AGENT) đã được tải lại vào dòng và biểu mẫu.
  await expect(page.getByTestId('user-row-u1')).toContainText('RESERVATION_AGENT');
  await expect(page.locator('[data-testid="access-form"] select[name="role"]')).toHaveValue('RESERVATION_AGENT');
  await page.locator('[data-testid="access-form"] select[name="role"]').selectOption('MANAGER');
  await page.getByTestId('form-submit').click();
  await expect(page.getByTestId('users-notice')).toContainText('Máy chủ đã lưu quyền');
  expect(spy.accessPuts[1]?.ifMatch).toBe('"9"');
  expect(spy.accessPuts[1]?.body).toMatchObject({ role: 'MANAGER', propertyScope: ['p1'], isActive: true });
  await expect(page.getByTestId('user-row-u1')).toContainText('MANAGER');
});

test('AC3 — vô hiệu hoá tài khoản và đổi phạm vi gửi đúng thân lệnh', async ({ page }) => {
  const spy = await open(page);
  await page.getByTestId('edit-u1').click();
  await page.getByRole('checkbox', { name: 'Nha Trang' }).check();
  await page.getByRole('checkbox', { name: 'Tài khoản đang hoạt động' }).uncheck();
  await page.getByTestId('form-submit').click();
  await expect(page.getByTestId('user-row-u1')).toContainText('Đã vô hiệu');
  expect(spy.accessPuts[0]?.body).toEqual({ role: 'FRONT_DESK', propertyScope: ['p1', 'p2'], isActive: false });
});

test('AC4 — SYSADMIN không thấy OWNER/SYSADMIN, không sửa được chính mình; 403 máy chủ hiện nguyên văn', async ({ page }) => {
  const spy = await open(page, { actorRole: 'SYSADMIN', forbidAccessFor: ['u-owner'] });
  await expect(page.getByTestId('edit-u-me')).toHaveCount(0);
  await expect(page.getByTestId('user-row-u-me')).toContainText('Tài khoản của bạn');
  await page.getByTestId('users-create-open').click();
  const options = await page.locator('[data-testid="create-form"] select[name="role"] option').allInnerTexts();
  expect(options.some((text) => text.includes('OWNER'))).toBe(false);
  expect(options.some((text) => text.includes('SYSADMIN'))).toBe(false);
  expect(options.some((text) => text.includes('MANAGER'))).toBe(true);
  await page.getByTestId('form-cancel').click();

  await page.getByTestId('edit-u-owner').click();
  await page.getByRole('checkbox', { name: 'Tài khoản đang hoạt động' }).uncheck();
  await page.getByTestId('form-submit').click();
  const rejected = page.getByTestId('write-rejected');
  await expect(rejected).toContainText('E_RBAC_FORBIDDEN');
  await expect(rejected).toContainText('SYSADMIN không được đổi quyền tài khoản OWNER.');
  expect(spy.accessPuts).toHaveLength(1);
  await expect(page.getByTestId('users-screen')).toBeVisible();
});

test('AC4 — không đọc được danh sách cơ sở thì nhập mã cơ sở thủ công', async ({ page }) => {
  const spy = await open(page, { actorRole: 'SYSADMIN', propertiesStatus: 403 });
  await page.getByTestId('users-create-open').click();
  await page.locator('input[name="username"]').fill('moi.nv');
  await page.locator('input[name="fullName"]').fill('Nhân viên Mới');
  await page.locator('input[name="propertyScope"]').fill('p1, p2');
  await page.getByTestId('form-submit').click();
  await expect(page.getByTestId('handover')).toBeVisible();
  expect(spy.creates[0]?.body.propertyScope).toEqual(['p1', 'p2']);
});

test('AC5 — xoá PIN có hộp xác nhận; huỷ thì không gọi máy chủ', async ({ page }) => {
  const spy = await open(page);
  await page.getByTestId('clear-pin-u1').click();
  await expect(page.getByTestId('pin-confirm')).toContainText('Xoá PIN của Lê Tân?');
  await page.getByTestId('pin-confirm-cancel').click();
  expect(spy.pinDeletes).toEqual([]);
  await page.getByTestId('clear-pin-u1').click();
  await page.getByTestId('pin-confirm-submit').click();
  await expect(page.getByTestId('users-notice')).toContainText('Máy chủ đã xoá PIN');
  await expect(page.getByTestId('user-row-u1')).toContainText('Chưa có PIN');
  expect(spy.pinDeletes).toEqual(['u1']);
});

test('AC5 — MANAGER chỉ thấy nút xoá PIN, không tạo/sửa quyền', async ({ page }) => {
  await open(page, { actorRole: 'MANAGER' });
  await expect(page.getByTestId('user-row-u1')).toBeVisible();
  await expect(page.getByTestId('users-create-open')).toHaveCount(0);
  await expect(page.getByTestId('edit-u1')).toHaveCount(0);
  await expect(page.getByTestId('clear-pin-u1')).toBeVisible();
});

test('AC6 — vai trò không được xem: máy chủ 403 → trang thiếu quyền, không có danh sách rỗng', async ({ page }) => {
  await open(page, { actorRole: 'FRONT_DESK', listStatus: 403 });
  await expect(page.getByText('Bạn không có quyền xem nội dung này')).toBeVisible();
  await expect(page.getByTestId('users-table')).toHaveCount(0);
  await expectAxeClean(page);
});

test('trạng thái rỗng khi không có người dùng khớp', async ({ page }) => {
  await open(page, { empty: true });
  await expect(page.getByText('Chưa có dữ liệu')).toBeVisible();
  await expect(page.getByTestId('users-table')).toHaveCount(0);
});

test('lỗi đọc 500 hiện băng lỗi có mã, không phải danh sách rỗng', async ({ page }) => {
  await open(page, { listStatus: 500 });
  await expect(page.getByTestId('screen-alert')).toBeVisible();
  await expect(page.getByTestId('users-table')).toHaveCount(0);
});

const STATES = [
  'ready',
  'loading',
  'refreshing',
  'empty',
  'validation-error',
  'forbidden',
  'conflict',
  'expired',
  'unknown-outcome',
  'success',
] as const;

for (const state of STATES) {
  test(`trạng thái ${state}: axe sạch`, async ({ page }) => {
    await page.goto(`/admin/users?state=${state}`);
    await expect(page.getByTestId('users-screen')).toBeVisible();
    await expectAxeClean(page);
  });
}

test('AC7 — 360px không cuộn ngang trang, axe sạch với bảng và biểu mẫu', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 800 });
  await open(page);
  await expect(page.getByTestId('user-row-u1')).toBeVisible();
  const fits = () => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
  expect(await fits()).toBe(true);
  await expectAxeClean(page);
  await page.getByTestId('users-create-open').click();
  await expect(page.getByTestId('create-form')).toBeVisible();
  expect(await fits()).toBe(true);
  await expectAxeClean(page);
});
