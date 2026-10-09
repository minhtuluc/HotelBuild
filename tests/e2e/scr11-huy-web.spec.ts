import { randomInt } from 'node:crypto';
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page, type Route } from '@playwright/test';
import type { createSessionClient } from '../../packages/web-session/src/client.js';
import type { BookingSummary } from '../../packages/contracts/src/index.js';
import { fulfillJson } from './operations-web/fake-api';
import { bookingInput, quoteInput } from '../../packages/web-session/test/journey-fixtures.js';

/** SCR-11 chỉ có ở web khách (ADR-018). */
function customerWebOnly(): void {
  test.beforeEach(({}, testInfo) => {
    test.skip(!testInfo.project.name.startsWith('customer-web'), 'ca này chỉ chạy trên customer-web');
  });
}

const origin = new URL(process.env.E2E_API_BASE_URL ?? 'http://127.0.0.1:4000/api/v1').origin;

customerWebOnly();

function bookingRow(overrides: Partial<BookingSummary> = {}): BookingSummary {
  return {
    id: 'bk-1',
    code: 'SYN079',
    seq: 1,
    status: 'HELD',
    guestId: 'guest-1',
    propertyId: 'synthetic-property',
    roomTypeId: 'synthetic-room',
    ratePlanId: 'SAVER3',
    channelId: 'web',
    checkIn: '2026-12-24',
    checkOut: '2026-12-26',
    nights: 2,
    adults: 2,
    children: 0,
    roomCount: 1,
    totalAmount: 2_000_000,
    depositPercent: 30,
    depositAmount: 600_000,
    paidAmount: 250_499,
    refundedAmount: 0,
    balanceDue: 1_749_501,
    penaltyAmount: 0,
    currency: 'VND',
    rescheduleCount: 0,
    holdExpiresAt: new Date(Date.now() + 900_000).toISOString(),
    oversold: false,
    priceLocked: false,
    duplicateSuspected: false,
    channelPolicyCode: null,
    note: null,
    createdBy: 'guest-1',
    createdAt: '2026-12-23T02:00:00.000Z',
    ...overrides,
  };
}

interface StubBreakdown {
  readonly appliedTierId: string;
  readonly hoursBeforeCheckIn: number;
  readonly refundPercent: number;
  readonly paidAmount: number;
  readonly requestedAmount: number;
}

function previewBody(overrides: Partial<StubBreakdown> = {}): string {
  return JSON.stringify({
    bookingId: 'bk-1',
    currency: 'VND',
    cancellation: {
      policyId: 'synthetic-policy-SAVER3',
      appliedTierId: 'unconfirmed',
      hoursBeforeCheckIn: 96,
      refundPercent: 100,
      paidAmount: 250_499,
      requestedAmount: 250_499,
      penaltyAmount: 0,
      refundFee: 0,
      ...overrides,
    },
    warnings: [],
  });
}

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

/**
 * Tạo booking thật trên API giả (HB-116) ngay trong document của phiên đăng nhập — dùng đúng đường
 * API như `f5.spec.ts` để màn huỷ có dữ liệu thật (kèm khoản thu) mà không phải rời trang.
 */
async function createBookingViaApi(page: Page): Promise<string> {
  await loginGuest(page);
  const id = await page.evaluate(
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
  await injectPayment(page, id);
  await page.goto(`/bookings/${id}/cancel`);
  await expect(page.getByTestId('cancel-screen')).toBeVisible();
  return id;
}

/** Có khoản thu đã thành công thì huỷ mới sinh yêu cầu hoàn tiền (HB-116). */
async function injectPayment(page: Page, bookingId: string): Promise<void> {
  const status = await page.evaluate(
    async ({ url, bookingId }) => {
      const token = await window.sessionClient!.getAccessToken();
      const response = await fetch(`${url}/__control/f5/bookings/${bookingId}`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          ...(token === null ? {} : { authorization: `Bearer ${token}` }),
        },
        body: JSON.stringify({ event: 'unconfirmed-partial' }),
      });
      return response.status;
    },
    { url: origin, bookingId },
  );
  expect(status).toBe(200);
}

