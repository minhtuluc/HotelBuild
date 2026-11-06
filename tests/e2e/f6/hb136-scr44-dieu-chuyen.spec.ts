import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { fulfillJson } from '../operations-web/fake-api';
import { operationsWebOnly } from '../operations-web/guard';
import { loginRefundStaff } from '../operations-web/refund-fixture';

/**
 * SCR-44 (HB-136) trên API giả của BFF. Chỉ chứng minh giao diện; nghiệm thu nghiệp vụ cần API thật,
 * seed quá tải và bằng chứng HB-194. Mọi dữ liệu là tổng hợp, không có PII/PIN/token thật.
 */
const LADDER = [
  { step: 1, moveType: 'SAME_TYPE_SAME_PROPERTY', feasible: true, candidateCount: 2 },
  { step: 2, moveType: 'UPGRADE_SAME_PROPERTY', feasible: true, candidateCount: 1 },
  { step: 3, moveType: 'SAME_TYPE_CROSS_PROPERTY', feasible: false, candidateCount: 0, note: 'Cơ sở cách nhau 160–300 km' },
  { step: 4, moveType: 'WALK_OUT', feasible: true, candidateCount: 1 },
];
const candidate = (rank: number, name: string, total: number) => ({
  rank,
  bookingId: `bk-${rank}`,
  bookingRoomId: `br-${rank}`,
  bookingSeq: String(100 + rank),
  guestNameMasked: name,
  channelCode: 'WEB',
  status: 'CONFIRMED',
  checkIn: '2026-11-20',
  checkOut: '2026-11-22',
  nights: 2,
  adults: 2,
  children: 0,
  keepScore: { total, loyaltyTier: total - 14, payment: 10, nights: 4, returningGuest: 0, arrived: 0 },
  priorityGroup: rank === 1 ? 'WEAK' : 'STRONG',
  createdAt: '2026-11-01T00:00:00.000Z',
  paidAmount: 100000,
  depositAmount: 100000,
  totalAmount: 500000,
});
const CASE = {
  id: 'k1',
  propertyId: 'journey-standard',
  date: '2026-11-20',
  roomTypeId: 'rt1',
  roomTypeCode: 'DOR',
  shortageCount: 2,
  status: 'OPEN',
  detectedAt: '2026-11-10T00:00:00.000Z',
  resolveDeadline: '2026-11-19T07:00:00.000Z',
  escalatedAt: null,
  overdue: false,
  resolvedAt: null,
  resolvedBy: null,
  resolutionSource: null,
  delayReason: null,
  affectedBookingIds: ['bk-1'],
  ladderPreview: LADDER,
  version: 3,
  candidates: [candidate(1, 'A*** B', 40), candidate(2, 'C*** D', 55)],
  history: [],
};
const move = (overrides: Record<string, unknown> = {}) => ({
  id: 'mv1',
  overbookingCaseId: 'k1',
  bookingId: 'bk-1',
  bookingRoomId: 'br-1',
  moveType: 'SAME_TYPE_SAME_PROPERTY',
  fromRoomId: 'room-1',
  toRoomId: 'room-9',
  fromPropertyId: 'journey-standard',
  toPropertyId: 'journey-standard',
  reason: 'Quá tải',
  keepScore: 40,
  priceLocked: true,
  compensationAmount: 300000,
  transportCost: 50000,
  consent: { granted: true, channel: 'PHONE' },
  approvedBy: null,
  approvedAt: null,
  status: 'PROPOSED',
  assignmentIds: [],
  walkOut: null,
  createdAt: '2026-11-10T00:00:00.000Z',
  updatedAt: '2026-11-10T00:00:00.000Z',
  version: 3,
  ...overrides,
});
const OPTIONS = {
  bookingId: 'bk-1',
  overbookingCaseId: 'k1',
  date: '2026-11-20',
  options: [
    { moveType: 'SAME_TYPE_SAME_PROPERTY', feasible: true, targetPropertyId: 'journey-standard', targetRoomId: 'room-9', targetRoomTypeId: 'rt1', priceLocked: true, compensationAmount: 0, transportCost: 0 },
  ],
  generatedAt: '2026-11-10T00:00:00.000Z',
  writeIntent: null,
};
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

operationsWebOnly();

interface Spy {
  keys: string[];
  matches: (string | undefined)[];
  bodies: string[];
}

function moveRoute(page: Page, actions: string[], status: () => string) {
  return page.route('**/api/session/sys/room-moves/mv1*', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      headers: { etag: '"3"' },
      body: JSON.stringify({ ...move({ status: status() }), allowedActions: actions, writeIntent: null }),
    }),
  );
}

async function pinRoute(page: Page): Promise<void> {
  await page.route('**/api/session/sys/auth/pin/verify', (route) =>
    fulfillJson(route, 200, JSON.stringify({ pinToken: 'synthetic-pin-token-0001', expiresAt: '2026-11-10T01:00:00.000Z' })),
  );
}

async function expectNoBlockingViolations(page: Page): Promise<void> {
  const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
  const blocking = results.violations.filter((item) => item.impact === 'serious' || item.impact === 'critical');
  expect(blocking.map((item) => item.id)).toEqual([]);
}

