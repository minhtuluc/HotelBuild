import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page, type Route } from '@playwright/test';
import { fulfillJson, listBody } from '../operations-web/fake-api';
import { operationsWebOnly } from '../operations-web/guard';
import { loginRefundStaff } from '../operations-web/refund-fixture';

/**
 * SCR-43 (HB-135) trên API giả của BFF. Chỉ chứng minh giao diện; nghiệm thu nghiệp vụ cần API thật,
 * seed quá tải và bằng chứng HB-194. Mọi dữ liệu là tổng hợp, không có PII/PIN/token.
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
const ROOM_TYPE = {
  id: 'rt1',
  propertyId: 'journey-standard',
  code: 'DOR',
  capacityAdults: 1,
  capacityChildren: 0,
  basePrice: 100000,
  minPrice: 100000,
  maxPrice: 100000,
  allowShared: true,
  bedCount: 6,
  version: 1,
};
const LADDER = [
  { step: 1, moveType: 'SAME_TYPE_SAME_PROPERTY', feasible: true, candidateCount: 2 },
  { step: 2, moveType: 'UPGRADE_SAME_PROPERTY', feasible: true, candidateCount: 1 },
  { step: 3, moveType: 'SAME_TYPE_CROSS_PROPERTY', feasible: false, candidateCount: 0, note: 'Khác thành phố' },
  { step: 4, moveType: 'WALK_OUT', feasible: true, candidateCount: 1 },
];
const CASE = {
  id: 'k1',
  propertyId: 'journey-standard',
  date: '2026-11-20',
  roomTypeId: 'rt1',
  roomTypeCode: 'DOR',
  shortageCount: 2,
  status: 'ESCALATED',
  detectedAt: '2026-11-10T00:00:00.000Z',
  resolveDeadline: '2026-11-19T07:00:00.000Z',
  escalatedAt: '2026-11-19T07:00:00.000Z',
  overdue: true,
  resolvedAt: null,
  resolvedBy: null,
  resolutionSource: null,
  delayReason: 'Chờ khách',
  affectedBookingIds: ['bk-1'],
  ladderPreview: LADDER,
  version: 3,
};
const SCAN = {
  scanStatus: 'OK',
  lastSuccessfulScanAt: '2026-11-10T01:00:00.000Z',
  nextScanAt: '2026-11-10T01:05:00.000Z',
  scannedThrough: '2026-12-10',
};
const RESOLVED = {
  caseId: 'k1',
  status: 'RESOLVED',
  resolutionSource: 'USER',
  resolvedBy: 'u1',
  resolvedAt: '2026-11-10T02:00:00.000Z',
  resolutionNote: 'Đã xử lý',
  auditLogId: 'a1',
};
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

operationsWebOnly();
test.beforeEach(async ({ page, request }) => {
  await loginRefundStaff(page, request, 'OWNER');
});

interface Spy {
  keys: string[];
  matches: (string | undefined)[];
  bodies: string[];
}

function caseList(rows: unknown[]) {
  return JSON.stringify({
    data: rows,
    meta: { limit: 20, nextCursor: null, hasMore: false, total: rows.length, overdueCount: rows.length, scan: SCAN },
  });
}

async function backend(page: Page, onResolve?: (route: Route, calls: number) => Promise<void>): Promise<Spy> {
  const spy: Spy = { keys: [], matches: [], bodies: [] };
  await page.route('**/api/session/sys/properties*', (route) => fulfillJson(route, 200, listBody([PROPERTY])));
  await page.route('**/api/session/sys/room-types*', (route) => fulfillJson(route, 200, listBody([ROOM_TYPE])));
  await page.route('**/api/session/sys/overbooking-cases*', (route) => fulfillJson(route, 200, caseList([CASE])));
  await page.route('**/api/session/sys/overbooking-cases/k1/resolve', async (route) => {
    const headers = route.request().headers();
    spy.keys.push(headers['idempotency-key'] ?? '');
    spy.matches.push(headers['if-match']);
    spy.bodies.push(route.request().postData() ?? '');
    if (onResolve !== undefined) return onResolve(route, spy.keys.length);
    return fulfillJson(route, 200, JSON.stringify(RESOLVED));
  });
  return spy;
}