interface StubOptions {
  readonly previews?: readonly string[];
  readonly previewDelayMs?: number;
  readonly previewError?: { readonly status: number; readonly code: string };
  readonly detail?: BookingSummary | null;
}

/** Hoãn phản hồi để kiểm trạng thái "đang tính" của màn hình. */
async function delay(ms: number): Promise<void> {
  const delayed = Promise.withResolvers<void>();
  setTimeout(delayed.resolve, ms);
  await delayed.promise;
}

interface Spy {
  readonly previews: number;
  readonly cancels: number;
}

async function stubJourney(page: Page, options: StubOptions = {}): Promise<Spy> {
  const spy = { previews: 0, cancels: 0 };
  const sequence = options.previews ?? [previewBody()];
  await page.route('**/api/session/journey/**', async (route: Route) => {
    const url = new URL(route.request().url());
    const path = url.pathname.replace('/api/session/journey/', '');
    if (path.endsWith('/cancel-preview')) {
      spy.previews += 1;
      if (options.previewDelayMs !== undefined) await delay(options.previewDelayMs);
      if (options.previewError !== undefined)
        return fulfillJson(
          route,
          options.previewError.status,
          JSON.stringify({
            code: options.previewError.code,
            message: 'Synthetic',
            traceId: 'stub-trace',
            timestamp: '2026-12-23T02:00:00.000Z',
            path: url.pathname,
          }),
        );
      const index = Math.min(spy.previews - 1, sequence.length - 1);
      return fulfillJson(route, 200, sequence[index] ?? previewBody());
    }
    if (path.endsWith('/cancel')) {
      spy.cancels += 1;
      return fulfillJson(
        route,
        200,
        JSON.stringify({
          bookingId: 'bk-1',
          status: 'CANCELLED',
          cancelledAt: '2026-12-23T03:00:00.000Z',
          cancelReason: 'GUEST_REQUEST',
          releasedAssignmentCount: 1,
          cancellation: JSON.parse(previewBody()).cancellation,
          refundRequest: { id: 'rf-1', status: 'PENDING', approvedAmount: null },
        }),
      );
    }
    if (/^bookings\/[^/]+$/.test(path)) {
      if (options.detail === null) return fulfillJson(route, 404, '{"code":"E_GEN_NOT_FOUND"}');
      return fulfillJson(route, 200, JSON.stringify(options.detail ?? bookingRow()));
    }
    return route.continue();
  });
  return spy;
}