test.describe('SCR-44 điều chuyển (HB-136)', () => {
  test('browser_keyboard_a11y_responsive', async ({ page, request }) => {
    await loginRefundStaff(page, request, 'MANAGER');
    const spy: Spy = { keys: [], matches: [], bodies: [] };
    let status = 'PROPOSED';
    await page.route('**/api/session/sys/overbooking-cases/k1*', (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', headers: { etag: '"3"' }, body: JSON.stringify(CASE) }),
    );
    await moveRoute(page, status === 'PROPOSED' ? ['APPROVE'] : [], () => status);
    await pinRoute(page);
    await page.route('**/api/session/sys/room-moves/mv1/approve', (route) => {
      const headers = route.request().headers();
      spy.keys.push(headers['idempotency-key'] ?? '');
      spy.matches.push(headers['if-match']);
      spy.bodies.push(route.request().postData() ?? '');
      status = 'APPROVED';
      return fulfillJson(route, 200, JSON.stringify(move({ status: 'APPROVED', approvedBy: 'u1' })));
    });
    await page.goto('/overbooking/relocation?caseId=k1&moveId=mv1');
    await expect(page.getByTestId('hb136-candidates')).toContainText('A*** B');
    await expect(page.getByTestId('hb136-candidates')).toContainText('C*** D');
    await expect(page.getByTestId('hb136-step-3')).toContainText('Không khả dụng: Cơ sở cách nhau 160–300 km');
    await expect(page.getByTestId('hb136-move-status')).toContainText('PROPOSED');
    await expectNoBlockingViolations(page);

    // Bàn phím: mở hộp thoại duyệt, PIN sai hình dạng báo lỗi trường, Escape trả focus về nút mở.
    await page.getByTestId('hb136-approve').focus();
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('hb136-dialog-approve')).toBeVisible();
    await page.getByTestId('hb136-dialog-approve-confirm').focus();
    await page.keyboard.press('Enter');
    await expect(page.locator('#hb136-approvePin-error')).toContainText('PIN gồm đúng 6 chữ số');
    expect(spy.keys).toHaveLength(0);
    await expectNoBlockingViolations(page);
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('hb136-dialog-approve')).toBeHidden();
    await expect(page.getByTestId('hb136-approve')).toBeFocused();

    // Duyệt: khoá UUIDv4 + If-Match theo ETag đã đọc; PIN không nằm trong thân lệnh.
    await page.keyboard.press('Enter');
    await page.getByTestId('hb136-dialog-approve').getByLabel('PIN (6 chữ số)').fill('123456');
    await page.getByTestId('hb136-dialog-approve-confirm').focus();
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('hb136-done')).toBeVisible();
    await expect(page.getByTestId('hb136-move-status')).toContainText('APPROVED');
    expect(spy.keys).toHaveLength(1);
    expect(spy.keys[0]).toMatch(UUID_V4);
    expect(spy.matches[0]).toBe('"3"');
    expect(spy.bodies[0]).not.toContain('123456');
    expect(spy.bodies[0]).toContain('"compensationAmount":300000');
    await expect(page.getByTestId('hb136-move')).toContainText('Chưa hoàn tất');
    await expectNoBlockingViolations(page);

    await page.setViewportSize({ width: 360, height: 800 });
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
  });

  test('phòng đích bị lấy khi thực hiện: giữ nguồn, không tự thử bậc sau', async ({ page, request }) => {
    await loginRefundStaff(page, request, 'FRONT_DESK');
    let executes = 0;
    await page.route('**/api/session/sys/bookings/bk-1/relocation-options*', (route) =>
      fulfillJson(route, 200, JSON.stringify(OPTIONS)),
    );
    await moveRoute(page, ['EXECUTE'], () => 'APPROVED');
    await pinRoute(page);
    await page.route('**/api/session/sys/room-moves/mv1/execute', (route) => {
      executes += 1;
      return fulfillJson(
        route,
        409,
        JSON.stringify({ code: 'E_INV_ROOM_TAKEN', message: 'x', traceId: 't-9', timestamp: '2026-11-10T00:00:00.000Z', path: '/' }),
      );
    });
    await page.goto('/overbooking/relocation?caseId=k1&bookingId=bk-1&bookingRoomId=br-1&moveId=mv1');
    await expect(page.getByTestId('hb136-options')).toContainText('room-9');
    await expect(page.getByTestId('hb136-candidates')).toHaveCount(0);
    await page.getByTestId('hb136-execute').click();
    await page.getByTestId('hb136-dialog-execute').getByLabel('PIN (6 chữ số)').fill('123456');
    await page.getByTestId('hb136-dialog-execute-confirm').click();
    await expect(page.getByTestId('hb136-failure')).toContainText('Phòng đích đã bị lấy');
    await expect(page.getByTestId('hb136-failure')).toContainText('t-9');
    await expect(page.getByTestId('hb136-move')).toContainText('room-1');
    expect(executes).toBe(1);
  });
});
