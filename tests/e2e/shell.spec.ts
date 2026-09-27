import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

const HEALTH = '**/api/v1/system/health';

const errorEnvelope = (code: string, traceId: string) =>
  JSON.stringify({
    code,
    message: 'Không khả dụng',
    traceId,
    timestamp: '2026-10-01T00:00:00.000Z',
    path: '/api/v1/system/health',
  });

test.describe('shell gọi API qua client dùng chung (F0-08)', () => {
  test('hiện trạng thái thành công khi máy chủ trả lời', async ({ page }) => {
    await page.route(HEALTH, (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ status: 'ok' }) }),
    );
    await page.goto('/');
    await expect(page.getByTestId('api-probe-ok')).toBeVisible();
  });

  test('hiện trạng thái lỗi kèm mã lỗi và mã tham chiếu khi máy chủ trả 500', async ({ page }) => {
    await page.route(HEALTH, (route) =>
      route.fulfill({
        status: 500,
        contentType: 'application/json',
        body: errorEnvelope('E_GEN_SERVICE_UNAVAILABLE', 'trace-500'),
      }),
    );
    await page.goto('/');
    const failure = page.getByTestId('api-probe-error');
    await expect(failure).toBeVisible();
    await expect(failure).toContainText('E_GEN_SERVICE_UNAVAILABLE');
    await expect(failure).toContainText('trace-500');
  });

  test('403 trên endpoint công khai dẫn tới trạng thái thiếu quyền', async ({ page }) => {
    await page.route(HEALTH, (route) =>
      route.fulfill({ status: 403, contentType: 'application/json', body: errorEnvelope('E_RBAC_FORBIDDEN', 'trace-403') }),
    );
    await page.goto('/');
    await expect(page.getByTestId('api-probe-forbidden')).toBeVisible();
  });

  test('tuyến thiếu quyền tồn tại, có đường quay lại và không lộ chi tiết', async ({ page }) => {
    await page.goto('/access-denied');
    const panel = page.getByTestId('access-denied');
    await expect(panel).toBeVisible();
    await expect(panel).not.toContainText(/CS-0\d|booking|@/);
    await expect(panel.getByRole('link')).toHaveAttribute('href', '/');
  });

  test('màn hình thiếu quyền không có vi phạm axe serious/critical', async ({ page }) => {
    await page.goto('/access-denied');
    const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
    const blocking = results.violations.filter(
      (violation) => violation.impact === 'serious' || violation.impact === 'critical',
    );
    expect(blocking.map((violation) => violation.id)).toEqual([]);
  });
});
