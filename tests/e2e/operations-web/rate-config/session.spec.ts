import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { operationsWebOnly } from '../guard';
import { loginRefundStaff } from '../refund-fixture';
import { fixtureOrigin } from '../collect-fixture';
import { configBackend, POLICY } from './fixture';
operationsWebOnly();
test.beforeEach(async ({ page, request }) => {
  await loginRefundStaff(page, request, 'OWNER');
});
test('five canonical tiers display0 and -1, retain first-night flags and replace the entire list', async ({
  page,
}) => {
  const backend = configBackend(page);
  await page.goto('/rate-plans');
  await page
    .getByTestId('policy-' + POLICY.id)
    .getByRole('button', { name: 'Sửa', exact: true })
    .click();
  await expect(page.getByTestId('tier-row-3').getByLabel('Mốc giờ', { exact: true })).toHaveValue(
    '0',
  );
  await expect(page.getByTestId('tier-row-4').getByLabel('Mốc giờ', { exact: true })).toHaveValue(
    '-1',
  );
  await expect(page.locator('input[name="chargeFirstNight-3"]')).toBeChecked();
  await expect(page.locator('input[name="chargeFirstNight-4"]')).toBeChecked();
  await page.getByLabel('Lý do thay đổi', { exact: true }).fill('Synthetic canonical tiers');
  await page.getByLabel('Hoàn trả sớm (%)', { exact: true }).fill('60');
  await page.getByTestId('policy-editor').getByRole('button', { name: 'Lưu', exact: true }).click();
  await expect(page.getByTestId('rate-plans-saved')).toBeVisible();
  expect(backend.policy().tiers).toEqual(POLICY.tiers);
  expect(backend.policy().earlyCheckoutRefundPct).toBe(60);
  expect(backend.writes).toHaveLength(1);
});
test('lost plan ACK survives reload/equal GET and manually replays exact key/tag/body', async ({
  page,
}) => {
  const backend = configBackend(page, { lost: true });
  await page.goto('/rate-plans');
  await page
    .getByTestId('rate-plan-FLEX7')
    .getByRole('button', { name: 'Sửa', exact: true })
    .click();
  await page.getByLabel('Cọc (%)', { exact: true }).fill('40');
  await page.getByLabel('Lý do thay đổi', { exact: true }).fill('Synthetic lost response');
  await page
    .getByTestId('rate-plan-editor')
    .getByRole('button', { name: 'Lưu', exact: true })
    .click();
  await expect(page.getByTestId('admin-unknown')).toBeVisible();
  expect(backend.writes).toHaveLength(1);
  await page.reload();
  await expect(page.getByTestId('admin-unknown')).toBeVisible();
  await expect(page.getByTestId('rate-plan-FLEX7')).toContainText('40%');
  await expect(page.getByTestId('rate-plans-saved')).toHaveCount(0);
  await page.getByRole('button', { name: 'Tra cứu kết quả', exact: true }).click();
  await expect(page.getByTestId('admin-unknown')).toBeVisible();
  expect(backend.writes).toHaveLength(1);
  await page.getByRole('button', { name: 'Gửi lại đúng yêu cầu', exact: true }).click();
  await expect(page.getByTestId('admin-unknown')).toHaveCount(0);
  await expect(page.getByTestId('rate-plans-saved')).toBeVisible();
  expect(backend.writes).toHaveLength(2);
  expect(backend.writes[1]).toEqual(backend.writes[0]);
});
test('explicit412 adoption keeps the user deposit change and preserves concurrent min/max changes', async ({
  page,
}) => {
  const backend = configBackend(page, { conflict: true });
  await page.goto('/rate-plans');
  await page
    .getByTestId('rate-plan-FLEX7')
    .getByRole('button', { name: 'Sửa', exact: true })
    .click();
  await page.getByLabel('Cọc (%)', { exact: true }).fill('40');
  await page.getByLabel('Đêm tối thiểu', { exact: true }).fill('01');
  await page.getByLabel('Đêm tối đa', { exact: true }).fill(' 007 ');
  await page.getByLabel('Lý do thay đổi', { exact: true }).fill('Synthetic compare');
  await page
    .getByTestId('rate-plan-editor')
    .getByRole('button', { name: 'Lưu', exact: true })
    .click();
  await expect(page.getByTestId('admin-conflict')).toBeVisible();
  await page.getByRole('button', { name: 'Tải lại và so sánh', exact: true }).click();
  await expect(page.getByTestId('rate-plans-conflict')).toBeVisible();
  await page
    .getByRole('button', { name: 'Giữ bản nhập, dùng phiên bản mới để lưu', exact: true })
    .click();
  await expect(page.getByLabel('Đêm tối thiểu', { exact: true })).toHaveValue('2');
  await expect(page.getByLabel('Đêm tối đa', { exact: true })).toHaveValue('9');
  await page
    .getByTestId('rate-plan-editor')
    .getByRole('button', { name: 'Lưu', exact: true })
    .click();
  await expect(page.getByTestId('rate-plans-saved')).toBeVisible();
  expect(backend.plan()).toMatchObject({ depositPercent: 40, minNights: 2, maxNights: 9 });
  expect(backend.writes).toHaveLength(2);
  for (const write of backend.writes)
    expect(JSON.parse(write.body)).toEqual({ depositPercent: 40, reason: 'Synthetic compare' });
});
test('logout clears private lists/editor, and360 layout stays within viewport with accessible tables', async ({
  page,
}) => {
  configBackend(page);
  await page.setViewportSize({ width: 360, height: 800 });
  await page.goto('/rate-plans');
  await expect(page.getByTestId('rate-plans-table')).toBeVisible();
  await page
    .getByTestId('rate-plan-FLEX7')
    .getByRole('button', { name: 'Sửa', exact: true })
    .click();
  const region = page.getByRole('region', { name: 'Danh sách gói giá', exact: true });
  await expect(region).toHaveAttribute('tabindex', '0');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  expect(
    (await new AxeBuilder({ page }).analyze()).violations.filter((item) =>
      ['serious', 'critical'].includes(item.impact ?? ''),
    ),
  ).toEqual([]);
  await page.evaluate(async (origin) => {
    const module: typeof import('../../../../packages/web-session/src/client') = await import(
      origin + '/__test/session-client.js'
    );
    const session = module.createSessionClient({ kind: 'staff' });
    try {
      await session.getAccessToken();
      await session.logout();
    } finally {
      session.dispose();
    }
  }, fixtureOrigin);
  await expect(page.getByText('Phiên đã hết hạn. Đăng nhập lại để quản trị.')).toBeVisible();
  await expect(page.getByTestId('rate-plans-table')).toHaveCount(0);
  await expect(page.getByTestId('policy-editor')).toHaveCount(0);
  await expect(page.getByTestId('rate-plan-editor')).toHaveCount(0);
});
