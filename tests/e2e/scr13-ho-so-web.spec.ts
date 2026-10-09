import { randomInt } from 'node:crypto';
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page, type Route } from '@playwright/test';
import type { createSessionClient } from '../../packages/web-session/src/client.js';
import { fulfillJson } from './operations-web/fake-api';

/**
 * SCR-13 (HB-105) chỉ có ở web khách (ADR-018).
 *
 * API giả HB-116 **chưa** có hai tuyến self `GET /api/v1/guests/me` và `/guests/me/loyalty` (xem ghi chú ở
 * PR), nên ca này khoá ở tầng BFF hành trình và trả phản hồi đúng `guestSummarySchema`/`guestLoyaltySchema`
 * — đồng thời khẳng định màn hình chỉ gọi tuyến **của chính mình** (không gửi `guestId` nào).
 */
function customerWebOnly(): void {
  test.beforeEach(({}, testInfo) => {
    test.skip(!testInfo.project.name.startsWith('customer-web'), 'ca này chỉ chạy trên customer-web');
  });
}

const origin = new URL(process.env.E2E_API_BASE_URL ?? 'http://127.0.0.1:4000/api/v1').origin;

customerWebOnly();

const GUEST = {
  id: 'g1',
  fullName: 'Nguyễn Văn An',
  phone: '+84912345678',
  email: 'an@example.com',
  loyaltyTier: 'GOLD',
  loyaltyPoints: 1200,
  totalStays: 7,
  blacklisted: false,
  consentMarketing: true,
  createdAt: '2026-09-19T03:14:02.000Z',
};

const LOYALTY = {
  guestId: 'g1',
  loyaltyTier: 'GOLD',
  loyaltyPoints: 1200,
  staysLast12Months: 3,
  totalStays: 7,
  updatedAt: '2026-10-01T00:00:00.000Z',
};

/** Đăng nhập khách bằng SĐT tổng hợp qua session client của BFF. */
async function loginGuest(page: Page): Promise<void> {
  await page.goto('/');
  await page.evaluate(async (url) => {
    const module: { createSessionClient: typeof createSessionClient } = await import(url);
    window.sessionClient = module.createSessionClient({ kind: 'guest' });
  }, `${origin}/__test/session-client.js`);
  await page.evaluate(
    (phone) => window.sessionClient?.login({ phone, password: 'Synthetic-password' }),
    `+84${String(randomInt(1000000000)).padStart(9, '0')}`,
  );
}

function errorBody(code: string): string {
  return JSON.stringify({
    code,
    message: 'Synthetic',
    traceId: 'stub-trace',
    timestamp: '2026-10-01T00:00:00.000Z',
    path: '/api/v1/guests/me',
  });
}

interface StubOptions {
  readonly profileStatus?: number;
  readonly loyaltyStatus?: number;
  readonly failFirstProfile?: boolean;
  readonly loyalty?: typeof LOYALTY;
}

async function stubSelf(
  page: Page,
  options: StubOptions = {},
): Promise<{ readonly paths: string[] }> {
  const paths: string[] = [];
  let profileCalls = 0;
  await page.route('**/api/session/journey/**', async (route: Route) => {
    const path = new URL(route.request().url()).pathname.replace('/api/session/journey/', '');
    paths.push(path);
    if (path === 'guests/me') {
      profileCalls += 1;
      if (options.failFirstProfile === true && profileCalls === 1)
        return fulfillJson(route, 500, errorBody('E_GEN_INTERNAL'));
      if (options.profileStatus !== undefined && options.profileStatus !== 200)
        return fulfillJson(
          route,
          options.profileStatus,
          errorBody(options.profileStatus === 403 ? 'E_RBAC_FORBIDDEN' : 'E_GEN_NOT_FOUND'),
        );
      return fulfillJson(route, 200, JSON.stringify(GUEST));
    }
    if (path === 'guests/me/loyalty') {
      if (options.loyaltyStatus !== undefined && options.loyaltyStatus !== 200)
        return fulfillJson(route, options.loyaltyStatus, errorBody('E_RBAC_FORBIDDEN'));
      return fulfillJson(route, 200, JSON.stringify(options.loyalty ?? LOYALTY));
    }
    return route.continue();
  });
  return { paths };
}

