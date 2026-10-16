import { randomInt } from 'node:crypto';
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import type { createSessionClient } from '../../packages/web-session/src/client.js';

/** SCR-07 chỉ có ở web khách (ADR-018). */
function customerWebOnly(): void {
  test.beforeEach(({}, testInfo) => {
    test.skip(!testInfo.project.name.startsWith('customer-web'), 'ca này chỉ chạy trên customer-web');
  });
}

const STAY =
  'propertyId=synthetic-property&roomTypeId=synthetic-room&ratePlanCode=FLEX7&checkIn=2026-12-24&checkOut=2026-12-26&adults=2&children=0&roomCount=1';
const origin = new URL(process.env.E2E_API_BASE_URL ?? 'http://127.0.0.1:4000/api/v1').origin;

customerWebOnly();

/** Đặt phòng cần phiên khách: nạp session client của BFF rồi đăng nhập bằng SĐT tổng hợp. */
async function loginGuest(page: Page): Promise<void> {
  await page.goto('/');
  await page.evaluate(async (url) => {
    // Dynamic import là bắt buộc: mô-đun do máy chủ API giả phục vụ tại URL chạy thật của bài kiểm.
    const module: { createSessionClient: typeof createSessionClient } = await import(url);
    window.sessionClient = module.createSessionClient({ kind: 'guest' });
  }, `${origin}/__test/session-client.js`);
  await page.evaluate(
    (phone) => window.sessionClient?.login({ phone, password: 'Synthetic-password' }),
    `+84${String(randomInt(1000000000)).padStart(9, '0')}`,
  );
}

/** Đi trọn luồng SCR-04/05 để có booking thật trên API giả rồi dừng ở SCR-07. */
async function openBookingResult(page: Page): Promise<string> {
  await loginGuest(page);
  await page.goto(`/book?${STAY}`);
  await page.getByLabel('Họ tên khách').fill('Nguyễn Văn An');
  await page.getByLabel('Số điện thoại').fill('0912345678');
  await page.getByRole('button', { name: 'Xác nhận đặt phòng' }).click();
  await expect(page).toHaveURL(/\/booking\/[^/]+$/);
  return new URL(page.url()).pathname.split('/').at(-1) ?? '';
}

test.describe('SCR-07 kết quả đặt & đếm ngược giữ chỗ trên API giả (HB-083)', () => {
  test('đọc trạng thái từ API và hiện mã, thời gian giữ chỗ, tiền, nội dung xác nhận (AC2)', async ({
    page,
  }) => {
    let reads = 0;
    await page.route('**/api/session/journey/bookings/*', (route) => {
      reads += 1;
      return route.continue();
    });
    const bookingId = await openBookingResult(page);

    await expect(page.getByTestId('booking-result')).toBeVisible();
    await expect(page.getByTestId('booking-code')).toContainText(/SYN\d+/);
    // Trạng thái là của máy chủ (booking vừa tạo đang HELD), không phải suy từ chuyển hướng.
    await expect(page.getByTestId('booking-status')).toContainText('HELD');
    await expect(page.getByTestId('booking-countdown')).toContainText(/^\d{2}:\d{2}$/);
    await expect(page.getByTestId('booking-hold-expires')).toContainText('(giờ VN)');
    await expect(page.getByTestId('booking-stay')).toContainText('24/12/2026 → 26/12/2026');
    await expect(page.getByTestId('booking-stay')).not.toContainText(/\d{4}-\d{2}-\d{2}/);
    await expect(page.getByTestId('booking-money')).toContainText('2.000.000 ₫');
    await expect(page.getByTestId('booking-confirmation')).toContainText('Nội dung xác nhận');
    await expect(page.getByTestId('booking-confirmation')).toContainText('24/12/2026 → 26/12/2026');
    await expect(page.getByTestId('booking-confirmation')).not.toContainText(/\d{4}-\d{2}-\d{2}/);
    await expect(page.getByTestId('booking-continue')).toBeEnabled();
    expect(reads).toBeGreaterThanOrEqual(1);
    expect(bookingId).not.toBe('');
  });

  test('truy vấn trên URL không đổi được trạng thái; id không có thì báo không tìm thấy (AC2)', async ({
    page,
  }) => {
    const bookingId = await openBookingResult(page);
    await page.goto(`/booking/${bookingId}?status=CONFIRMED&paidAmount=0`);
    await expect(page.getByTestId('booking-status')).toContainText('HELD');
    await expect(page.getByTestId('booking-status')).not.toContainText('CONFIRMED');

    await page.goto('/booking/khong-co-booking-nay');
    await expect(page.getByTestId('booking-not-found')).toBeVisible();
    await expect(page.getByTestId('booking-result')).toHaveCount(0);
  });

  test('hết hạn giữ chỗ thì khoá nút tiếp tục (AC1)', async ({ page }) => {
    // Đồng hồ giả của trình duyệt chỉ mô phỏng thời gian **hiển thị**; hạn thật vẫn là mốc máy chủ trả.
    await page.clock.install();
    await openBookingResult(page);
    await expect(page.getByTestId('booking-continue')).toBeEnabled();
    await page.clock.fastForward('15:05');
    await expect(page.getByTestId('booking-hold')).toContainText('Đã hết thời gian giữ chỗ');
    await expect(page.getByTestId('booking-continue')).toBeDisabled();
    await expect(page.getByTestId('booking-locked')).toBeVisible();
  });

  test('không có vi phạm axe serious/critical và không cuộn ngang 360 px (AC3)', async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 800 });
    await openBookingResult(page);
    // Quét trên **nội dung thật** đã tải xong, không quét lúc còn màn hình chờ.
    await expect(page.getByTestId('booking-code')).toBeVisible();
    const results = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
      .analyze();
    const blocking = results.violations.filter(
      (violation) => violation.impact === 'serious' || violation.impact === 'critical',
    );
    expect(blocking.map((violation) => violation.id)).toEqual([]);
    const overflow = await page.evaluate(() => {
      const element = document.scrollingElement;
      return element === null ? 0 : element.scrollWidth - element.clientWidth;
    });
    expect(overflow).toBeLessThanOrEqual(1);
  });
});
