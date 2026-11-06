import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { fulfillJson } from '../operations-web/fake-api';
import { operationsWebOnly } from '../operations-web/guard';
import { loginRefundStaff } from '../operations-web/refund-fixture';

/**
 * SCR-45/46 (HB-137) trên API giả của BFF. Chỉ chứng minh giao diện; nghiệm thu nghiệp vụ cần API thật,
 * seed quá tải và bằng chứng HB-194. Mọi dữ liệu là tổng hợp, không có PII/PIN/token thật.
 */
const MERGE = {
  id: 'mg1',
  moveType: 'MERGE_SHARE',
  primaryBookingId: 'bk-1',
  secondaryBookingId: 'bk-2',
  roomId: 'room-1',
  roomIdA: null,
  roomIdB: null,
  consents: [],
  genderSame: true,
  approvedBy: null,
  approvedAt: null,
  discountPct: 20,
  discountAmount: 290800,
  priceLocked: true,
  status: 'PENDING_CONSENT',
  createdAt: '2026-11-10T00:00:00.000Z',
  updatedAt: '2026-11-10T00:00:00.000Z',
  version: 2,
  allowedActions: ['RECORD_CONSENT'],
  writeIntent: null,
};
const MOVE = {
  id: 'mv1',
  overbookingCaseId: 'k1',
  bookingId: 'bk-3',
  bookingRoomId: 'br-3',
  moveType: 'WALK_OUT',
  fromRoomId: 'room-3',
  toRoomId: null,
  fromPropertyId: 'journey-standard',
  toPropertyId: null,
  reason: 'Quá tải',
  keepScore: 12,
  priceLocked: true,
  compensationAmount: 300000,
  transportCost: 50000,
  consent: { granted: true, channel: 'PHONE' },
  approvedBy: 'u-mgr',
  approvedAt: '2026-11-10T00:00:00.000Z',
  status: 'APPROVED',
  assignmentIds: [],
  walkOut: {
    walkOutDocNo: 'WO-001',
    guestSignatureRef: 'sig-guest',
    staffSignatureRef: 'sig-staff',
    refundRequestId: null,
    compensationPaymentId: null,
  },
  createdAt: '2026-11-10T00:00:00.000Z',
  updatedAt: '2026-11-10T00:00:00.000Z',
  version: 4,
  allowedActions: [],
  writeIntent: null,
};
const PAYMENT = {
  id: 'pay-1',
  roomMoveId: 'mv1',
  bookingId: 'bk-3',
  amount: 300000,
  currency: 'VND',
  type: 'COMPENSATION',
  method: 'CASH',
  state: 'SUCCEEDED',
  paymentStatus: 'SUCCEEDED',
  operationId: 'op-1',
  approvalRef: { approvedBy: 'u-mgr', approvedAt: '2026-11-10T00:00:00.000Z' },
  bankReference: null,
  evidenceRefs: [],
  createdBy: 'u-acc',
  createdAt: '2026-11-10T00:00:00.000Z',
  paidAt: '2026-11-10T00:01:00.000Z',
};
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

operationsWebOnly();

interface Spy {
  keys: string[];
  matches: (string | undefined)[];
  bodies: string[];
}

async function common(page: Page): Promise<void> {
  await page.route('**/api/session/sys/room-merges/mg1*', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', headers: { etag: '"2"' }, body: JSON.stringify(MERGE) }),
  );
  await page.route('**/api/session/sys/room-moves/mv1?*', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', headers: { etag: '"4"' }, body: JSON.stringify(MOVE) }),
  );
  await page.route('**/api/session/sys/room-moves/mv1', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', headers: { etag: '"4"' }, body: JSON.stringify(MOVE) }),
  );
  await page.route('**/api/session/sys/auth/pin/verify', (route) =>
    fulfillJson(route, 200, JSON.stringify({ pinToken: 'synthetic-pin-token-0001', expiresAt: '2026-11-10T01:00:00.000Z' })),
  );
}

async function expectNoBlockingViolations(page: Page): Promise<void> {
  const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
  const blocking = results.violations.filter((item) => item.impact === 'serious' || item.impact === 'critical');
  expect(blocking.map((item) => item.id)).toEqual([]);
}