test.describe('SCR-11 huỷ & tiền hoàn trên API giả (HB-103)', () => {
  test('luôn xem trước rồi mới xác nhận; huỷ xong hiện số hoàn và yêu cầu hoàn tiền (AC1)', async ({
    page,
  }) => {
    await createBookingViaApi(page);

    // Chưa xem trước thì chưa được xác nhận (AC1).
    await expect(page.getByTestId('cancel-confirm')).toBeDisabled();
    await expect(page.getByTestId('cancel-booking')).toContainText('HELD');

    await page.getByTestId('cancel-preview-button').click();
    const breakdown = page.getByTestId('cancel-preview');
    await expect(breakdown).toBeVisible();
    await expect(page.getByTestId('cancel-tier')).toContainText('unconfirmed');
    await expect(page.getByTestId('cancel-tier')).toContainText('96.0 giờ');
    await expect(page.getByTestId('cancel-tier')).toContainText('hoàn 100%');
    const refund = page.getByTestId('cancel-refund');
    await expect(refund).toContainText('Đã thu');
    await expect(refund).toContainText('250.499 ₫');
    await expect(refund).toContainText('Số tiền hoàn');

    await expect(page.getByTestId('cancel-confirm')).toBeEnabled();
    await page.getByTestId('cancel-confirm').click();
    const result = page.getByTestId('cancel-result');
    await expect(result).toBeVisible();
    await expect(page.getByTestId('cancel-result-status')).toContainText('CANCELLED');
    await expect(result).toContainText('Đã giải phóng 1 phòng');
    await expect(page.getByTestId('cancel-result-refund')).toContainText('PENDING');
    await expect(page.getByTestId('cancel-result-refund')).toContainText('chờ duyệt số tiền');
  });

  test('đang tính thì khoá cả nút xem trước lẫn nút xác nhận (AC1)', async ({ page }) => {
    await loginGuest(page);
    await stubJourney(page, { previewDelayMs: 1200 });
    await page.goto('/bookings/bk-1/cancel');

    await page.getByTestId('cancel-preview-button').click();
    await expect(page.getByTestId('cancel-preview-button')).toBeDisabled();
    await expect(page.getByTestId('cancel-confirm')).toBeDisabled();
    await expect(page.getByTestId('cancel-preview')).toBeVisible();
    await expect(page.getByTestId('cancel-confirm')).toBeEnabled();
  });

  test('số hoàn đổi giữa hai lần xem trước thì không huỷ, buộc xem lại rồi xác nhận (AC1)', async ({
    page,
  }) => {
    await loginGuest(page);
    const spy = await stubJourney(page, {
      previews: [previewBody(), previewBody({ requestedAmount: 200_000 })],
    });
    await page.goto('/bookings/bk-1/cancel');

    await page.getByTestId('cancel-preview-button').click();
    await expect(page.getByTestId('cancel-refund')).toContainText('250.499 ₫');
    await page.getByTestId('cancel-confirm').click();

    // Máy chủ trả số mới: KHÔNG gọi huỷ, hiện thông báo và số mới để khách xem lại.
    await expect(page.getByTestId('cancel-stale')).toBeVisible();
    await expect(page.getByTestId('cancel-refund')).toContainText('200.000 ₫');
    expect(spy.cancels).toBe(0);
    expect(spy.previews).toBe(2);

    // Xác nhận lần nữa: lần này số liệu ổn định nên huỷ được.
    await page.getByTestId('cancel-confirm').click();
    await expect(page.getByTestId('cancel-result')).toBeVisible();
    expect(spy.cancels).toBe(1);
  });

  test('lý do không được phép thì báo theo mã lỗi, không mở nút xác nhận (AC1)', async ({ page }) => {
    await loginGuest(page);
    await stubJourney(page, {
      previewError: { status: 403, code: 'E_PAY_REFUND_FORCE_MAJEURE_FORBIDDEN' },
    });
    await page.goto('/bookings/bk-1/cancel');

    await page.getByLabel('Lý do huỷ').selectOption('FORCE_MAJEURE');
    await page.getByTestId('cancel-preview-button').click();
    await expect(page.getByTestId('cancel-alert')).toContainText('Yêu cầu quyền');
    await expect(page.getByTestId('cancel-preview')).toHaveCount(0);
    await expect(page.getByTestId('cancel-confirm')).toBeDisabled();
  });

  test('booking không tồn tại thì báo không tìm thấy, không hiện biểu mẫu huỷ (AC2)', async ({
    page,
  }) => {
    await loginGuest(page);
    await stubJourney(page, { detail: null });
    await page.goto('/bookings/bk-khong-co/cancel');
    await expect(page.getByTestId('cancel-not-found')).toBeVisible();
    await expect(page.getByTestId('cancel-confirm')).toHaveCount(0);
  });

  test('không có vi phạm axe serious/critical và không cuộn ngang 360 px (AC2)', async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 800 });
    await loginGuest(page);
    await stubJourney(page);
    await page.goto('/bookings/bk-1/cancel');
    await expect(page.getByTestId('cancel-confirm')).toBeDisabled();
    const before = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
      .analyze();
    expect(
      before.violations
        .filter((violation) => violation.impact === 'serious' || violation.impact === 'critical')
        .map((violation) => violation.id),
    ).toEqual([]);

    await page.getByTestId('cancel-preview-button').click();
    await expect(page.getByTestId('cancel-preview')).toBeVisible();
    const after = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
      .analyze();
    expect(
      after.violations
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
