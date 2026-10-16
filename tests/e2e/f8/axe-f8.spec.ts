import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { installCrmApi } from '../fake-api/f8/crm';
import { installNotiApi } from '../fake-api/f8/notifications';
import { installReportApi } from '../fake-api/f8/reports';
import { operationsWebOnly } from '../operations-web/guard';

/**
 * HB-172 — axe trên **các màn F8** (báo cáo REP, thông báo, CRM) của operations-web. Bổ sung cho
 * `a11y.spec.ts` (chỉ quét màn khung + 10 trạng thái). Dùng API giả F8 để màn hình render được trạng
 * thái đầy đủ mà không cần backend; chạy ở cả Chromium và WebKit qua `E2E_BROWSERS`.
 *
 * Cổng: **0 vi phạm serious/critical** (NFR-USE-04/TC-A11Y).
 */
operationsWebOnly();

const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];

interface Screen {
  readonly name: string;
  readonly path: string;
  readonly ready: string;
  readonly install: (page: Page) => unknown;
}

const SCREENS: readonly Screen[] = [
  { name: 'SCR-52 công suất', path: '/reports/occupancy', ready: 'occupancy-row-2026-12-24', install: installReportApi },
  // SCR-52 ADR/RevPAR nằm cùng màn công suất (`/reports/occupancy`), không có tuyến riêng.
  { name: 'SCR-52 ADR/RevPAR', path: '/reports/occupancy', ready: 'adr-row-2026-12-24', install: installReportApi },
  { name: 'SCR-53 doanh thu theo kênh', path: '/reports/revenue-by-channel', ready: 'revenue-total', install: installReportApi },
  { name: 'SCR-54 huỷ & hoàn', path: '/reports/cancellations', ready: 'cancel-summary', install: installReportApi },
  { name: 'SCR-55 quá tải', path: '/reports/overbooking', ready: 'overbooking-summary', install: installReportApi },
  { name: 'SCR-51 hàng đợi thông báo', path: '/noti/notifications', ready: 'noti-table', install: installNotiApi },
  { name: 'SCR-49 hồ sơ khách', path: '/crm/guests', ready: 'guests-table', install: installCrmApi },
];

test.describe('axe trên màn F8 (WCAG 2.1 AA)', () => {
  for (const screen of SCREENS) {
    test(`${screen.name} không có vi phạm serious/critical`, async ({ page }) => {
      screen.install(page);
      await page.goto(screen.path);
      await expect(page.getByTestId(screen.ready)).toBeVisible();
      const results = await new AxeBuilder({ page }).withTags(TAGS).analyze();
      const violations = results.violations.filter(
        (violation) => violation.impact === 'serious' || violation.impact === 'critical',
      );
      expect(violations.map((violation) => `${violation.id}:${violation.nodes.length}`)).toEqual([]);
    });
  }
});