test.describe('SCR-13 hồ sơ khách & điểm trên API giả (HB-105)', () => {
  test('hiện hồ sơ và điểm/hạng từ tuyến self, không gửi guestId nào (AC1)', async ({ page }) => {
    await loginGuest(page);
    const { paths } = await stubSelf(page);
    await page.goto('/profile');

    const card = page.getByTestId('profile-card');
    await expect(card).toBeVisible();
    await expect(card).toContainText('Nguyễn Văn An');
    await expect(card).toContainText('+84912345678');
    await expect(card).toContainText('an@example.com');
    await expect(card).toContainText('19/09/2026');
    await expect(card).toContainText('Có');
    await expect(page.getByTestId('profile-tier')).toContainText('Vàng');
    const loyalty = page.getByTestId('profile-loyalty-table');
    await expect(loyalty).toContainText('1200');
    await expect(loyalty).toContainText('3');
    await expect(loyalty).toContainText('7');
    await expect(page.getByTestId('profile-mismatch')).toHaveCount(0);
    // Chỉ hai tuyến của chính khách, không có id khách trong đường dẫn.
    expect(paths.sort()).toEqual(['guests/me', 'guests/me/loyalty']);
    expect(paths.some((path) => path.includes('g1'))).toBe(false);
  });

  test('email trống và hạng/điểm lệch thì nói rõ, không bịa số (AC1)', async ({ page }) => {
    await loginGuest(page);
    await stubSelf(page, {
      loyalty: { ...LOYALTY, loyaltyTier: 'SILVER', loyaltyPoints: 900 },
    });
    await page.route('**/api/session/journey/guests/me', (route) =>
      fulfillJson(route, 200, JSON.stringify({ ...GUEST, email: null })),
    );
    await page.goto('/profile');
    await expect(page.getByTestId('profile-card')).toContainText('—');
    await expect(page.getByTestId('profile-tier')).toContainText('Vàng');
    await expect(page.getByTestId('profile-mismatch')).toBeVisible();
  });

  test('thiếu quyền thì hiện màn từ chối, không hiện hồ sơ (AC2)', async ({ page }) => {
    await loginGuest(page);
    await stubSelf(page, { profileStatus: 403 });
    await page.goto('/profile');
    await expect(page.getByTestId('access-denied')).toBeVisible();
    await expect(page.getByTestId('profile-card')).toHaveCount(0);
  });

  test('không có hồ sơ cho phiên thì báo rõ, không hiện dữ liệu rỗng giả (AC2)', async ({ page }) => {
    await loginGuest(page);
    await stubSelf(page, { profileStatus: 404 });
    await page.goto('/profile');
    await expect(page.getByTestId('profile-not-found')).toBeVisible();
    await expect(page.getByTestId('profile-card')).toHaveCount(0);
  });

  test('lỗi tạm thời thì hướng dẫn và nút tải lại lấy được dữ liệu (AC2)', async ({ page }) => {
    await loginGuest(page);
    await stubSelf(page, { failFirstProfile: true });
    await page.goto('/profile');
    await expect(page.getByTestId('profile-alert')).toBeVisible();
    await expect(page.getByTestId('profile-card')).toHaveCount(0);
    await page.getByTestId('profile-reload').click();
    await expect(page.getByTestId('profile-card')).toBeVisible();
    await expect(page.getByTestId('profile-alert')).toHaveCount(0);
  });

  test('không có vi phạm axe serious/critical và không cuộn ngang 360 px (AC2)', async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 800 });
    await loginGuest(page);
    await stubSelf(page);
    await page.goto('/profile');
    await expect(page.getByTestId('profile-card')).toBeVisible();
    const results = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
      .analyze();
    expect(
      results.violations
        .filter((violation) => violation.impact === 'serious' || violation.impact === 'critical')
        .map((violation) => violation.id),
    ).toEqual([]);
    const overflow = await page.evaluate(() => {
      const element = document.scrollingElement;
      return element === null ? 0 : element.scrollWidth - element.clientWidth;
    });
    expect(overflow).toBeLessThanOrEqual(1);
  });
});
