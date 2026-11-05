import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page, type Route } from '@playwright/test';
import { fulfillJson, listBody } from '../operations-web/fake-api';
import { operationsWebOnly } from '../operations-web/guard';
import { loginRefundStaff } from '../operations-web/refund-fixture';

/**
 * SCR-41 (HB-133) trên API giả của BFF. Chỉ chứng minh giao diện; nghiệm thu nghiệp vụ cần API thật,
 * simulator và bằng chứng HB-194. Mọi dữ liệu là tổng hợp, không có PII/PIN/token.
 */
const CHANNEL = {
  id: 'c1',
  code: 'OTA_BOOKING',
  name: 'Synthetic OTA',
  multiplier: 1,
  commissionPct: 15,
  holdMinutes: 30,
  overbookAllowed: false,
  version: 1,
};
const STATUS = {
  channelId: 'c1',
  syncStatus: 'DEGRADED',
  consecutiveFailures: 3,
  lastSyncAt: '2026-11-10T01:00:00.000Z',
  lastSuccessAt: '2026-11-09T01:00:00.000Z',
  lastVerifiedAt: null,
  lastError: 'Synthetic upstream timeout',
  history: [{ at: '2026-11-10T01:00:00.000Z', outcome: 'FAILURE', error: 'Synthetic upstream timeout' }],
};
const DELIVERY = {
  id: 'd1',
  eventId: 'e1',
  eventType: 'inventory.changed',
  consumerKey: 'channel-sync',
  status: 'DEAD_LETTER',
  attempts: 5,
  lastError: 'E_CHAN_SYNC_FAILED',
  nextAttemptAt: null,
  createdAt: '2026-11-10T00:00:00.000Z',
  processedAt: null,
};
const ACCEPTED = { operationId: 'op1', status: 'PENDING', statusUrl: '/api/v1/operations/op1' };
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

operationsWebOnly();
test.beforeEach(async ({ page, request }) => {
  await loginRefundStaff(page, request, 'OWNER');
});

interface Spy {
  syncKeys: string[];
  syncBodies: string[];
  retryKeys: string[];
  polls: number;
}

async function backend(page: Page, onSync?: (route: Route, calls: number) => Promise<void>): Promise<Spy> {
  const spy: Spy = { syncKeys: [], syncBodies: [], retryKeys: [], polls: 0 };
  const json = (route: Route, status: number, body: unknown) => fulfillJson(route, status, JSON.stringify(body));
  await page.route('**/api/session/sys/channels*', (route) => fulfillJson(route, 200, listBody([CHANNEL])));
  await page.route('**/api/session/sys/channels/c1/sync-status', (route) => json(route, 200, STATUS));
  await page.route('**/api/session/sys/channels/c1/outbox-deliveries*', (route) =>
    fulfillJson(route, 200, listBody([DELIVERY])),
  );
  await page.route('**/api/session/sys/channels/c1/outbox-deliveries/d1/retry', (route) => {
    spy.retryKeys.push(route.request().headers()['idempotency-key'] ?? '');
    return json(route, 202, ACCEPTED);
  });
  await page.route('**/api/session/sys/channels/c1/sync', async (route) => {
    spy.syncKeys.push(route.request().headers()['idempotency-key'] ?? '');
    spy.syncBodies.push(route.request().postData() ?? '');
    if (onSync !== undefined) return onSync(route, spy.syncKeys.length);
    return json(route, 202, ACCEPTED);
  });
  await page.route('**/api/session/sys/operations/op1', (route) => {
    spy.polls += 1;
    const status = spy.polls < 2 ? 'RUNNING' : 'SUCCEEDED';
    return json(route, 200, { operationId: 'op1', status });
  });
  return spy;
}

async function expectNoBlockingViolations(page: Page): Promise<void> {
  const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
  const blocking = results.violations.filter((item) => item.impact === 'serious' || item.impact === 'critical');
  expect(blocking.map((item) => item.id)).toEqual([]);
}

test.describe('SCR-41 giám sát đồng bộ (HB-133)', () => {
  test('browser_keyboard_a11y_responsive', async ({ page }) => {
    const spy = await backend(page);
    await page.goto('/channels/sync');
    await expect(page.getByTestId('hb133-status')).toContainText('DEGRADED');
    await expect(page.getByTestId('hb133-status')).toContainText('(máy chủ đếm): 3');
    await expect(page.getByTestId('hb133-deliveries')).toContainText('inventory.changed');
    await expectNoBlockingViolations(page);

    // Bàn phím: mở hộp thoại đồng bộ, Escape trả focus về nút mở; xác nhận bằng Enter.
    await page.getByTestId('hb133-sync-submit').focus();
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('hb133-dialog-sync')).toBeVisible();
    await expectNoBlockingViolations(page);
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('hb133-dialog-sync')).toBeHidden();
    await expect(page.getByTestId('hb133-sync-submit')).toBeFocused();
    await page.keyboard.press('Enter');
    await page.getByTestId('hb133-dialog-sync-confirm').focus();
    await page.keyboard.press('Enter');
    // 202: "đang chờ/đang chạy" không phải "đã đồng bộ"; chỉ SUCCEEDED của máy chủ mới là xong.
    await expect(page.getByTestId('hb133-operation')).toContainText('chưa phải đã đồng bộ');
    await expect(page.getByTestId('hb133-operation')).toContainText('hoàn tất', { timeout: 15_000 });
    expect(spy.syncKeys).toHaveLength(1);
    expect(spy.syncKeys[0]).toMatch(UUID_V4);
    expect(spy.syncBodies[0]).toBe('{"scope":"FULL"}');

    // Đẩy lại bản tin: hộp thoại, focus trả về, một lệnh với khoá UUIDv4.
    await page.getByTestId('hb133-replay-d1').focus();
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('hb133-dialog-replay')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('hb133-replay-d1')).toBeFocused();
    await page.keyboard.press('Enter');
    await page.getByTestId('hb133-dialog-replay-confirm').focus();
    await page.keyboard.press('Enter');
    await expect.poll(() => spy.retryKeys.length).toBe(1);
    expect(spy.retryKeys[0]).toMatch(UUID_V4);
    await expectNoBlockingViolations(page);

    await page.setViewportSize({ width: 360, height: 800 });
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
  });

  test('kết quả chưa rõ giữ nguyên khoá khi gửi lại', async ({ page }) => {
    const spy = await backend(page, async (route, calls) => {
      if (calls <= 2) return route.abort('failed');
      return fulfillJson(route, 202, JSON.stringify(ACCEPTED));
    });
    await page.goto('/channels/sync');
    await page.getByTestId('hb133-sync-submit').click();
    await page.getByTestId('hb133-dialog-sync-confirm').click();
    await expect(page.getByTestId('hb133-failure')).toContainText('Chưa biết lệnh đã được nhận');
    await page.getByRole('button', { name: 'Gửi lại cùng lệnh' }).click();
    await expect(page.getByTestId('hb133-operation')).toBeVisible();
    expect(new Set(spy.syncKeys).size).toBe(1);
    expect(new Set(spy.syncBodies).size).toBe(1);
    expect(spy.syncKeys.length).toBeGreaterThanOrEqual(3);
  });
});