async function expectNoBlockingViolations(page: Page): Promise<void> {
  const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
  const blocking = results.violations.filter((item) => item.impact === 'serious' || item.impact === 'critical');
  expect(blocking.map((item) => item.id)).toEqual([]);
}

test.describe('SCR-43 bảng điều khiển quá tải (HB-135)', () => {
  test('browser_keyboard_a11y_responsive', async ({ page }) => {
    const spy = await backend(page);
    await page.goto('/overbooking/cases');
    await expect(page.getByTestId('hb135-row-k1')).toContainText('Đã leo thang (ESCALATED)');
    await expect(page.getByTestId('hb135-row-k1')).toContainText('QUÁ HẠN');
    await expect(page.getByTestId('hb135-scan')).toContainText('thành công');
    await expect(page.getByTestId('hb135-row-k1').getByRole('link')).toHaveAttribute(
      'href',
      '/overbooking/relocation?caseId=k1',
    );
    await expectNoBlockingViolations(page);

    // Bàn phím: mở hộp thoại, kiểm lỗi trường, Escape trả focus về nút đã mở nó.
    await page.getByTestId('hb135-resolve-k1').focus();
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('hb135-dialog-resolve')).toBeVisible();
    await page.getByTestId('hb135-dialog-resolve-confirm').focus();
    await page.keyboard.press('Enter');
    await expect(page.locator('#hb135-resolutionNote-error')).toContainText('Bắt buộc nhập');
    expect(spy.keys).toHaveLength(0);
    await expectNoBlockingViolations(page);
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('hb135-dialog-resolve')).toBeHidden();
    await expect(page.getByTestId('hb135-resolve-k1')).toBeFocused();

    // Gửi lệnh: khoá UUIDv4 và If-Match theo phiên bản đã đọc.
    await page.keyboard.press('Enter');
    await page.getByRole('textbox', { name: 'Ghi chú đóng ca' }).fill('Đã xử lý');
    await page.getByTestId('hb135-dialog-resolve-confirm').focus();
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('hb135-done')).toBeVisible();
    expect(spy.keys).toHaveLength(1);
    expect(spy.keys[0]).toMatch(UUID_V4);
    expect(spy.matches[0]).toBe('"3"');
    expect(spy.bodies[0]).toBe('{"resolutionNote":"Đã xử lý"}');
    await expectNoBlockingViolations(page);

    await page.setViewportSize({ width: 360, height: 800 });
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
  });

  test('quá hạn giữ ca và báo leo thang; kết quả chưa rõ giữ nguyên khoá', async ({ page }) => {
    const spy = await backend(page, async (route, calls) => {
      if (calls === 1) return fulfillJson(route, 409, JSON.stringify({ code: 'E_OVER_CASE_DEADLINE_PASSED', message: 'x', traceId: 't1', timestamp: '2026-11-10T00:00:00.000Z', path: '/' }));
      if (calls <= 3) return route.abort('failed');
      return fulfillJson(route, 200, JSON.stringify(RESOLVED));
    });
    await page.goto('/overbooking/cases');
    await page.getByTestId('hb135-resolve-k1').click();
    await page.getByRole('textbox', { name: 'Ghi chú đóng ca' }).fill('Đóng muộn');
    await page.getByTestId('hb135-dialog-resolve-confirm').click();
    await expect(page.getByTestId('hb135-failure')).toContainText('leo thang và xử lý tại chỗ');
    await expect(page.getByTestId('hb135-row-k1')).toBeVisible();
    // Lệnh mới sau lỗi chắc chắn; rồi mất mạng: gửi lại giữ nguyên khoá.
    await page.getByTestId('hb135-resolve-k1').click();
    await page.getByRole('textbox', { name: 'Ghi chú đóng ca' }).fill('Đóng muộn');
    await page.getByTestId('hb135-dialog-resolve-confirm').click();
    await expect(page.getByTestId('hb135-failure')).toContainText('Chưa biết lệnh đã được áp dụng');
    await page.getByRole('button', { name: 'Gửi lại cùng lệnh' }).click();
    await expect(page.getByTestId('hb135-done')).toBeVisible();
    const retried = spy.keys.slice(1);
    expect(new Set(retried).size).toBe(1);
    expect(retried.length).toBeGreaterThanOrEqual(3);
    expect(new Set(spy.matches).size).toBe(1);
  });
});
