import AxeBuilder from '@axe-core/playwright';
import { expect, test } from './operations-web/staff-session';

/** 10 trạng thái của hợp đồng §8.1, phủ bởi tuyến `?state=` trên cả hai web app. */
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

test.describe('axe trên màn hình khung (WCAG 2.1 AA)', () => {
  test('trang chủ không có vi phạm serious/critical', async ({ page }) => {
    await page.goto('/');
    const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
    const blocking = results.violations.filter(
      (violation) => violation.impact === 'serious' || violation.impact === 'critical',
    );
    expect(blocking).toEqual([]);
  });

  for (const state of STATES) {
    test(`trạng thái ${state} không có vi phạm serious/critical`, async ({ page }) => {
      await page.goto(`/states?state=${state}`);
      const results = await new AxeBuilder({ page })
        .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
        .analyze();
      const blocking = results.violations.filter(
        (violation) => violation.impact === 'serious' || violation.impact === 'critical',
      );
      expect(blocking.map((violation) => violation.id)).toEqual([]);
    });
  }
});

test('bề mặt đọc được cấu hình API và vẫn sống khi chưa nối backend', async ({ request }) => {
  const response = await request.get('/api/ready');
  expect(response.status()).toBe(200);
  expect(await response.json()).toMatchObject({ status: 'ok' });
});

test('không cuộn ngang ở 360 px (NFR-USE-04)', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 800 });
  await page.goto('/');
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
});
