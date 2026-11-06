import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { fulfillJson, listBody } from '../operations-web/fake-api';
import { operationsWebOnly } from '../operations-web/guard';
import { loginRefundStaff } from '../operations-web/refund-fixture';

/**
 * SCR-47 (HB-138) trên API giả của BFF. Chỉ chứng minh giao diện; nghiệm thu nghiệp vụ cần API thật và
 * bằng chứng HB-194 (hiện `GET /refund-requests` còn thiếu trên API thật). Mọi dữ liệu là tổng hợp.
 */
const PROPERTY = {
  id: 'journey-standard',
  name: 'Synthetic Hill',
  status: 'ACTIVE',
  activeRoomCount: 20,
  overbookLimitPct: 5,
  checkInTime: '14:00',
  checkOutTime: '12:00',
  version: 1,
};
const REFUND = {
  id: 'r1',
  bookingId: 'bk-1',
  paymentId: 'pay-1',
  policyId: 'pol-1',
  hoursBeforeCheckIn: 30,
  appliedTierId: 'tier-2',
  refundPercent: 100,
  requestedAmount: 500000,
  approvedAmount: null,
  refundFee: 0,
  netRefund: 500000,
  status: 'PENDING',
  isForceMajeure: true,
  reason: 'FORCE_MAJEURE',
  evidenceRefs: ['file-aaaa'],
  requestedBy: 'u-other',
  approvedBy: null,
  decidedAt: null,
  paidAt: null,
  createdAt: '2026-11-10T00:00:00.000Z',
};
const DECISION = {
  id: 'r1',
  status: 'APPROVED',
  requestedAmount: 500000,
  approvedAmount: 500000,
  refundPercent: 100,
  requestedBy: 'u-other',
  approvedBy: 'u-mgr',
  decidedAt: '2026-11-10T02:00:00.000Z',
  auditLogId: 'a1',
  payoutDeadline: '2026-11-12T02:00:00.000Z',
};
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

operationsWebOnly();

interface Spy {
  keys: string[];
  matches: (string | undefined)[];
  bodies: string[];
  lists: number;
}

async function backend(page: Page, onApprove?: (calls: number) => 'abort' | 'ok'): Promise<Spy> {
  const spy: Spy = { keys: [], matches: [], bodies: [], lists: 0 };
  let approved = false;
  await page.route('**/api/session/sys/properties*', (route) => fulfillJson(route, 200, listBody([PROPERTY])));
  await page.route('**/api/session/sys/refund-requests*', (route) => {
    spy.lists += 1;
    const row = approved ? { ...REFUND, status: 'APPROVED', approvedBy: 'u-mgr', approvedAmount: 500000 } : REFUND;
    return fulfillJson(route, 200, listBody([row]));
  });
  await page.route('**/api/session/sys/refund-requests/r1/approve', (route) => {
    const headers = route.request().headers();
    spy.keys.push(headers['idempotency-key'] ?? '');
    spy.matches.push(headers['if-match']);
    spy.bodies.push(route.request().postData() ?? '');
    if (onApprove?.(spy.keys.length) === 'abort') return route.abort('failed');
    approved = true;
    return fulfillJson(route, 200, JSON.stringify(DECISION));
  });
  await page.route('**/api/session/sys/auth/pin/verify', (route) =>
    fulfillJson(route, 200, JSON.stringify({ pinToken: 'synthetic-pin-token-0001', expiresAt: '2026-11-10T01:00:00.000Z' })),
  );
  return spy;
}

async function expectNoBlockingViolations(page: Page): Promise<void> {
  const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
  const blocking = results.violations.filter((item) => item.impact === 'serious' || item.impact === 'critical');
  expect(blocking.map((item) => item.id)).toEqual([]);
}

