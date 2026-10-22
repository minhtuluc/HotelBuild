import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { installFrontDeskApi } from './fake-api/f7/front-desk';
import { operationsWebOnly } from './operations-web/guard';
import { loginCollectionStaff } from './operations-web/collect-fixture';

/**
 * SCR-48 (HB-152) — bàn tiền sảnh trên API giả F7.
 *
 * Trọng tâm: check-in do **máy chủ** quyết (AC1), no-show/check-out nêu hệ quả chính sách trước xác nhận
 * (AC2), walk-in ≤ 5 bước qua `POST /walk-in` rồi `POST /payments` (AC3), axe sạch ở mọi trạng thái §8.1.
 */
operationsWebOnly();

const BUSINESS_DATE = '2026-12-24';

async function verifyPin(page: Page): Promise<void> {
  await expect(page.getByTestId('pin-dialog')).toBeVisible();
  await page.locator('input[name="pin"]').fill('123456');
  await page.getByTestId('pin-submit').click();
  await expect(page.getByTestId('pin-verified')).toBeVisible();
}

test('AC1 — check-in bị máy chủ từ chối thì hiện mã + lý do, không tự tính nợ', async ({ page }) => {
  await loginCollectionStaff(page);
  const spy = await installFrontDeskApi(page, { businessDate: BUSINESS_DATE, checkIn: 'blocked' });
  await page.goto(`/front-desk?date=${BUSINESS_DATE}`);
  const row = page.getByTestId('desk-arrivals-booking-b1');
  await expect(row).toContainText('PH-261224-AAAAA');
  await expect(row).toContainText('1.400.000 ₫');
  await expect(row.getByRole('link', { name: 'Thu tiền (SCR-37)' })).toHaveAttribute(
    'href',
    '/bookings/b1/collect',
  );
  await row.getByRole('button', { name: 'Nhận phòng' }).click();
  await page.getByRole('checkbox', { name: '201' }).check();
  await page.getByRole('button', { name: 'Xác nhận nhận phòng' }).click();
  const rejected = page.getByTestId('action-rejected');
  await expect(rejected).toContainText('E_FO_CHECKIN_NOT_ALLOWED');
  await expect(rejected).toContainText('Công nợ vượt ngưỡng hoặc phòng chưa sẵn sàng');
  expect(spy.checkIns).toHaveLength(1);
  expect(spy.checkIns[0]).toContain('"actualRoomIds":["r1"]');
  // Vẫn còn trong danh sách đến để lễ tân xử lý tiếp.
  await expect(row).toBeVisible();
});

test('AC1 — check-in thành công hiện phụ thu máy chủ trả và phòng đã gán', async ({ page }) => {
  await loginCollectionStaff(page);
  const spy = await installFrontDeskApi(page, { businessDate: BUSINESS_DATE });
  await page.goto(`/front-desk?date=${BUSINESS_DATE}`);
  const row = page.getByTestId('desk-arrivals-booking-b1');
  await row.getByRole('button', { name: 'Nhận phòng' }).click();
  await page.getByRole('checkbox', { name: '201' }).check();
  await page.getByRole('checkbox', { name: 'Nhận phòng sớm' }).check();
  await expect(page.getByText('Phụ thu nhận sớm (nếu có) do máy chủ tính')).toBeVisible();
  await page.getByRole('button', { name: 'Xác nhận nhận phòng' }).click();
  const done = page.getByTestId('check-in-done');
  await expect(done).toContainText('Phòng đã gán: r1');
  await expect(done).toContainText('300.000 ₫');
  expect(spy.checkIns[0]).toContain('"earlyCheckIn":true');
});

