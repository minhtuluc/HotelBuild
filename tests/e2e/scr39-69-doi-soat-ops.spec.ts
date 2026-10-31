import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { loginCollectionStaff } from './operations-web/collect-fixture';
import { fulfillJson } from './operations-web/fake-api';
import { operationsWebOnly } from './operations-web/guard';

/**
 * HB-111 — SCR-39 (Đối soát doanh thu/quỹ cuối ngày) + SCR-69 (Xử lý trả phòng sớm).
 */
operationsWebOnly();

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

async function stubReconcileAndEarlyCheckout(page: Page): Promise<{
  reconcileBodies: string[];
  checkoutBodies: string[];
}> {
  await loginCollectionStaff(page);
  const reconcileBodies: string[] = [];
  const checkoutBodies: string[] = [];

  await page.route(/\/api\/v1\/properties/, (route) =>
    fulfillJson(
      route,
      200,
      JSON.stringify({
        data: [
          {
            id: 'prop-1',
            code: 'PH-DL',
            name: 'PineHill Đà Lạt',
            timezone: 'Asia/Ho_Chi_Minh',
            currency: 'VND',
            active: true,
          },
        ],
        nextCursor: null,
      }),
    ),
  );
  await page.route(/\/api\/v1\/reports\/revenue-by-channel/, (route) =>
    fulfillJson(
      route,
      200,
      JSON.stringify({
        from: '2026-12-24',
        to: '2026-12-24',
        rows: [
          {
            channelCode: 'WEB',
            bookings: 3,
            grossAmount: 4_500_000,
            commissionAmount: 0,
            netAmount: 4_500_000,
          },
        ],
      }),
    ),
  );
  await page.route(/\/api\/v1\/reports\/export/, (route) =>
    fulfillJson(
      route,
      202,
      JSON.stringify({
        operationId: 'op-export-39',
        status: 'PENDING',
        statusUrl: '/api/v1/operations/op-export-39',
      }),
    ),
  );
  await page.route(/\/api\/v1\/auth\/pin\/verify/, (route) =>
    fulfillJson(
      route,
      200,
      JSON.stringify({
        pinToken: 'pin-token-hb111-1234567890',
        expiresAt: new Date(Date.now() + 300_000).toISOString(),
      }),
    ),
  );
  await page.route(/\/api\/v1\/reconciliation\/daily\/close/, (route) => {
    const body = route.request().postData() ?? '';
    reconcileBodies.push(body);
    return fulfillJson(
      route,
      200,
      JSON.stringify({
        propertyId: 'prop-1',
        businessDate: '2026-12-24',
        expectedCash: 2_000_000,
        countedCash: 1_900_000,
        difference: -100_000,
        managerNotified: true,
        auditLogId: 'audit-rec-1',
        closedAt: '2026-12-24T15:00:00.000Z',
      }),
    );
  });
  await page.route(/\/api\/v1\/bookings\/b-early/, (route) =>
    fulfillJson(
      route,
      200,
      JSON.stringify({
        id: 'b-early',
        code: 'PH-261224-EARLY',
        seq: 1,
        status: 'CHECKED_IN',
        guestId: 'g1',
        propertyId: 'prop-1',
        roomTypeId: 'rt1',
        ratePlanId: 'FLEX7',
        channelId: 'ch-direct',
        checkIn: '2026-12-24',
        checkOut: '2026-12-27',
        nights: 3,
        adults: 2,
        children: 0,
        roomCount: 1,
        totalAmount: 3_000_000,
        depositPercent: 30,
        depositAmount: 900_000,
        paidAmount: 3_000_000,
        refundedAmount: 0,
        balanceDue: 0,
        penaltyAmount: 0,
        currency: 'VND',
        rescheduleCount: 0,
        holdExpiresAt: null,
        oversold: false,
        priceLocked: true,
        duplicateSuspected: false,
        channelPolicyCode: null,
        note: null,
        createdBy: 'staff-1',
        createdAt: '2026-12-20T00:00:00.000Z',
      }),
    ),
  );
  await page.route(/\/api\/v1\/front-office\/check-out\/preview/, (route) =>
    fulfillJson(
      route,
      200,
      JSON.stringify({
        bookingId: 'b-early',
        feeAmount: 500_000,
        extrasAmount: 0,
        balanceDue: 500_000,
        computedAt: '2026-12-25T04:00:00.000Z',
      }),
    ),
  );
  await page.route(/\/api\/v1\/front-office\/check-out$/, (route) => {
    const body = route.request().postData() ?? '';
    checkoutBodies.push(body);
    return fulfillJson(
      route,
      200,
      JSON.stringify({
        bookingId: 'b-early',
        status: 'CHECKED_OUT',
        checkedOutAt: '2026-12-25T04:05:00.000Z',
        extrasAmount: 0,
        feeAmount: 500_000,
        balanceDue: 500_000,
        housekeepingTaskIds: ['hk-1'],
      }),
    );
  });

  return { reconcileBodies, checkoutBodies };
}