test.describe('SCR-47 ngoại lệ chính sách (HB-138)', () => {
  test('browser_keyboard_a11y_responsive', async ({ page, request }) => {
    await loginRefundStaff(page, request, 'MANAGER');
    const spy = await backend(page);
    await page.goto('/overbooking/policy-exceptions');
    await expect(page.getByTestId('hb138-row-r1')).toContainText('Bất khả kháng');
    await expect(page.getByTestId('hb138-status-r1')).toContainText('Chờ duyệt (PENDING)');
    await expect(page.getByTestId('hb138-row-r1')).toContainText('Chưa chi (duyệt không đồng nghĩa đã chi)');
    await expectNoBlockingViolations(page);

    // Lý do dưới 20 ký tự: báo theo trường, không gửi.
    await page.getByRole('textbox', { name: 'Mã booking cần lập ngoại lệ' }).fill('bk-9');
    await page.getByRole('textbox', { name: 'Mã khoản thu cần hoàn' }).fill('pay-9');
    await page.getByRole('textbox', { name: /Lý do \(≥ 20 ký tự\)/ }).fill('Quá ngắn');
    await page.getByRole('textbox', { name: /Mã tệp minh chứng/ }).fill('file-aaaa');
    await page.getByTestId('hb138-create-submit').focus();
    await page.keyboard.press('Enter');
    await expect(page.locator('#hb138-note-error')).toContainText('ít nhất 20 ký tự');
    await expect(page.getByTestId('hb138-dialog-create')).toBeHidden();
    await expectNoBlockingViolations(page);

    // Bàn phím: mở hộp thoại duyệt, PIN sai hình dạng báo lỗi, Escape trả focus về nút đã mở.
    await page.getByTestId('hb138-approve-r1').focus();
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('hb138-dialog-decision')).toBeVisible();
    await expect(page.getByTestId('hb138-dialog-decision')).toContainText('500000');
    await page.getByTestId('hb138-dialog-decision-confirm').focus();
    await page.keyboard.press('Enter');
    await expect(page.locator('#hb138-decisionPin-error')).toContainText('PIN gồm đúng 6 chữ số');
    expect(spy.keys).toHaveLength(0);
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('hb138-dialog-decision')).toBeHidden();
    await expect(page.getByTestId('hb138-approve-r1')).toBeFocused();

    // Duyệt: khoá UUIDv4, số tiền duyệt đúng số máy chủ, PIN ngoài thân lệnh; nhãn đổi theo bản đọc lại.
    await page.keyboard.press('Enter');
    await page.getByLabel('PIN (6 chữ số)').fill('123456');
    await page.getByTestId('hb138-dialog-decision-confirm').focus();
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('hb138-done')).toBeVisible();
    await expect(page.getByTestId('hb138-status-r1')).toContainText('Đã duyệt (APPROVED)');
    expect(spy.keys).toHaveLength(1);
    expect(spy.keys[0]).toMatch(UUID_V4);
    expect(spy.matches[0]).toBeUndefined();
    expect(spy.bodies[0]).toContain('"approvedAmount":500000');
    expect(spy.bodies[0]).not.toContain('123456');
    await expect(page.getByTestId('hb138-row-r1')).toContainText('Chưa chi (duyệt không đồng nghĩa đã chi)');
    await expectNoBlockingViolations(page);

    await page.setViewportSize({ width: 360, height: 800 });
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
  });

  test('timeout giữ nguyên khoá khi gửi lại duyệt', async ({ page, request }) => {
    await loginRefundStaff(page, request, 'OWNER');
    const spy = await backend(page, (calls) => (calls <= 2 ? 'abort' : 'ok'));
    await page.goto('/overbooking/policy-exceptions');
    await page.getByTestId('hb138-approve-r1').click();
    await page.getByLabel('PIN (6 chữ số)').fill('123456');
    await page.getByTestId('hb138-dialog-decision-confirm').click();
    await expect(page.getByTestId('hb138-failure')).toContainText('Chưa biết lệnh đã được áp dụng');
    await expect(page.getByTestId('hb138-status-r1')).toContainText('Chờ duyệt (PENDING)');
    await page.getByRole('button', { name: 'Gửi lại cùng lệnh' }).click();
    await expect(page.getByTestId('hb138-done')).toBeVisible();
    expect(new Set(spy.keys).size).toBe(1);
    expect(new Set(spy.bodies).size).toBe(1);
    expect(spy.keys.length).toBeGreaterThanOrEqual(3);
  });

  test('vai không có quyền không tải hồ sơ', async ({ page, request }) => {
    await loginRefundStaff(page, request, 'FRONT_DESK');
    const spy = await backend(page);
    await page.goto('/overbooking/policy-exceptions');
    await expect(page.getByText('Bạn không có quyền xem hoặc thao tác nội dung này.')).toBeVisible();
    await expect(page.getByTestId('hb138-table')).toHaveCount(0);
    expect(spy.lists).toBe(0);
  });
});
