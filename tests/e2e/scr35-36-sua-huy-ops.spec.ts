import { expect, test, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { fulfillJson, listBody } from './operations-web/fake-api';
import { operationsWebOnly } from './operations-web/guard';
import { loginRefundStaff } from './operations-web/refund-fixture';

/**
 * SCR-35/SCR-36 (HB-108) — back-office gọi qua BFF phiên nhân viên, nên ca này khoá ở
 * `/api/session/sys/bookings/**`, `/cancellation-policies`, `/quotes`; trả phản hồi đúng hợp đồng.
 * Trọng tâm: huỷ **hai bước** (xem trước rồi xác nhận), đổi số hoàn thì **buộc xem lại**, và ghi
 * chú phần hợp đồng còn thiếu.
 */
operationsWebOnly();

// Client phiên không gửi request nào khi chưa đăng nhập, nên mỗi ca phải có phiên nhân viên trước.
test.beforeEach(async ({ page, request }) => {
  await loginRefundStaff(page, request, 'OWNER');
});

const BOOKINGS = /\/api\/session\/sys\/bookings/;
const POLICIES = /\/api\/session\/sys\/cancellation-policies/;
const QUOTES = /\/api\/session\/sys\/quotes/;

const BOOKING = {
  id: 'b1',
  code: 'PH-2601-00001',
  seq: 1,
  status: 'CONFIRMED',
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
  roomCount: 2,
  totalAmount: 2_000_000,
  depositPercent: 30,
  depositAmount: 600_000,
  paidAmount: 600_000,
  refundedAmount: 0,
  balanceDue: 1_400_000,
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
};

const POLICY = {
  id: 'pol-1',
  name: 'Chuẩn',
  status: 'ACTIVE',
  tiers: [
    { hoursBeforeCheckIn: 168, refundPercent: 100, label: 'Trước 7 ngày' },
    { hoursBeforeCheckIn: 96, refundPercent: 100 },
    { hoursBeforeCheckIn: 24, refundPercent: 50 },
  ],
  earlyCheckoutFreeHours: 2,
  earlyCheckoutRefundPct: 100,
  version: 1,
};

function preview(requestedAmount = 600_000): string {
  return JSON.stringify({
    bookingId: 'b1',
    currency: 'VND',
    cancellation: {
      policyId: 'pol-1',
      appliedTierId: '72h',
      hoursBeforeCheckIn: 96,
      refundPercent: 100,
      paidAmount: 600_000,
      requestedAmount,
      penaltyAmount: 0,
      refundFee: 0,
    },
    warnings: [],
  });
}

interface Spy {
  readonly cancelBodies: string[];
  readonly rescheduleBodies: string[];
  previews: number;
}

async function stubBooking(
  page: Page,
  options: { readonly previewAmounts?: readonly number[] } = {},
): Promise<Spy> {
  const spy: Spy = { cancelBodies: [], rescheduleBodies: [], previews: 0 };
  const amounts = options.previewAmounts ?? [600_000];
  await page.route(POLICIES, (route) => fulfillJson(route, 200, listBody([POLICY])));
  await page.route(QUOTES, (route) =>
    fulfillJson(
      route,
      201,
      JSON.stringify({
        quoteId: 'q-new',
        channelCode: 'WEB',
        ratePlanCode: 'FLEX7',
        checkIn: '2026-12-27',
        checkOut: '2026-12-29',
        nights: [],
        subtotal: 3_000_000,
        discountAmount: 0,
        total: 3_000_000,
        currency: 'VND',
        warnings: [],
        depositPercent: 30,
        depositAmount: 900_000,
        engineVersion: 'v1',
        quotedAt: '2026-12-01T00:00:00.000Z',
        expiresAt: '2026-12-01T00:15:00.000Z',
      }),
    ),
  );
  await page.route(BOOKINGS, (route) => {
    const url = new URL(route.request().url());
    if (url.pathname.endsWith('/cancel-preview')) {
      const index = Math.min(spy.previews, amounts.length - 1);
      spy.previews += 1;
      return fulfillJson(route, 200, preview(amounts[index] ?? 600_000));
    }
    if (url.pathname.endsWith('/cancel')) {
      spy.cancelBodies.push(route.request().postData() ?? '');
      return fulfillJson(
        route,
        200,
        JSON.stringify({
          bookingId: 'b1',
          status: 'CANCELLED',
          cancelledAt: '2026-12-02T03:00:00.000Z',
          cancelReason: 'GUEST_REQUEST',
          releasedAssignmentCount: 2,
          cancellation: JSON.parse(preview()).cancellation,
          refundRequest: { id: 'rf-1', status: 'PENDING', approvedAmount: null },
        }),
      );
    }
    if (url.pathname.endsWith('/reschedule')) {
      spy.rescheduleBodies.push(route.request().postData() ?? '');
      return fulfillJson(
        route,
        200,
        JSON.stringify({ ...BOOKING, checkIn: '2026-12-27', checkOut: '2026-12-29', rescheduleCount: 1 }),
      );
    }
    return fulfillJson(route, 200, JSON.stringify(BOOKING));
  });
  return spy;
}

test.describe('SCR-35/SCR-36 sửa/đổi ngày/huỷ booking (HB-108)', () => {
  test('huỷ hai bước: xem trước (có thang bậc) rồi mới xác nhận (AC1)', async ({ page }) => {
    const spy = await stubBooking(page);
    await page.goto('/bookings/b1/cancel');
    // HB-108: ngày chỉ-ngày hiển thị theo định dạng lịch dd/MM/yyyy, không còn ISO nguyên văn.
    const cancelHeader = page.getByTestId('cancel-booking');
    await expect(cancelHeader).toContainText('24/12/2026');
    await expect(cancelHeader).toContainText('26/12/2026');
    await expect(cancelHeader).not.toContainText('2026-12-24');
    await expect(page.getByTestId('cancel-confirm')).toBeDisabled();

    await page.getByLabel('Lý do huỷ').selectOption('GUEST_REQUEST');
    await page.getByLabel('Ghi chú cho khách/đối soát (không bắt buộc)').fill('Khách gọi huỷ');
    await page.getByTestId('cancel-preview').click();

    const panel = page.getByTestId('cancel-preview-panel');
    await expect(panel).toBeVisible();
    await expect(page.getByTestId('cancel-tier')).toContainText('96 giờ');
    const refund = page.getByTestId('cancel-refund');
    await expect(refund).toContainText('Đã thu');
    await expect(refund).toContainText('600.000 ₫');
    // §4.6: thang bậc của chính sách, khoanh bậc đang áp dụng.
    const ladder = page.getByTestId('cancel-ladder');
    await expect(ladder).toContainText('Bậc đang áp dụng');
    await expect(ladder).toContainText('50%');
    await expect(page.getByTestId('cancel-partial-gap')).toContainText('chưa có tuyến');

    await expect(page.getByTestId('cancel-confirm')).toBeEnabled();
    await page.getByTestId('cancel-confirm').click();
    await expect(page.getByTestId('cancel-result')).toBeVisible();
    await expect(page.getByTestId('cancel-result-status')).toContainText('CANCELLED');
    await expect(page.getByTestId('cancel-result-refund')).toContainText('chờ duyệt số tiền');
    expect(spy.cancelBodies[0]).toContain('"reason":"GUEST_REQUEST"');
    expect(spy.cancelBodies[0]).toContain('Khách gọi huỷ');
  });

  test('số hoàn đổi giữa hai lần xem trước thì không huỷ, buộc xem lại (AC1)', async ({ page }) => {
    const spy = await stubBooking(page, { previewAmounts: [600_000, 400_000] });
    await page.goto('/bookings/b1/cancel');
    await page.getByTestId('cancel-preview').click();
    await expect(page.getByTestId('cancel-refund')).toContainText('600.000 ₫');
    await page.getByTestId('cancel-confirm').click();

    await expect(page.getByTestId('cancel-stale')).toContainText('vừa thay đổi');
    await expect(page.getByTestId('cancel-refund')).toContainText('400.000 ₫');
    expect(spy.cancelBodies).toHaveLength(0);

    await page.getByTestId('cancel-confirm').click();
    await expect(page.getByTestId('cancel-result')).toBeVisible();
    expect(spy.cancelBodies).toHaveLength(1);
  });

  test('đổi ngày: chênh lệch trước xác nhận + ghi chú phí chờ hợp đồng (AC2)', async ({ page }) => {
    const spy = await stubBooking(page);
    await page.goto('/bookings/b1/reschedule');
    // HB-108: ngày chỉ-ngày hiển thị theo định dạng lịch dd/MM/yyyy, không còn ISO nguyên văn.
    const currentHeader = page.getByTestId('reschedule-current');
    await expect(currentHeader).toContainText('24/12/2026');
    await expect(currentHeader).toContainText('26/12/2026');
    await expect(currentHeader).not.toContainText('2026-12-24');
    await expect(page.getByTestId('reschedule-confirm')).toBeDisabled();
    await page.getByLabel('Ngày nhận phòng mới').fill('2026-12-27');
    await page.getByLabel('Ngày trả phòng mới').fill('2026-12-29');
    await page.getByTestId('reschedule-check').click();

    await expect(page.getByTestId('reschedule-diff')).toBeVisible();
    await expect(page.getByTestId('reschedule-new-total')).toContainText('3.000.000 ₫');
    await expect(page.getByTestId('reschedule-difference')).toContainText('tăng thêm 1.000.000 ₫');
    await expect(page.getByTestId('reschedule-fee-gap')).toContainText('chưa có trường này');

    await page.getByTestId('reschedule-confirm').click();
    await expect(page.getByTestId('reschedule-result')).toContainText('số lần đổi 1');
    await expect(page.getByTestId('reschedule-result')).toContainText('trạng thái CONFIRMED');
    const result = page.getByTestId('reschedule-result');
    await expect(result).toContainText('27/12/2026');
    await expect(result).toContainText('29/12/2026');
    await expect(result).not.toContainText('2026-12-27');
    expect(spy.rescheduleBodies[0]).toContain('"quoteId":"q-new"');
  });

  test('màn chi tiết booking có lối vào hai màn mới (AC1)', async ({ page }) => {
    await stubBooking(page);
    await page.goto('/bookings/b1');
    await expect(page.getByTestId('booking-open-cancel')).toHaveAttribute('href', '/bookings/b1/cancel');
    await expect(page.getByTestId('booking-open-reschedule')).toHaveAttribute(
      'href',
      '/bookings/b1/reschedule',
    );
  });

  test('mọi trạng thái hợp đồng §8.1 hiện được bằng ?state= (AC2)', async ({ page }) => {
    await stubBooking(page);
    for (const slug of ['forbidden', 'conflict', 'expired', 'unknown-outcome', 'validation-error']) {
      await page.goto(`/bookings/b1/cancel?state=${slug}`);
      await expect(page.getByTestId('cancel-screen')).toBeVisible();
      await expect(page.getByTestId('cancel-confirm')).toHaveCount(0);
    }
  });

  test('không có vi phạm axe serious/critical và không cuộn ngang 360 px (AC2)', async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 800 });
    await stubBooking(page);
    await page.goto('/bookings/b1/cancel');
    await page.getByTestId('cancel-preview').click();
    await expect(page.getByTestId('cancel-preview-panel')).toBeVisible();
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