test('AC2 — check-out đòi PIN và chỉ hiện phụ thu sau khi máy chủ xác nhận', async ({ page }) => {
  await loginCollectionStaff(page);
  const spy = await installFrontDeskApi(page, { businessDate: BUSINESS_DATE, checkOutFee: 150_000 });
  await page.goto(`/front-desk?date=${BUSINESS_DATE}`);
  const row = page.getByTestId('desk-departures-booking-b3');
  await row.getByRole('button', { name: 'Trả phòng' }).click();
  await expect(page.getByTestId('checkout-policy')).toContainText(
    'Phụ thu trả muộn/trả sớm do máy chủ tính',
  );
  const confirm = page.getByRole('button', { name: 'Xác nhận trả phòng' });
  await expect(confirm).toBeDisabled();
  await verifyPin(page);
  await expect(confirm).toBeEnabled();
  await page.getByRole('checkbox', { name: 'Khách trả phòng sớm' }).check();
  await confirm.click();
  const done = page.getByTestId('check-out-done');
  await expect(done).toContainText('150.000 ₫');
  await expect(done).toContainText('Việc dọn phòng sinh ra: 1');
  expect(spy.checkOuts).toHaveLength(1);
  expect(spy.checkOuts[0]).toContain('"earlyCheckOut":true');
  expect(spy.checkOuts[0]).toContain('"pinToken":"synthetic-pin-token-1234567890"');
});

test('AC2 — no-show nêu hệ quả bậc cuối + đêm đầu trước xác nhận, tiền lấy từ máy chủ', async ({
  page,
}) => {
  await loginCollectionStaff(page);
  const spy = await installFrontDeskApi(page, { businessDate: BUSINESS_DATE, noShowPenalty: 1_000_000 });
  await page.goto(`/front-desk?date=${BUSINESS_DATE}`);
  await page
    .getByTestId('desk-arrivals-booking-b1')
    .getByRole('button', { name: 'Ghi no-show' })
    .click();
  const policy = page.getByTestId('no-show-policy');
  await expect(policy).toContainText('bậc cuối');
  await expect(policy).toContainText('đêm đầu');
  await expect(page.getByRole('button', { name: 'Xác nhận no-show' })).toBeDisabled();
  await page.locator('input[name="reason"]').fill('Khách không đến trước 23:59');
  await page.getByRole('button', { name: 'Xác nhận no-show' }).click();
  const done = page.getByTestId('no-show-done');
  await expect(done).toContainText('1.000.000 ₫');
  expect(spy.noShows).toHaveLength(1);
  expect(spy.noShows[0]).toContain('Khách không đến trước 23:59');
});

test('AC3 — walk-in 5 bước: POST /walk-in một lệnh rồi POST /payments cho cọc', async ({ page }) => {
  await loginCollectionStaff(page);
  const spy = await installFrontDeskApi(page, { businessDate: BUSINESS_DATE });
  await page.goto(`/front-desk?date=${BUSINESS_DATE}`);
  await page.getByTestId('walk-in-open').click();
  await expect(page.getByTestId('walk-in-step-label')).toContainText('Bước 1/5');
  await page.selectOption('select[name="roomTypeId"]', 'rt1');
  await page.getByRole('button', { name: 'Tiếp tục' }).click();
  await expect(page.getByTestId('walk-in-step-label')).toContainText('Bước 2/5');
  await page.fill('input[name="fullName"]', 'Nguyễn Văn An');
  await page.fill('input[name="phone"]', '0912345678');
  await page.getByRole('button', { name: 'Tiếp tục' }).click();
  await expect(page.getByTestId('walk-in-step-label')).toContainText('Bước 3/5');
  await expect(page.getByTestId('walk-in-review')).toContainText('2026-12-24');
  await page.getByRole('button', { name: 'Tạo booking' }).click();
  await expect(page.getByTestId('walk-in-step-label')).toContainText('Bước 4/5');
  await expect(page.getByTestId('walk-in-deposit')).toContainText('300.000 ₫');
  await verifyPin(page);
  await page.getByRole('button', { name: 'Ghi nhận thu cọc' }).click();
  await expect(page.getByTestId('walk-in-done')).toContainText('pay-walkin-1');
  await expect(page.getByTestId('walk-in-step-label')).toContainText('Bước 5/5');
  expect(spy.walkIns).toHaveLength(1);
  expect(spy.walkIns[0]).toContain('"roomTypeId":"rt1"');
  expect(spy.walkIns[0]).toContain('"fullName":"Nguyễn Văn An"');
  expect(spy.walkIns[0]).not.toContain('channelCode');
  expect(spy.payments).toHaveLength(1);
  expect(spy.payments[0]).toContain('"amount":300000');
  expect(spy.payments[0]).toContain('"type":"DEPOSIT"');
  expect(spy.payments[0]).toContain('"pinToken":"synthetic-pin-token-1234567890"');
});

