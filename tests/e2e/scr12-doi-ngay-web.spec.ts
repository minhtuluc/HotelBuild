import { randomInt } from 'node:crypto';
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import type { createSessionClient } from '../../packages/web-session/src/client.js';
import { bookingInput, quoteInput } from '../../packages/web-session/test/journey-fixtures.js';

/** SCR-12 chỉ có ở web khách (ADR-018). */
function customerWebOnly(): void {
  test.beforeEach(({}, testInfo) => {
    test.skip(!testInfo.project.name.startsWith('customer-web'), 'ca này chỉ chạy trên customer-web');
  });
}

const origin = new URL(process.env.E2E_API_BASE_URL ?? 'http://127.0.0.1:4000/api/v1').origin;

customerWebOnly();

const STAY = { checkIn: '2026-10-12', checkOut: '2026-10-15' };

/** Đặt phòng cần phiên khách: nạp session client của BFF rồi đăng nhập bằng SĐT tổng hợp. */
async function loginGuest(page: Page): Promise<void> {
  await page.goto('/');
  await page.evaluate(async (url) => {
    const module: { createSessionClient: typeof createSessionClient } = await import(url);
    window.sessionClient = module.createSessionClient({ kind: 'guest' });
  }, `${origin}/__test/session-client.js`);
  await page.evaluate(
    (phone) => window.sessionClient?.login({ phone, password: 'Synthetic-password' }),
    `+84${String(randomInt(1000000000)).padStart(9, '0')}`,
  );
}

/** Booking thật trên API giả (HB-116): 1 đêm × 1 phòng × 1.000.000 ₫, gói SAVER3. */
async function createBooking(page: Page): Promise<string> {
  await loginGuest(page);
  return await page.evaluate(
    async ({ url, baseUrl, quoteInput, bookingInput }) => {
      const module: typeof import('../../packages/api-client/src/index.js') = await import(url);
      const client = new module.ApiClient({
        baseUrl,
        getAccessToken: () => window.sessionClient!.getAccessToken(),
        onUnauthorized: (token) => window.sessionClient!.onUnauthorized(token),
        maxAttempts: 1,
      });
      const quote = (await module.createQuoteApi(client).quote({ ...quoteInput, ratePlanCode: 'SAVER3' }))
        .data;
      const booking = (
        await module.createBookingApi(client).create({
          ...bookingInput,
          ratePlanCode: 'SAVER3',
          quoteId: quote.quoteId,
        })
      ).data;
      return booking.id;
    },
    { url: `${origin}/__test/f5-client.js`, baseUrl: `${origin}/api/v1`, quoteInput, bookingInput },
  );
}

/**
 * Phiên khách dựng lại trong document hiện tại: điều hướng giữa các trang làm mất biến trên `window`,
 * còn cookie phiên của BFF vẫn nguyên nên session client mới lấy được access token.
 */
async function guestToken(page: Page): Promise<string | null> {
  return await page.evaluate(
    async (sessionUrl) => {
      const sessionModule = await import(sessionUrl);
      const session = sessionModule.createSessionClient({ kind: 'guest' });
      return await session.getAccessToken();
    },
    `${origin}/__test/session-client.js`,
  );
}

/** Đọc lại booking từ máy chủ (kiểm trạng thái/kỳ lưu trú sau thao tác). */
async function readBooking(
  page: Page,
  bookingId: string,
): Promise<{ status: string; checkIn: string; checkOut: string; rescheduleCount: number }> {
  return await page.evaluate(
    async ({ url, baseUrl, sessionUrl, bookingId }) => {
      const module: typeof import('../../packages/api-client/src/index.js') = await import(url);
      const sessionModule = await import(sessionUrl);
      const session = sessionModule.createSessionClient({ kind: 'guest' });
      const client = new module.ApiClient({
        baseUrl,
        getAccessToken: () => session.getAccessToken(),
        onUnauthorized: (token) => session.onUnauthorized(token),
        maxAttempts: 1,
      });
      const booking = (await module.createBookingApi(client).get(bookingId)).data;
      return {
        status: booking.status,
        checkIn: booking.checkIn,
        checkOut: booking.checkOut,
        rescheduleCount: booking.rescheduleCount,
      };
    },
    {
      url: `${origin}/__test/f5-client.js`,
      baseUrl: `${origin}/api/v1`,
      sessionUrl: `${origin}/__test/session-client.js`,
      bookingId,
    },
  );
}

/** Kích hoạt tình huống giả: tranh chấp phòng khi đổi ngày. */
async function rescheduleConflict(page: Page, bookingId: string): Promise<void> {
  const token = await guestToken(page);
  const status = await page.evaluate(
    async ({ url, token, bookingId }) => {
      const response = await fetch(`${url}/__control/f5/bookings/${bookingId}`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          ...(token === null ? {} : { authorization: `Bearer ${token}` }),
        },
        body: JSON.stringify({ event: 'reschedule-conflict' }),
      });
      return response.status;
    },
    { url: origin, token, bookingId },
  );
  expect(status).toBe(200);
}

async function openReschedule(page: Page): Promise<string> {
  const bookingId = await createBooking(page);
  await page.goto(`/bookings/${bookingId}/reschedule`);
  await expect(page.getByTestId('reschedule-screen')).toBeVisible();
  return bookingId;
}

