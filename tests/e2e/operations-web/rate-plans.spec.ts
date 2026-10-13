import { expect, test, type Page } from '@playwright/test';
import { errorBody, fulfillJson, listBody } from './fake-api';
import { operationsWebOnly } from './guard';
import { loginRefundStaff } from './refund-fixture';
import {
  ratePlanAdminSchema,
  ratePlanUpdateRequestSchema,
  cancellationPolicySchema,
  cancellationPolicyUpdateRequestSchema,
} from '../../../packages/contracts/src/index';

const PLAN = {
  id: '00000000-0000-4000-8000-000000000001',
  code: 'FLEX7',
  name: 'Linh hoạt 7 ngày (FLEX7)',
  minNights: 1,
  maxNights: 7,
  depositPercent: 30,
  cancellationPolicyId: '00000000-0000-4000-8000-000000000002',
  status: 'ACTIVE',
  version: 3,
};

const POLICY = {
  id: '00000000-0000-4000-8000-000000000002',
  name: 'Linh hoạt 7 ngày (FLEX7)',
  status: 'ACTIVE',
  tiers: [
    { hoursBeforeCheckIn: 168, refundPercent: 100 },
    { hoursBeforeCheckIn: 72, refundPercent: 50 },
    { hoursBeforeCheckIn: 24, refundPercent: 0 },
    { hoursBeforeCheckIn: 0, refundPercent: 0 },
  ],
  earlyCheckoutFreeHours: 72,
  earlyCheckoutRefundPct: 50,
  version: 4,
};

const RATE_PLANS = '**/api/session/sys/rate-plans**';
const POLICIES = '**/api/session/sys/cancellation-policies**';

operationsWebOnly();
test.beforeEach(async ({ page, request }) => {
  await loginRefundStaff(page, request, 'OWNER');
});

function backend(page: Page): {
  ratePlanPuts: () => string[];
  policyPuts: () => string[];
  ifMatch: () => (string | undefined)[];
} {
  let currentPlan = PLAN,
    currentPolicy = POLICY;
  const ratePlanPuts: string[] = [];
  const policyPuts: string[] = [];
  const ifMatch: (string | undefined)[] = [];
  void page.route(RATE_PLANS, async (route) => {
    if (route.request().method() === 'GET') {
      return fulfillJson(route, 200, listBody([currentPlan]));
    }
    if (route.request().method() === 'PUT') {
      ifMatch.push(route.request().headers()['if-match']);
      ratePlanPuts.push(route.request().postData() ?? '');
      const raw: unknown = JSON.parse(route.request().postData() ?? '{}');
      currentPlan = ratePlanAdminSchema.parse({
        ...currentPlan,
        ...ratePlanUpdateRequestSchema.parse(raw),
        version: currentPlan.version + 1,
      });
      return fulfillJson(route, 204, '');
    }
    return fulfillJson(route, 200, listBody([currentPlan]));
  });
  void page.route(POLICIES, async (route) => {
    if (route.request().method() === 'PUT') {
      ifMatch.push(route.request().headers()['if-match']);
      policyPuts.push(route.request().postData() ?? '');
      const raw: unknown = JSON.parse(route.request().postData() ?? '{}');
      currentPolicy = cancellationPolicySchema.parse({
        ...currentPolicy,
        ...cancellationPolicyUpdateRequestSchema.parse(raw),
        version: currentPolicy.version + 1,
      });
      return fulfillJson(route, 200, JSON.stringify(currentPolicy));
    }
    return fulfillJson(route, 200, listBody([currentPolicy]));
  });
  return { ratePlanPuts: () => ratePlanPuts, policyPuts: () => policyPuts, ifMatch: () => ifMatch };
}