test.describe('SCR-45/46 ghép phòng và walk-out (HB-137)', () => {
  test('browser_keyboard_a11y_responsive', async ({ page, request }) => {
    await loginRefundStaff(page, request, 'FRONT_DESK');
    const spy: Spy = { keys: [], matches: [], bodies: [] };
    await common(page);
    await page.route('**/api/session/sys/room-moves/mv1/compensation-payments*', (route) =>
      fulfillJson(route, 200, JSON.stringify({ roomMoveId: 'mv1', approvedAmount: 300000, payments: [] })),
    );
    await page.route('**/api/session/sys/room-merges/mg1/consent', (route) => {
      const headers = route.request().headers();
      spy.keys.push(headers['idempotency-key'] ?? '');
      spy.matches.push(headers['if-match']);
      spy.bodies.push(route.request().postData() ?? '');
      return fulfillJson(route, 200, JSON.stringify(MERGE));
    });
    await page.goto('/overbooking/merge-walkout?mergeId=mg1&moveId=mv1');
    await expect(page.getByTestId('hb137-discount')).toContainText('Chiết khấu 20% = 290800 VND');
    await expect(page.getByTestId('hb137-merge-status')).toContainText('PENDING_CONSENT');
    await expect(page.getByTestId('hb137-walk')).toContainText('Chứng từ: WO-001');
    await expect(page.getByTestId('hb137-pay-submit')).toHaveCount(0);
    await expectNoBlockingViolations(page);

    // Bàn phím: mở hộp thoại đồng thuận, URL tuỳ ý bị chặn theo trường, Escape trả focus về nút mở.
    await page.getByTestId('hb137-consent').focus();
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('hb137-dialog-consent')).toBeVisible();
    await page.getByRole('textbox', { name: /Mã tệp bằng chứng/ }).fill('https://example.com/x');
    await page.getByTestId('hb137-dialog-consent-confirm').focus();
    await page.keyboard.press('Enter');
    await expect(page.locator('#hb137-consentEvidence-error')).toContainText('không nhập URL');
    expect(spy.keys).toHaveLength(0);
    await expectNoBlockingViolations(page);
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('hb137-dialog-consent')).toBeHidden();
    await expect(page.getByTestId('hb137-consent')).toBeFocused();

    // Gửi đồng thuận: khoá UUIDv4 + If-Match theo ETag đã đọc; chỉ trạng thái máy chủ mới đổi.
    await page.keyboard.press('Enter');
    await page.getByRole('textbox', { name: /Mã tệp bằng chứng/ }).fill('file-001');
    await page.getByTestId('hb137-dialog-consent-confirm').focus();
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('hb137-done')).toBeVisible();
    expect(spy.keys).toHaveLength(1);
    expect(spy.keys[0]).toMatch(UUID_V4);
    expect(spy.matches[0]).toBe('"2"');
    expect(spy.bodies[0]).toContain('"side":"PRIMARY"');
    await expect(page.getByTestId('hb137-merge-status')).toContainText('PENDING_CONSENT');
    await expectNoBlockingViolations(page);

    await page.setViewportSize({ width: 360, height: 800 });
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
  });

  test('chi bồi thường: timeout giữ nguyên khoá, không mở khoản chi mới', async ({ page, request }) => {
    await loginRefundStaff(page, request, 'ACCOUNTANT');
    const spy: Spy = { keys: [], matches: [], bodies: [] };
    await common(page);
    let paid = false;
    await page.route('**/api/session/sys/room-moves/mv1/compensation-payments*', async (route) => {
      if (route.request().method() === 'GET')
        return fulfillJson(route, 200, JSON.stringify({ roomMoveId: 'mv1', approvedAmount: 300000, payments: paid ? [PAYMENT] : [] }));
      const headers = route.request().headers();
      spy.keys.push(headers['idempotency-key'] ?? '');
      spy.matches.push(headers['if-match']);
      spy.bodies.push(route.request().postData() ?? '');
      if (spy.keys.length <= 2) return route.abort('failed');
      paid = true;
      return fulfillJson(route, 201, JSON.stringify(PAYMENT));
    });
    await page.goto('/overbooking/merge-walkout?moveId=mv1');
    await expect(page.getByTestId('hb137-pay')).toContainText('Số tiền đã duyệt: 300000 VND');
    await page.getByTestId('hb137-pay-submit').click();
    const dialog = page.getByTestId('hb137-dialog-pay');
    await dialog.getByRole('textbox', { name: 'Ghi chú' }).fill('Chi tiền mặt có biên nhận');
    await dialog.getByLabel('PIN (6 chữ số)').fill('123456');
    await page.getByTestId('hb137-dialog-pay-confirm').click();
    await expect(page.getByTestId('hb137-failure')).toContainText('Chưa biết lệnh đã được áp dụng');
    await page.getByRole('button', { name: 'Gửi lại cùng lệnh' }).click();
    await expect(page.getByTestId('hb137-done')).toBeVisible();
    await expect(page.getByTestId('hb137-payment-pay-1')).toContainText('SUCCEEDED');
    expect(new Set(spy.keys).size).toBe(1);
    expect(spy.keys[0]).toMatch(UUID_V4);
    expect(new Set(spy.matches)).toEqual(new Set(['"4"']));
    expect(new Set(spy.bodies).size).toBe(1);
    expect(spy.bodies[0]).not.toContain('123456');
    expect(spy.bodies[0]).not.toContain('amount');
    await expect(page.getByTestId('hb137-pay-submit')).toHaveCount(0);
  });
});
