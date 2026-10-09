import { randomInt } from 'node:crypto';
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import type { createSessionClient } from '../../packages/web-session/src/client.js';

/** SCR-04/SCR-05 chỉ có ở web khách (ADR-018). */
function customerWebOnly(): void {
  test.beforeEach(({}, testInfo) => {
    test.skip(!testInfo.project.name.startsWith('customer-web'), 'ca này chỉ chạy trên customer-web');
  });
}

const BOOKINGS = '**/api/session/journey/bookings*';
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

async function openBook(page: Page, stay = STAY): Promise<void> {
  await loginGuest(page);
  await page.goto(`/book?${stay}`);
  await expect(page.getByTestId('book-screen')).toBeVisible();
}

async function fillGuest(page: Page): Promise<void> {
  await page.getByLabel('Họ tên khách').fill('Nguyễn Văn An');
  await page.getByLabel('Số điện thoại').fill('0912345678');
}

test.describe('SCR-04/05 chọn gói & xác nhận trên API giả (HB-082)', () => {
  test('hiện bước 4/4, điều khoản gói và báo giá trước khi xác nhận (AC1)', async ({ page }) => {
    await openBook(page);
    await expect(page.getByTestId('book-step')).toContainText('Bước 4/4');
    const terms = page.getByTestId('plan-terms');
    await expect(terms).toContainText('Đặt cọc 30%');
    await expect(terms).toContainText('chưa công bố mốc huỷ miễn phí');
    await expect(page.getByTestId('quote-summary')).toContainText('2.000.000 ₫');
    await expect(page.getByTestId('guest-form')).toBeVisible();
  });

  test('thiếu họ tên/SĐT thì chặn gửi, không gọi API (AC1)', async ({ page }) => {
    let bookings = 0;
    await page.route(BOOKINGS, (route) => {
      bookings += 1;
      return route.continue();
    });
    await openBook(page);
    await page.getByRole('button', { name: 'Xác nhận đặt phòng' }).click();
    await expect(page.getByText('guest.fullName: REQUIRED')).toBeVisible();
    await expect(page.getByText('guest.phone: NOT_PHONE')).toBeVisible();
    expect(bookings).toBe(0);
  });

  test('xác nhận hợp lệ thì chuyển sang màn kết quả đặt (AC1)', async ({ page }) => {
    const spy: string[] = [];
    await page.route(BOOKINGS, async (route) => {
      spy.push(route.request().postData() ?? '');
      return route.continue();
    });
    await openBook(page);
    await fillGuest(page);
    await page.getByRole('button', { name: 'Xác nhận đặt phòng' }).click();
    await expect(page).toHaveURL(/\/booking\/[^/]+$/);
    expect(spy).toHaveLength(1);
    const body = spy[0] ?? '';
    expect(body).toContain('"fullName":"Nguyễn Văn An"');
    expect(body).toContain('"quoteId"');
    expect(body).toContain('"channelCode":"WEB"');
  });

  test('máy chủ nghi trùng booking thì hỏi khách và mở được booking cũ (AC2)', async ({ page }) => {
    await openBook(
      page,
      STAY.replace('propertyId=synthetic-property', 'propertyId=journey-duplicate'),
    );
    await fillGuest(page);
    await page.getByRole('button', { name: 'Xác nhận đặt phòng' }).click();
    const prompt = page.getByTestId('duplicate-prompt');
    await expect(prompt).toBeVisible();
    await expect(prompt).toContainText('SYN079');
    await expect(prompt.getByRole('link', { name: 'Mở booking cũ' })).toHaveAttribute(
      'href',
      /^\/booking\/[^/]+$/,
    );
    // Chưa rời trang: khách còn phải chọn.
    expect(new URL(page.url()).pathname).toBe('/book');
  });

  test('không có vi phạm axe serious/critical và không cuộn ngang 360 px (AC3)', async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 800 });
    await openBook(page);
    const results = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
      .analyze();
    const blocking = results.violations.filter(
      (violation) => violation.impact === 'serious' || violation.impact === 'critical',
    );
    expect(blocking).toEqual([]);
    const overflow = await page.evaluate(() => {
      const element = document.scrollingElement;
      return element === null ? 0 : element.scrollWidth - element.clientWidth;
    });
    expect(overflow).toBeLessThanOrEqual(1);
  });
});
