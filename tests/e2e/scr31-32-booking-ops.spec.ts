import { expect, test, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { errorBody, fulfillJson, listBody } from './operations-web/fake-api';
import { operationsWebOnly } from './operations-web/guard';
import { loginRefundStaff } from './operations-web/refund-fixture';

/**
 * SCR-31/SCR-32 (HB-106) — back-office gọi qua BFF phiên nhân viên
 * (`/api/session/sys/bookings`), nên ca này khoá ở tầng đó và trả phản hồi đúng
 * `listResponseSchema`/`bookingSummarySchema`. Đồng thời khẳng định **tham số lọc màn hình
 * gửi lên** (lọc/phân trang do máy chủ làm) và quy tắc hiện lối "xoá cứng".
 */
operationsWebOnly();

// Client phiên không gửi request nào khi chưa đăng nhập, nên mỗi ca phải có phiên nhân viên trước.
test.beforeEach(async ({ page, request }) => {
  await loginRefundStaff(page, request, 'OWNER');
});

/** Regex (không phải glob) vì đường dẫn chi tiết/xoá có thêm `/` — glob `*` không vượt qua dấu `/`. */
const LIST = /\/api\/session\/sys\/bookings/;

function booking(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'b1',
    code: 'PH-2601-00001',
    seq: 1,
    status: 'DRAFT',
    guestId: 'g1',
    propertyId: 'p1',
    roomTypeId: 'rt1',
    ratePlanId: 'FLEX7',
    channelId: 'c1',
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
    holdExpiresAt: null,
    oversold: false,
    priceLocked: false,
    duplicateSuspected: false,
    channelPolicyCode: null,
    note: null,
    createdBy: 'staff-1',
    createdAt: '2026-12-01T00:00:00.000Z',
    ...overrides,
  };
}

interface Spy {
  readonly listQueries: string[];
  readonly deletes: string[];
}

async function stubBookings(
  page: Page,
  options: {
    readonly pages?: readonly (readonly Record<string, unknown>[])[];
    readonly detail?: Record<string, unknown> | null;
    readonly detailStatus?: number;
    readonly detailCode?: string;
    readonly deleteStatus?: number;
  } = {},
): Promise<Spy> {
  const spy: Spy = { listQueries: [], deletes: [] };
  const pages = options.pages ?? [[booking()]];
  await page.route(LIST, async (route) => {
    const url = new URL(route.request().url());
    if (route.request().method() === 'DELETE') {
      spy.deletes.push(url.search);
      if (options.deleteStatus !== undefined && options.deleteStatus !== 204)
        return fulfillJson(
          route,
          options.deleteStatus,
          errorBody('E_BOOK_HARD_DELETE_FORBIDDEN', 'trace-delete', url.pathname),
        );
      return route.fulfill({ status: 204, body: '' });
    }
    if (url.pathname.endsWith('/bookings')) {
      spy.listQueries.push(url.search.slice(1));
      const cursor = url.searchParams.get('cursor');
      const index = cursor === null ? 0 : Number(cursor);
      return fulfillJson(route, 200, listBody(pages[index] ?? []));
    }
    if (options.detailStatus !== undefined && options.detailStatus !== 200)
      return fulfillJson(
        route,
        options.detailStatus,
        errorBody(options.detailCode ?? 'E_GEN_NOT_FOUND', 'trace-detail', url.pathname),
      );
    return fulfillJson(route, 200, JSON.stringify(options.detail ?? booking()));
  });
  return spy;
}

