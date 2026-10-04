import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { operationsWebOnly } from './guard';

/**
 * Phủ 9 trạng thái của hợp đồng §8.1 trên hai màn F2 qua `?state=` (cùng bộ slug với khung F0),
 * kèm kiểm axe mức serious/critical cho từng trạng thái.
 */
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

type StateSlug = (typeof STATES)[number];

const EXPECTED: Readonly<Record<StateSlug, string>> = {
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
};

const SCREENS = [
  '/properties',
  '/room-types',
  '/rooms',
  '/inventory-grid',
  '/rate-calendar',
  '/audit-logs',
  '/promotions',
  '/room-blocks',
] as const;

operationsWebOnly();

for (const screen of SCREENS) {
  test.describe(`trạng thái của ${screen}`, () => {
    for (const state of STATES) {
      test(`${state} hiện đúng nội dung và không vi phạm axe`, async ({ page }) => {
        await page.goto(`${screen}?state=${state}`);
        await expect(page.getByText(EXPECTED[state], { exact: false })).toBeVisible();
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
}
