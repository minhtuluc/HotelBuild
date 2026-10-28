import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { baselineKeys, loadBaseline } from './baseline';
import { installFixture, resolvePath } from './fixtures';
import { printCatalog, recordScreenResult, type ObservedViolation } from './results';
import {
  BLOCKED_SCREENS,
  SCANNABLE_SCREENS,
  SCREENS,
  TOTAL_SCREENS,
  projectFor,
  type Screen,
} from './screens';

/**
 * HB-185 — quét axe trên **toàn bộ** danh mục 83 màn của thiết kế.
 *
 * - Màn `scannable` chạy trên project tương ứng (customer-web / operations-web, Chromium).
 * - Màn `blocked` gọi `test.skip()` với lý do đọc từ bảng — không bỏ qua âm thầm — và vẫn được đếm
 *   trong dòng tổng kết 83 màn.
 * - Cổng: chỉ đỏ khi có vi phạm serious/critical **mới** so với `baseline.json`; không nới tiêu chí,
 *   không tắt rule.
 */
const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'] as const;
const READY_TIMEOUT_MS = 20_000;

test.describe('HB-185 danh mục 83 màn', () => {
  test('bảng đủ 83 màn, phân loại quét được / BLOCKED có lý do', () => {
    printCatalog();
    expect(SCREENS, 'danh mục thiết kế có 83 màn').toHaveLength(TOTAL_SCREENS);
    expect(new Set(SCREENS.map((screen) => screen.id)).size, 'mã SCR không trùng').toBe(TOTAL_SCREENS);
    expect(SCANNABLE_SCREENS.length + BLOCKED_SCREENS.length).toBe(TOTAL_SCREENS);
    for (const screen of SCREENS) {
      if (screen.status === 'blocked') {
        expect(screen.reason, `${screen.id} BLOCKED phải nêu lý do`).toBeTruthy();
        expect(screen.reason?.trim().length ?? 0, `${screen.id} lý do quá ngắn`).toBeGreaterThan(10);
        continue;
      }
      expect(screen.path, `${screen.id} thiếu đường dẫn`).toBeTruthy();
      expect(screen.ready, `${screen.id} thiếu selector sẵn sàng`).toBeTruthy();
      expect(projectFor(screen.surface), `${screen.id} thiếu project`).not.toBeNull();
    }
  });
});

test.describe('HB-185 quét axe (WCAG 2.1 A/AA)', () => {
  for (const screen of SCREENS) {
    test(`${screen.id} — ${screen.name}`, async ({ page, request }, testInfo) => {
      const project = testInfo.project.name;

      if (screen.status === 'blocked') {
        // Chỉ báo lý do một lần (project customer-web); project còn lại không lặp lại cùng dòng
        // BLOCKED, tránh đội số skip mà vẫn không có màn nào biến mất khỏi bảng.
        test.skip(
          !project.startsWith('customer-web'),
          `${screen.id} BLOCKED — lý do đã in ở project customer-web: ${screen.reason ?? ''}`,
        );
        test.skip(true, `${screen.id} BLOCKED — ${screen.reason ?? 'không rõ lý do'}`);
      }

      const expectedProject = projectFor(screen.surface);
      // Project WebKit của nightly có hậu tố (`customer-web-webkit`), nên so theo tiền tố.
      if (expectedProject === null || !project.startsWith(expectedProject)) {
        test.skip(true, `${screen.id} thuộc ${screen.surface}, không chạy trên ${project}`);
      }

      const started = Date.now();
      let target = screen.path;
      try {
        const fixture = await installFixture(screen.fixture, { page, request });
        target = resolvePath(screen.path, fixture);
        await page.goto(target, { waitUntil: 'domcontentloaded' });
        if (fixture.settle !== undefined) await fixture.settle(page);
        await expect(page.getByTestId(screen.ready)).toBeVisible({ timeout: READY_TIMEOUT_MS });
      } catch (error) {
        const message = (error instanceof Error ? error.message.split('\n')[0] : String(error)) ?? '';
        await recordScreenResult({
          id: screen.id,
          name: screen.name,
          surface: screen.surface,
          path: target,
          status: 'ERROR',
          violations: [],
          newViolations: [],
          durationMs: Date.now() - started,
          error: message,
        });
        throw error;
      }

      const analysis = await new AxeBuilder({ page }).withTags([...TAGS]).analyze();
      const violations: ObservedViolation[] = analysis.violations.map((violation) => ({
        rule: violation.id,
        impact: violation.impact ?? 'minor',
        nodes: violation.nodes.length,
      }));
      const blocking = violations.filter(
        (violation) => violation.impact === 'serious' || violation.impact === 'critical',
      );
      const known = baselineKeys(loadBaseline());
      const fresh = blocking.filter((violation) => !known.has(`${screen.id}:${violation.rule}`));

      await recordScreenResult({
        id: screen.id,
        name: screen.name,
        surface: screen.surface,
        path: target,
        status: fresh.length === 0 ? 'PASS' : 'FAIL',
        violations,
        newViolations: fresh,
        durationMs: Date.now() - started,
      });

      expect(
        fresh.map((violation) => `${screen.id}:${violation.rule} (${violation.nodes} node)`),
        `vi phạm accessibility serious/critical MỚI trên ${screen.id} — xem docs/07-ban-giao/bang-chung-a11y.md`,
      ).toEqual([]);
    });
  }
});

/** Màn `scannable` phải có fixture (trừ màn công khai đã khai `customer-public`/`ops-anonymous`). */
test('mọi màn quét được đều khai fixture tường minh', () => {
  const missing = SCANNABLE_SCREENS.filter((screen: Screen) => screen.fixture === undefined).map(
    (screen) => screen.id,
  );
  expect(missing).toEqual([]);
});