test.describe('SCR-70 gói giá & chính sách huỷ trên API giả (HB-063)', () => {
  test('hiện danh sách gói giá (AC1)', async ({ page }) => {
    backend(page);
    await page.goto('/rate-plans');
    const table = page.getByTestId('rate-plans-table');
    await expect(table).toBeVisible();
    const row = page.getByTestId('rate-plan-FLEX7');
    await expect(row).toContainText('Linh hoạt 7 ngày');
    await expect(row).toContainText('30%');
    await expect(row).toContainText('1');
    await expect(row).toContainText('7');
    await expect(row).toContainText('Đang áp dụng (ACTIVE)');
    await expect(row).toContainText('3');
  });

  test('hiện toàn bộ bậc chính sách huỷ (AC2)', async ({ page }) => {
    backend(page);
    await page.goto('/rate-plans');
    const tiers = page.getByTestId('policy-tiers-00000000-0000-4000-8000-000000000002');
    await expect(tiers).toBeVisible();
    await expect(tiers).toContainText('168h');
    await expect(tiers).toContainText('72h');
    await expect(tiers).toContainText('24h');
    await expect(tiers).toContainText('Bậc bắt tất (−1)');
    await expect(tiers).toContainText('100%');
    await expect(tiers).toContainText('50%');
  });

  test('validate theo hàng chặn lưu (AC3)', async ({ page }) => {
    const spy = backend(page);
    await page.goto('/rate-plans');
    await page
      .getByTestId('policy-00000000-0000-4000-8000-000000000002')
      .getByRole('button', { name: 'Sửa' })
      .click();
    // Trùng mốc với hàng 0 (168) → lỗi ở đúng hàng 1, không gọi API.
    await page.getByTestId('tier-row-1').getByLabel('Mốc giờ').fill('168');
    await page.getByTestId('policy-editor').getByRole('button', { name: 'Lưu' }).click();
    await expect(page.getByTestId('tier-row-1')).toHaveAttribute('data-issue', 'NOT_DESCENDING');
    expect(spy.policyPuts()).toHaveLength(0);
  });

  test('lưu gửi toàn bộ bậc + If-Match (AC4)', async ({ page }) => {
    const spy = backend(page);
    await page.goto('/rate-plans');
    await page
      .getByTestId('policy-00000000-0000-4000-8000-000000000002')
      .getByRole('button', { name: 'Sửa' })
      .click();
    await page.getByTestId('tier-row-2').getByLabel('Hoàn (%)').fill('25');
    await page.getByLabel('Lý do thay đổi').fill('Nới bậc 1–3 ngày');
    await page.getByTestId('policy-editor').getByRole('button', { name: 'Lưu' }).click();
    await expect(page.getByTestId('rate-plans-saved')).toBeVisible();
    expect(spy.policyPuts()).toHaveLength(1);
    const body = spy.policyPuts()[0] ?? '';
    expect(body).toContain('"tiers"');
    expect(body).toContain('"hoursBeforeCheckIn":168');
    expect(body).toContain('"hoursBeforeCheckIn":0');
    expect(body).toContain('Nới bậc 1–3 ngày');
    expect(spy.ifMatch()).toContain('"4"');
  });

  test('422 E_RATE_CONFIGURATION_INVALID tô đúng hàng (AC5)', async ({ page }) => {
    void page.route(POLICIES, async (route) => {
      if (route.request().method() === 'PUT') {
        return fulfillJson(
          route,
          422,
          JSON.stringify({
            code: 'E_RATE_CONFIGURATION_INVALID',
            message: 'Sai mốc bậc',
            traceId: 'trace-422',
            timestamp: '2026-10-02T00:00:00.000Z',
            path: '/api/v1/cancellation-policies/00000000-0000-4000-8000-000000000002',
            details: [{ field: 'tiers[1].hoursBeforeCheckIn', issue: 'NOT_DESCENDING' }],
          }),
        );
      }
      return fulfillJson(route, 200, listBody([POLICY]));
    });
    void page.route(RATE_PLANS, async (route) => fulfillJson(route, 200, listBody([PLAN])));
    await page.goto('/rate-plans');
    await page
      .getByTestId('policy-00000000-0000-4000-8000-000000000002')
      .getByRole('button', { name: 'Sửa' })
      .click();
    // Đổi một bậc cho hợp lệ cục bộ (để không bị chặn tại chỗ), server vẫn trả 422 với chỉ số bậc lỗi.
    await page.getByTestId('tier-row-0').getByLabel('Hoàn (%)').fill('90');
    await page.getByLabel('Lý do thay đổi').fill('Thử lỗi server');
    await page.getByTestId('policy-editor').getByRole('button', { name: 'Lưu' }).click();
    await expect(page.getByTestId('tier-row-1')).toHaveAttribute('data-issue', 'NOT_DESCENDING');
  });

  test('412 giữ bản nhập và hiện diff (AC6)', async ({ page }) => {
    const server = { ...POLICY, version: 5, earlyCheckoutRefundPct: 60 };
    void page.route(POLICIES, async (route) => {
      if (route.request().method() === 'PUT') {
        return fulfillJson(
          route,
          412,
          errorBody(
            'E_GEN_VERSION_CONFLICT',
            'trace-412',
            '/api/v1/cancellation-policies/00000000-0000-4000-8000-000000000002',
          ),
        );
      }
      return fulfillJson(route, 200, listBody([server]));
    });
    void page.route(RATE_PLANS, async (route) => fulfillJson(route, 200, listBody([PLAN])));
    await page.goto('/rate-plans');
    await page
      .getByTestId('policy-00000000-0000-4000-8000-000000000002')
      .getByRole('button', { name: 'Sửa' })
      .click();
    await page.getByLabel('Lý do thay đổi').fill('Đổi tỷ lệ trả sớm');
    await page.getByLabel('Hoàn trả sớm (%)').fill('70');
    await page.getByTestId('policy-editor').getByRole('button', { name: 'Lưu' }).click();
    // Giữ bản nhập: form vẫn hiện, kèm bảng khác biệt giữa bản nhập và bản máy chủ.
    await expect(page.getByTestId('admin-conflict')).toBeVisible();
    await page.getByRole('button', { name: 'Tải lại và so sánh' }).click();
    await expect(page.getByTestId('rate-plans-conflict')).toBeVisible();
    await expect(page.getByTestId('policy-editor')).toBeVisible();
    await expect(page.getByTestId('diff-local-earlyCheckoutRefundPct')).toHaveText('70');
    await expect(page.getByTestId('diff-server-earlyCheckoutRefundPct')).toHaveText('60');
    // Chỉ khi chọn "Dùng bản máy chủ" mới thay bản nhập.
    await page.getByRole('button', { name: 'Dùng bản máy chủ' }).click();
    await expect(page.getByTestId('rate-plans-conflict')).toHaveCount(0);
    await expect(page.getByLabel('Hoàn trả sớm (%)')).toHaveValue('60');
  });

  test('cảnh báo snapshot bất biến + lý do bắt buộc (AC7)', async ({ page }) => {
    const spy = backend(page);
    await page.goto('/rate-plans');
    await page.getByTestId('rate-plan-FLEX7').getByRole('button', { name: 'Sửa' }).click();
    await expect(
      page.getByText('Chỉ áp cho báo giá mới — booking đã chốt giữ snapshot cũ.'),
    ).toBeVisible();
    await page.getByLabel('Cọc (%)').fill('40');
    await page.getByTestId('rate-plan-editor').getByRole('button', { name: 'Lưu' }).click();
    await expect(page.getByText('reason: REQUIRED')).toBeVisible();
    expect(spy.ratePlanPuts()).toHaveLength(0);
    await page.getByLabel('Lý do thay đổi').fill('Tăng cọc');
    await page.getByTestId('rate-plan-editor').getByRole('button', { name: 'Lưu' }).click();
    await expect(page.getByTestId('rate-plans-saved')).toBeVisible();
    expect(spy.ratePlanPuts()).toHaveLength(1);
    expect(spy.ratePlanPuts()[0]).toContain('"depositPercent":40');
    expect(spy.ifMatch()).toContain('"3"');
  });

  test('403 hiện thiếu quyền, không render nút lưu (AC8)', async ({ page }) => {
    void page.route(RATE_PLANS, (route) =>
      fulfillJson(
        route,
        403,
        errorBody('E_RBAC_FORBIDDEN', 'trace-403', '/api/v1/rate-plans/admin'),
      ),
    );
    void page.route(POLICIES, (route) => fulfillJson(route, 200, listBody([POLICY])));
    await page.goto('/rate-plans');
    await expect(page.getByText('Bạn không có quyền xem nội dung này')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Sửa' })).toHaveCount(0);
  });
});
