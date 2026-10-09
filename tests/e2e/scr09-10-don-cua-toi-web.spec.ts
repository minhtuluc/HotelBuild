import { randomInt } from 'node:crypto';
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page, type Route } from '@playwright/test';
import type { createSessionClient } from '../../packages/web-session/src/client.js';
import type { BookingSummary } from '../../packages/contracts/src/index.js';
import { fulfillJson, listBody } from './operations-web/fake-api';

/**
 * SCR-09/SCR-10 chỉ có ở web khách (ADR-018).
 *
 * Lưu ý: API giả HB-116 **chưa** có tuyến `GET /api/v1/bookings` (danh sách) — xem ghi chú ở PR HB-102 —
 * nên ca này khoá đúng hợp đồng: chặn ở tầng BFF hành trình và trả phản hồi theo `listResponseSchema`
 * để kiểm giao diện, đồng thời khẳng định truy vấn màn hình gửi đi (mã/SĐT, trạng thái, con trỏ).
 */
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
    ratePlanId: 'FLEX7',
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
    paidAmount: 0,
    refundedAmount: 0,
    balanceDue: 2_000_000,
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

interface StubOptions {
  readonly pages?: readonly (readonly BookingSummary[])[];
  readonly status?: number;
  readonly code?: string;
  readonly detail?: BookingSummary | null;
}

/** Khoá ở tầng BFF hành trình: trả lời theo hợp đồng và ghi lại truy vấn màn hình gửi. */
async function stubJourney(
  page: Page,
  options: StubOptions = {},
): Promise<{ readonly listQueries: string[] }> {
  const listQueries: string[] = [];
  const pages = options.pages ?? [[bookingRow()]];
  await page.route('**/api/session/journey/**', async (route: Route) => {
    const url = new URL(route.request().url());
    const path = url.pathname.replace('/api/session/journey/', '');
    if (path === 'bookings') {
      listQueries.push(url.search.slice(1));
      if (options.status !== undefined && options.status !== 200)
        return fulfillJson(
          route,
          options.status,
          JSON.stringify({
            code: options.code ?? 'E_RBAC_FORBIDDEN',
            message: 'Synthetic',
            traceId: 'stub-trace',
            timestamp: '2026-12-23T02:00:00.000Z',
            path: url.pathname,
          }),
        );
      const cursor = url.searchParams.get('cursor');
      const index = cursor === null ? 0 : Number(cursor);
      return fulfillJson(route, 200, listBody(pages[index] ?? []));
    }
    if (/^bookings\/[^/]+\/balance$/.test(path)) {
      if (options.detail === null) return fulfillJson(route, 404, '{"code":"E_GEN_NOT_FOUND"}');
      return fulfillJson(
        route,
        200,
        JSON.stringify({
          bookingId: options.detail?.id ?? 'bk-1',
          currency: 'VND',
          totalAmount: 2_000_000,
          paidAmount: 600_000,
          refundedAmount: 0,
          reservedRefundAmount: 0,
          balanceDue: 1_400_000,
        }),
      );
    }
    if (/^bookings\/[^/]+$/.test(path)) {
      if (options.detail === null) return fulfillJson(route, 404, '{"code":"E_GEN_NOT_FOUND"}');
      return fulfillJson(route, 200, JSON.stringify(options.detail ?? bookingRow()));
    }
    return route.continue();
  });
  return { listQueries };
}