test.describe('SCR-31/SCR-32 danh sách & chi tiết booking (HB-106)', () => {
  test('danh sách lọc + phân trang do máy chủ làm, cuộn tiếp không nhân đôi dòng (AC1)', async ({
    page,
  }) => {
    await page.route(LIST, async (route) => {
      const url = new URL(route.request().url());
      const cursor = url.searchParams.get('cursor');
      if (cursor === null)
        return fulfillJson(
          route,
          200,
          JSON.stringify({
            data: [booking()],
            meta: { limit: 20, nextCursor: '1', hasMore: true, total: 2 },
          }),
        );
      return fulfillJson(
        route,
        200,
        JSON.stringify({
          data: [booking(), booking({ id: 'b2', code: 'PH-2601-00002', status: 'CONFIRMED' })],
          meta: { limit: 20, nextCursor: null, hasMore: false, total: 2 },
        }),
      );
    });
    const queries: string[] = [];
    page.on('request', (request) => {
      if (request.url().includes('/bookings') && request.method() === 'GET')
        queries.push(new URL(request.url()).search.slice(1));
    });

    await page.goto('/bookings');
    await expect(page.getByTestId('booking-row-PH-2601-00001')).toBeVisible();
    await expect(page.getByTestId('bookings-more')).toBeVisible();
    await page.getByTestId('bookings-more').click();
    await expect(page.getByTestId('booking-row-PH-2601-00002')).toBeVisible();
    await expect(page.getByTestId('booking-row-PH-2601-00001')).toHaveCount(1);
    await expect(page.getByTestId('bookings-more')).toHaveCount(0);

    // Bộ lọc do máy chủ làm: màn hình chỉ gửi tham số đúng hợp đồng.
    await page.getByLabel('Trạng thái').selectOption('HELD');
    await page.getByLabel('Tra theo mã/SĐT').fill('0912345678');
    await page.getByRole('button', { name: 'Lọc', exact: true }).click();
    await expect(page).toHaveURL(/status=HELD/);
    await expect(page).toHaveURL(/q=0912345678/);
    await expect
      .poll(() => queries.some((query) => query.includes('status=HELD') && query.includes('q=0912345678')))
      .toBe(true);
  });

  test('lối xoá cứng chỉ hiện với DRAFT/HELD và gửi kèm lý do (AC1)', async ({ page }) => {
    const spy = await stubBookings(page, {
      pages: [[booking(), booking({ id: 'b2', code: 'PH-2601-00002', status: 'CONFIRMED' })]],
    });
    await page.goto('/bookings');
    const confirmed = page.getByTestId('booking-row-PH-2601-00002');
    await expect(page.getByTestId('booking-delete-open-PH-2601-00001')).toBeVisible();
    await expect(page.getByTestId('booking-delete-open-PH-2601-00002')).toHaveCount(0);
    await expect(confirmed).toContainText('—');

    await page.getByTestId('booking-delete-open-PH-2601-00001').click();
    const panel = page.getByTestId('booking-delete-panel');
    await expect(panel).toContainText('PH-2601-00001');
    // Chưa có lý do thì chưa cho gửi (hợp đồng bắt buộc `reason`).
    await expect(page.getByTestId('booking-delete-confirm')).toBeDisabled();
    await page.getByLabel('Lý do xoá').fill('Khách huỷ qua điện thoại');
    await page.getByTestId('booking-delete-confirm').click();
    await expect.poll(() => spy.deletes.length).toBe(1);
    expect(spy.deletes[0]).toContain('reason=Kh');
    await expect(page.getByTestId('booking-row-PH-2601-00001')).toHaveCount(0);
  });

  test('máy chủ từ chối xoá cứng thì giữ nguyên dòng và báo theo mã (AC1)', async ({ page }) => {
    await stubBookings(page, { deleteStatus: 409 });
    await page.goto('/bookings');
    await page.getByTestId('booking-delete-open-PH-2601-00001').click();
    await page.getByLabel('Lý do xoá').fill('Thử xoá');
    await page.getByTestId('booking-delete-confirm').click();
    await expect(page.getByTestId('booking-row-PH-2601-00001')).toBeVisible();
  });

  test('chi tiết: không tìm thấy và ngoài phạm vi cơ sở báo đúng câu chữ (AC2)', async ({ page }) => {
    await stubBookings(page, { detailStatus: 404 });
    await page.goto('/bookings/b1');
    await expect(page.getByTestId('booking-not-found')).toContainText('Không tìm thấy booking');

    await page.unroute(LIST);
    await stubBookings(page, { detailStatus: 403, detailCode: 'E_AUTH_OUT_OF_SCOPE' });
    await page.goto('/bookings/b1');
    await expect(page.getByTestId('booking-out-of-scope')).toContainText(
      'Booking thuộc cơ sở ngoài phạm vi của bạn',
    );

    await page.unroute(LIST);
    await stubBookings(page);
    await page.goto('/bookings/b1');
    await expect(page.getByTestId('booking-detail-code')).toContainText('PH-2601-00001');
    await expect(page.getByTestId('booking-detail-status')).toContainText('DRAFT');
    await expect(page.getByTestId('booking-detail-money')).toContainText('Còn nợ');
    // Hai phần thiết kế §8.1 chưa có trong hợp đồng: hiện khung chờ, không bịa số liệu.
    await expect(page.getByTestId('booking-nights-pending')).toContainText('chưa có tuyến');
    await expect(page.getByTestId('booking-payments-pending')).toContainText('chưa có tuyến');
  });

  test('mọi trạng thái hợp đồng §8.1 hiện được bằng ?state= (AC2)', async ({ page }) => {
    await stubBookings(page);
    for (const slug of ['forbidden', 'conflict', 'expired', 'unknown-outcome', 'empty']) {
      await page.goto(`/bookings?state=${slug}`);
      await expect(page.getByTestId('bookings-screen')).toBeVisible();
      await expect(page.getByTestId('bookings-list')).toHaveCount(0);
    }
  });

  test('không có vi phạm axe serious/critical và không cuộn ngang 360 px (AC2)', async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 800 });
    await stubBookings(page);
    await page.goto('/bookings');
    await expect(page.getByTestId('booking-row-PH-2601-00001')).toBeVisible();
    const list = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
      .analyze();
    expect(
      list.violations
        .filter((violation) => violation.impact === 'serious' || violation.impact === 'critical')
        .map((violation) => violation.id),
    ).toEqual([]);
    const overflow = await page.evaluate(() => {
      const element = document.scrollingElement;
      return element === null ? 0 : element.scrollWidth - element.clientWidth;
    });
    expect(overflow).toBeLessThanOrEqual(1);

    await page.goto('/bookings/b1');
    await expect(page.getByTestId('booking-detail-code')).toBeVisible();
    const detail = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
      .analyze();
    expect(
      detail.violations
        .filter((violation) => violation.impact === 'serious' || violation.impact === 'critical')
        .map((violation) => violation.id),
    ).toEqual([]);
  });
;
});