test.describe('SCR-12 đổi ngày trên API giả (HB-104)', () => {
  test('xem chênh lệch rồi mới xác nhận; trạng thái booking không đổi sau khi đổi ngày (AC1)', async ({
    page,
  }) => {
    const bookingId = await openReschedule(page);
    await expect(page.getByTestId('reschedule-current')).toContainText('10/10/2026 → 11/10/2026');
    // Chưa xem chênh lệch thì chưa được xác nhận (AC1).
    await expect(page.getByTestId('reschedule-confirm')).toBeDisabled();

    await page.getByLabel('Ngày nhận phòng mới').fill(STAY.checkIn);
    await page.getByLabel('Ngày trả phòng mới').fill(STAY.checkOut);
    await page.getByTestId('reschedule-check').click();

    const diff = page.getByTestId('reschedule-diff');
    await expect(diff).toBeVisible();
    await expect(page.getByTestId('reschedule-new-stay')).toContainText(
      '12/10/2026 → 15/10/2026 · 3 đêm',
    );
    await expect(page.getByTestId('reschedule-new-total')).toContainText('3.000.000 ₫');
    await expect(page.getByTestId('reschedule-difference')).toContainText('tăng thêm 2.000.000 ₫');
    await expect(page.getByTestId('reschedule-fee')).toContainText('hợp đồng chưa có trường này');

    await expect(page.getByTestId('reschedule-confirm')).toBeEnabled();
    await page.getByTestId('reschedule-confirm').click();
    await expect(page.getByTestId('reschedule-result')).toBeVisible();
    await expect(page.getByTestId('reschedule-result-status')).toContainText('Trạng thái giữ nguyên');
    await expect(page.getByTestId('reschedule-result-status')).toContainText('HELD');
    await expect(page.getByTestId('reschedule-result-stay')).toContainText(
      '12/10/2026 → 15/10/2026',
    );
    await expect(page.getByTestId('reschedule-result-count')).toContainText('1');

    // Máy chủ xác nhận: kỳ mới, trạng thái giữ nguyên, số lần đổi = 1 (BR-BOOK-12).
    expect(await readBooking(page, bookingId)).toEqual({
      status: 'HELD',
      checkIn: STAY.checkIn,
      checkOut: STAY.checkOut,
      rescheduleCount: 1,
    });
  });

  test('tranh chấp phòng khi đổi ngày: buộc lấy lại chênh lệch, booking không đổi (AC1)', async ({
    page,
  }) => {
    const bookingId = await openReschedule(page);
    await rescheduleConflict(page, bookingId);
    await page.getByLabel('Ngày nhận phòng mới').fill(STAY.checkIn);
    await page.getByLabel('Ngày trả phòng mới').fill(STAY.checkOut);
    await page.getByTestId('reschedule-check').click();
    await expect(page.getByTestId('reschedule-diff')).toBeVisible();

    await page.getByTestId('reschedule-confirm').click();
    await expect(page.getByTestId('reschedule-alert')).toContainText('Tải lại và chọn lại');
    await expect(page.getByTestId('reschedule-diff')).toHaveCount(0);
    await expect(page.getByTestId('reschedule-confirm')).toBeDisabled();
    await expect(page.getByTestId('reschedule-result')).toHaveCount(0);
    expect(await readBooking(page, bookingId)).toEqual({
      status: 'HELD',
      checkIn: '2026-10-10',
      checkOut: '2026-10-11',
      rescheduleCount: 0,
    });
  });

  test('kỳ mới sai thứ tự thì chặn tại chỗ, không gọi báo giá (AC1)', async ({ page }) => {
    let quotes = 0;
    await openReschedule(page);
    await page.route('**/api/session/journey/quotes', (route) => {
      quotes += 1;
      return route.continue();
    });
    await page.getByLabel('Ngày nhận phòng mới').fill('2026-10-15');
    await page.getByLabel('Ngày trả phòng mới').fill('2026-10-12');
    await expect(page.getByTestId('reschedule-issue')).toContainText('Ngày trả phải sau ngày nhận');
    await expect(page.getByTestId('reschedule-check')).toBeDisabled();
    await expect(page.getByTestId('reschedule-confirm')).toBeDisabled();
    expect(quotes).toBe(0);
  });

  test('kỳ mới trùng kỳ đang giữ thì nói rõ và không cho xem chênh lệch (AC1)', async ({ page }) => {
    await openReschedule(page);
    await expect(page.getByTestId('reschedule-same')).toContainText('trùng kỳ đang giữ');
    await expect(page.getByTestId('reschedule-check')).toBeDisabled();
    await expect(page.getByTestId('reschedule-confirm')).toBeDisabled();
  });

  test('không có vi phạm axe serious/critical và không cuộn ngang 360 px (AC2)', async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 800 });
    await openReschedule(page);
    await page.getByLabel('Ngày nhận phòng mới').fill(STAY.checkIn);
    await page.getByLabel('Ngày trả phòng mới').fill(STAY.checkOut);
    await page.getByTestId('reschedule-check').click();
    await expect(page.getByTestId('reschedule-diff')).toBeVisible();
    const results = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
      .analyze();
    expect(
      results.violations
        .filter((violation) => violation.impact === 'serious' || violation.impact === 'critical')
        .map((violation) => violation.id),
    ).toEqual([]);
    const overflow = await page.evaluate(() => {
      const element = document.scrollingElement;
      return element === null ? 0 : element.scrollWidth - element.clientWidth;
    });
    expect(overflow).toBeLessThanOrEqual(1);
  });
});