test('trạng thái empty: không giả thành công khi chưa có khách', async ({ page }) => {
  await loginCollectionStaff(page);
  await installFrontDeskApi(page, { businessDate: BUSINESS_DATE, empty: true });
  await page.goto(`/front-desk?date=${BUSINESS_DATE}`);
  await expect(page.getByText('Chưa có dữ liệu')).toBeVisible();
  await expect(page.getByTestId('desk-arrivals')).toHaveCount(0);
});

test('lỗi mạng khi tải lại giữ dữ liệu cũ và hiện băng lỗi', async ({ page }) => {
  await loginCollectionStaff(page);
  await installFrontDeskApi(page, { businessDate: BUSINESS_DATE });
  await page.goto(`/front-desk?date=${BUSINESS_DATE}`);
  await expect(page.getByTestId('desk-arrivals-booking-b1')).toBeVisible();
  await page.route('**/api/v1/bookings*', (route) => route.abort('failed'));
  await page.getByRole('button', { name: 'Tải lại' }).click();
  await expect(page.getByTestId('screen-alert')).toBeVisible();
  await expect(page.getByTestId('desk-arrivals-booking-b1')).toBeVisible();
});

test('403 thì che dữ liệu và báo thiếu quyền', async ({ page }) => {
  await loginCollectionStaff(page);
  await installFrontDeskApi(page, { businessDate: BUSINESS_DATE, propertiesStatus: 403 });
  await page.goto(`/front-desk?date=${BUSINESS_DATE}`);
  await expect(page.getByText('Bạn không có quyền xem nội dung này')).toBeVisible();
  await expect(page.getByTestId('desk-arrivals-booking-b1')).toHaveCount(0);
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

const EXPECTED = {
  ready: 'Chế độ minh hoạ trạng thái',
  loading: 'Đang tải…',
  refreshing: 'Cập nhật lúc',
  empty: 'Chưa có dữ liệu',
  'validation-error': 'Vui lòng sửa 1 trường được đánh dấu',
  forbidden: 'Bạn không có quyền xem nội dung này',
  conflict: 'Dữ liệu đã thay đổi',
  expired: 'Nội dung đã hết hạn lúc',
  'unknown-outcome': 'Chưa xác định kết quả',
  success: 'Máy chủ đã xác nhận',
} as const;

for (const state of STATES) {
  test(`trạng thái ${state}: nội dung đúng hợp đồng và axe sạch`, async ({ page }) => {
    await loginCollectionStaff(page); // khu vực nhân viên đã yêu cầu đăng nhập (HB-020)
    await page.goto(`/front-desk?state=${state}`);
    await expect(page.getByText(EXPECTED[state], { exact: false })).toBeVisible();
    const results = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
      .analyze();
    const blocking = results.violations.filter(
      (violation) => violation.impact === 'serious' || violation.impact === 'critical',
    );
    expect(blocking.map((violation) => violation.id)).toEqual([]);
  });
}

test('360px không cuộn ngang và axe sạch khi có bảng', async ({ page }) => {
  await loginCollectionStaff(page);
  await installFrontDeskApi(page, { businessDate: BUSINESS_DATE });
  await page.setViewportSize({ width: 360, height: 800 });
  await page.goto(`/front-desk?date=${BUSINESS_DATE}`);
  await expect(page.getByTestId('desk-arrivals-booking-b1')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze();
  const blocking = results.violations.filter(
    (violation) => violation.impact === 'serious' || violation.impact === 'critical',
  );
  expect(blocking.map((violation) => violation.id)).toEqual([]);
  await page.screenshot({ path: '/tmp/hb152-front-desk-360.png', fullPage: true });
});