test.describe('SCR-09/10 đơn của tôi trên API giả (HB-102)', () => {
  test('liệt kê đơn kèm trạng thái, tiền và lọc theo trạng thái + mã (AC1)', async ({ page }) => {
    const held = bookingRow();
    const confirmed = bookingRow({
      id: 'bk-2',
      code: 'SYN080',
      status: 'CONFIRMED',
      holdExpiresAt: null,
      balanceDue: 0,
    });
    await loginGuest(page);
    const { listQueries } = await stubJourney(page, { pages: [[held, confirmed]] });
    await page.goto('/bookings');

    await expect(page.getByTestId('bookings-list')).toBeVisible();
    await expect(page.getByTestId('booking-row-SYN079')).toContainText('Đang giữ chỗ');
    await expect(page.getByTestId('booking-row-SYN079')).toContainText('2.000.000 ₫');
    await expect(page.getByTestId('booking-row-SYN080')).toContainText('Đã xác nhận');
    await expect(page.getByTestId('booking-row-SYN079')).toContainText(/\d{2}:\d{2}/);
    expect(listQueries[0]).toContain('limit=20');

    // Lọc do máy chủ làm: màn hình chỉ gửi tham số đúng hợp đồng.
    await page.getByLabel('Trạng thái').selectOption('CONFIRMED');
    await page.getByLabel('Tra cứu theo mã/SĐT').fill('0912345678');
    await page.getByRole('button', { name: 'Tra cứu' }).click();
    await expect(page).toHaveURL(/status=CONFIRMED/);
    await expect(page).toHaveURL(/q=0912345678/);
    await expect
      .poll(() => listQueries.some((query) => query.includes('status=CONFIRMED')))
      .toBe(true);
    expect(listQueries.some((query) => query.includes('q=0912345678'))).toBe(true);
  });

  test('cuộn tiếp theo con trỏ máy chủ, không nhân đôi dòng (AC1)', async ({ page }) => {
    const first = bookingRow();
    const second = bookingRow({ id: 'bk-2', code: 'SYN080' });
    await loginGuest(page);
    await page.route('**/api/session/journey/bookings*', async (route) => {
      const url = new URL(route.request().url());
      const cursor = url.searchParams.get('cursor');
      // Trang đầu báo còn dữ liệu; "Tải thêm" gửi con trỏ do máy chủ trả.
      if (cursor === null)
        return fulfillJson(
          route,
          200,
          JSON.stringify({
            data: [first],
            meta: { limit: 1, nextCursor: '1', hasMore: true, total: 2 },
          }),
        );
      return fulfillJson(
        route,
        200,
        JSON.stringify({
          data: [first, second],
          meta: { limit: 1, nextCursor: null, hasMore: false, total: 2 },
        }),
      );
    });
    await page.goto('/bookings');
    await expect(page.getByTestId('booking-row-SYN079')).toBeVisible();
    await expect(page.getByTestId('booking-row-SYN080')).toHaveCount(0);
    await page.getByTestId('bookings-more').click();
    await expect(page.getByTestId('booking-row-SYN080')).toBeVisible();
    // Máy chủ trả lại cả dòng trang trước: giao diện khử trùng, không hiện hai lần.
    await expect(page.getByTestId('booking-row-SYN079')).toHaveCount(1);
    await expect(page.getByTestId('bookings-more')).toHaveCount(0);
  });

  test('mở chi tiết: đọc lại booking và số dư từ máy chủ, có lối vào huỷ/đổi ngày (AC1)', async ({
    page,
  }) => {
    await loginGuest(page);
    const requests: string[] = [];
    await page.route('**/api/session/journey/**', async (route) => {
      const path = new URL(route.request().url()).pathname.replace('/api/session/journey/', '');
      requests.push(path);
      if (path === 'bookings') return fulfillJson(route, 200, listBody([bookingRow()]));
      if (/^bookings\/[^/]+\/balance$/.test(path))
        return fulfillJson(
          route,
          200,
          JSON.stringify({
            bookingId: 'bk-1',
            currency: 'VND',
            totalAmount: 2_000_000,
            paidAmount: 600_000,
            refundedAmount: 0,
            reservedRefundAmount: 0,
            balanceDue: 1_400_000,
          }),
        );
      if (/^bookings\/[^/]+$/.test(path))
        return fulfillJson(route, 200, JSON.stringify(bookingRow()));
      return route.continue();
    });
    await page.goto('/bookings');
    await page.getByRole('link', { name: 'SYN079' }).click();

    await expect(page).toHaveURL('/bookings/bk-1');
    await expect(page.getByTestId('booking-detail-code')).toContainText('SYN079');
    await expect(page.getByTestId('booking-detail-status')).toContainText('Đang giữ chỗ');
    await expect(page.getByTestId('booking-detail-stay')).toContainText('2026-12-24 → 2026-12-26');
    const balance = page.getByTestId('booking-detail-balance');
    await expect(balance).toContainText('Đã thu');
    await expect(balance).toContainText('600.000 ₫');
    await expect(balance).toContainText('Còn phải trả');
    await expect(balance).toContainText('1.400.000 ₫');
    await expect(page.getByTestId('booking-detail-pending')).toContainText('chưa có');
    await expect(page.getByRole('link', { name: 'Huỷ đặt phòng' })).toHaveAttribute(
      'href',
      '/bookings/bk-1/cancel',
    );
    await expect(page.getByRole('link', { name: 'Đổi ngày' })).toHaveAttribute(
      'href',
      '/bookings/bk-1/reschedule',
    );
    // Chi tiết và số dư đều đọc lại từ máy chủ, không suy từ màn danh sách.
    expect(requests).toContain('bookings/bk-1');
    expect(requests).toContain('bookings/bk-1/balance');
  });

  test('trạng thái rỗng, thiếu quyền và không tìm thấy (AC2)', async ({ page }) => {
    await loginGuest(page);
    await stubJourney(page, { pages: [[]] });
    await page.goto('/bookings');
    await expect(page.getByText('Chưa có dữ liệu')).toBeVisible();

    await page.goto('/bookings?status=HELD');
    await expect(page.getByText('Không có kết quả khớp bộ lọc')).toBeVisible();

    await page.unroute('**/api/session/journey/**');
    await stubJourney(page, { status: 403, code: 'E_RBAC_FORBIDDEN' });
    await page.goto('/bookings');
    await expect(page.getByTestId('access-denied')).toBeVisible();
  });

  test('chi tiết không tồn tại thì báo không tìm thấy, không hiện dữ liệu giả (AC2)', async ({
    page,
  }) => {
    await loginGuest(page);
    await stubJourney(page, { detail: null });
    await page.goto('/bookings/bk-khong-co');
    await expect(page.getByTestId('booking-detail-not-found')).toBeVisible();
    await expect(page.getByTestId('booking-detail-code')).toHaveCount(0);
  });

  test('không có vi phạm axe serious/critical và không cuộn ngang 360 px (AC2)', async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 800 });
    await loginGuest(page);
    await stubJourney(page, { pages: [[bookingRow()]] });
    await page.goto('/bookings');
    await expect(page.getByTestId('booking-row-SYN079')).toBeVisible();
    const list = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
      .analyze();
    expect(
      list.violations
        .filter((violation) => violation.impact === 'serious' || violation.impact === 'critical')
        .map((violation) => violation.id),
    ).toEqual([]);

    await page.getByRole('link', { name: 'SYN079' }).click();
    await expect(page.getByTestId('booking-detail-balance')).toBeVisible();
    const detail = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
      .analyze();
    expect(
      detail.violations
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