test('SCR-39 — chốt quỹ theo (người thu, ngày VN), đòi PIN và cảnh báo lệch > 50.000 ₫ (AC1)', async ({
  page,
}) => {
  const spy = await stubReconcileAndEarlyCheckout(page);
  await page.setViewportSize({ width: 360, height: 800 });
  await page.goto('/reconciliation');

  await expect(page.getByTestId('reconciliation-channel-table')).toContainText('WEB');
  await expect(page.getByTestId('reconciliation-submit')).toBeDisabled();

  await page.locator('input[name="pin"]').fill('123456');
  await page.getByTestId('pin-submit').click();
  await expect(page.getByTestId('pin-verified')).toBeVisible();

  await page.locator('input[name="countedCash"]').fill('1900000');
  await page.getByTestId('reconciliation-submit').click();

  await expect(page.getByTestId('reconciliation-result')).toBeVisible();
  await expect(page.getByTestId('reconciliation-discrepancy-warning')).toContainText('50.000 ₫');
  expect(spy.reconcileBodies).toHaveLength(1);
  expect(spy.reconcileBodies[0]).toContain('"countedCash":1900000');
  expect(spy.reconcileBodies[0]).toContain('"pinToken":"pin-token-hb111-1234567890"');
});

test('SCR-69 — xem trước trả phòng sớm + xác thực PIN mới cho xác nhận trả phòng sớm (AC1)', async ({
  page,
}) => {
  const spy = await stubReconcileAndEarlyCheckout(page);
  await page.setViewportSize({ width: 360, height: 800 });
  await page.goto('/bookings/b-early/early-checkout');

  await expect(page.getByTestId('early-checkout-booking')).toContainText('PH-261224-EARLY');
  await expect(page.getByTestId('early-checkout-confirm')).toBeDisabled();

  await page.getByTestId('early-checkout-preview-button').click();
  await expect(page.getByTestId('early-checkout-preview')).toContainText('500.000 ₫');
  await expect(page.getByTestId('early-checkout-confirm')).toBeDisabled();

  await page.locator('input[name="pin"]').fill('123456');
  await page.getByTestId('pin-submit').click();
  await expect(page.getByTestId('pin-verified')).toBeVisible();
  await expect(page.getByTestId('early-checkout-confirm')).toBeEnabled();

  await page.getByTestId('early-checkout-confirm').click();
  await expect(page.getByTestId('early-checkout-result')).toContainText('CHECKED_OUT');
  await expect(page.getByTestId('early-checkout-tasks')).toContainText('1');
  expect(spy.checkoutBodies).toHaveLength(1);
  expect(spy.checkoutBodies[0]).toContain('"earlyCheckOut":true');
  expect(spy.checkoutBodies[0]).toContain('"pinToken":"pin-token-hb111-1234567890"');
});

for (const state of STATES) {
  test(`SCR-39 & SCR-69 trạng thái ${state}: hợp đồng §8.1 và axe sạch (AC2)`, async ({ page }) => {
    await loginCollectionStaff(page);
    for (const path of [`/reconciliation?state=${state}`, `/bookings/b-early/early-checkout?state=${state}`]) {
      await page.goto(path);
      await expect(page.getByText(EXPECTED[state], { exact: false })).toBeVisible();
      const results = await new AxeBuilder({ page })
        .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
        .analyze();
      const blocking = results.violations.filter(
        (v) => v.impact === 'serious' || v.impact === 'critical',
      );
      expect(blocking.map((v) => v.id)).toEqual([]);
    }
  });
}
