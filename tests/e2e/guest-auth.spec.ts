import { randomInt } from 'node:crypto';
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { EXISTING_PROFILE_PHONE } from './fake-api/guest/account';

/**
 * SCR-08 (HB-023) chỉ có ở web khách (ADR-018). Chạy trên API giả `fake-api/guest/account.ts` (đăng ký,
 * đặt lại mật khẩu) và `core/auth.ts` (đăng nhập, khoá tài khoản qua cổng `/__control/<phone>`); máy chủ
 * thật (HB-017/HB-028) chưa có nên đây **không** thay cho nghiệm thu trên API thật.
 */
test.beforeEach(({}, testInfo) => {
  test.skip(!testInfo.project.name.startsWith('customer-web'), 'ca này chỉ chạy trên customer-web');
});

const apiOrigin = new URL(process.env.E2E_API_BASE_URL ?? 'http://127.0.0.1:4000/api/v1').origin;

/** SĐT tổng hợp mới cho từng ca (không trùng hồ sơ có sẵn `EXISTING_PROFILE_PHONE`). */
function freshPhone(): { national: string; canonical: string } {
  const digits = String(100000000 + randomInt(800000000));
  return { national: `0${digits}`, canonical: `+84${digits}` };
}

async function controlStatus(request: APIRequestContext, phone: string, status: number): Promise<void> {
  const response = await request.post(`${apiOrigin}/__control/${encodeURIComponent(phone)}`, {
    data: { status },
  });
  expect(response.ok()).toBe(true);
}

async function fillRegister(page: Page, phone: string, password = 'Synthetic-pass1'): Promise<void> {
  await page.getByLabel('Họ và tên').fill('Nguyễn Văn An');
  await page.getByLabel('Số điện thoại').fill(phone);
  await page.getByLabel('Mật khẩu', { exact: true }).fill(password);
}

test.describe('đăng ký', () => {
  test('SĐT 0… hiện dạng chuẩn, tiếp thị không tích sẵn, đăng ký rồi vào phiên (AC2)', async ({
    page,
    request,
  }) => {
    const phone = freshPhone();
    await page.goto('/account/register?next=/');
    await expect(page.getByTestId('register-screen')).toBeVisible();
    await expect(page.getByLabel(/đồng ý nhận thông tin ưu đãi/)).not.toBeChecked();

    await fillRegister(page, phone.national);
    await expect(page.getByText(`Số điện thoại sẽ được dùng: ${phone.canonical}`)).toBeVisible();
    await page.getByTestId('register-submit').click();
    await expect(page).toHaveURL((url) => url.pathname === '/');

    const registrations = await (await request.get(`${apiOrigin}/__guest/registrations`)).json();
    expect(registrations).toContainEqual(
      expect.objectContaining({
        phone: phone.canonical,
        fullName: 'Nguyễn Văn An',
        email: null,
        consentMarketing: false,
        consentVersion: '2026-10',
        clientSurface: 'GUEST_WEB',
      }),
    );
    expect(JSON.stringify(registrations)).not.toContain('Synthetic-pass1');

    // Đã có phiên: đầu trang khu tài khoản hiện "Đã đăng nhập" và đăng xuất được.
    await page.goto('/account/login');
    await expect(page.getByTestId('account-status-text')).toHaveAttribute('data-status', 'in');
    await page.getByTestId('account-logout').click();
    await expect(page.getByTestId('account-status-text')).toHaveAttribute('data-status', 'out');
    const cookies = await page.context().cookies();
    expect(cookies.some((cookie) => cookie.name === 'pinehill_guest_refresh')).toBe(false);
  });

  test('ô đồng ý tiếp thị được tích thì gửi đúng cờ và phiên bản điều khoản', async ({
    page,
    request,
  }) => {
    const phone = freshPhone();
    await page.goto('/account/register?next=/');
    await fillRegister(page, phone.canonical);
    await page.getByLabel('Email (không bắt buộc)').fill('an@example.com');
    await page.getByLabel(/đồng ý nhận thông tin ưu đãi/).check();
    await page.getByTestId('register-submit').click();
    await expect(page).toHaveURL((url) => url.pathname === '/');
    const registrations = await (await request.get(`${apiOrigin}/__guest/registrations`)).json();
    expect(registrations).toContainEqual(
      expect.objectContaining({
        phone: phone.canonical,
        email: 'an@example.com',
        consentMarketing: true,
        consentVersion: '2026-10',
      }),
    );
  });

  test('SĐT đã có hồ sơ: hướng dẫn liên hệ lễ tân, giữ biểu mẫu, không vào phiên (AC2)', async ({
    page,
  }) => {
    await page.goto('/account/register?next=/');
    await fillRegister(page, EXISTING_PROFILE_PHONE);
    await page.getByTestId('register-submit').click();
    const failure = page.getByTestId('register-failure');
    await expect(failure).toContainText('đã có hồ sơ tại khách sạn');
    await expect(failure).toContainText('liên hệ lễ tân');
    await expect(page).toHaveURL(/\/account\/register/);
    await expect(page.getByLabel('Họ và tên')).toHaveValue('Nguyễn Văn An');
    await expect(page.getByTestId('account-status-text')).toHaveAttribute('data-status', 'out');
  });

  test('biểu mẫu sai: lỗi gắn trường, tóm tắt, focus trường lỗi đầu, không gửi gì', async ({
    page,
    request,
  }) => {
    // Số hợp lệ nhưng thiếu họ tên và mật khẩu quá ngắn: nếu lỡ gửi đi, API giả sẽ ghi nhận số này.
    const phone = freshPhone();
    await page.goto('/account/register');
    await page.getByLabel('Số điện thoại').fill(phone.canonical);
    await page.getByLabel('Mật khẩu', { exact: true }).fill('short');
    await page.getByTestId('register-submit').click();
    await expect(page.getByTestId('account-validation')).toContainText('Vui lòng sửa 2 trường');
    await expect(page.getByLabel('Họ và tên')).toBeFocused();
    await expect(page.getByLabel('Họ và tên')).toHaveAttribute('aria-invalid', 'true');
    await expect(page.getByLabel('Mật khẩu', { exact: true })).toHaveAttribute(
      'aria-invalid',
      'true',
    );
    await expect(page.getByLabel('Số điện thoại')).not.toHaveAttribute('aria-invalid', 'true');
    const registrations = await (await request.get(`${apiOrigin}/__guest/registrations`)).json();
    expect(JSON.stringify(registrations)).not.toContain(phone.canonical);
  });
});

test.describe('đăng nhập', () => {
  test('đăng nhập thành công về `next` nội bộ và có phiên', async ({ page }) => {
    const phone = freshPhone();
    await page.goto('/account/login?next=/');
    await page.getByLabel('Số điện thoại').fill(phone.national);
    await page.getByLabel('Mật khẩu', { exact: true }).fill('Synthetic-pass1');
    await page.getByTestId('login-submit').click();
    await expect(page).toHaveURL((url) => url.pathname === '/');
    await page.goto('/account/login');
    await expect(page.getByTestId('account-status-text')).toHaveAttribute('data-status', 'in');
  });

  test('`next` ngoài site bị bỏ: không chuyển hướng ra ngoài', async ({ page }) => {
    const phone = freshPhone();
    await page.route('https://evil.example/**', (route) => route.abort());
    await page.goto('/account/login?next=https://evil.example/');
    await page.getByLabel('Số điện thoại').fill(phone.canonical);
    await page.getByLabel('Mật khẩu', { exact: true }).fill('Synthetic-pass1');
    await page.getByTestId('login-submit').click();
    await expect(page).toHaveURL(/\/profile/);
  });

  test('sai thông tin, khoá tài khoản, giới hạn tần suất: thông điệp theo mã lỗi (AC1)', async ({
    page,
    request,
  }) => {
    const phone = freshPhone();
    await page.goto('/account/login?next=/');
    await page.getByLabel('Số điện thoại').fill(phone.canonical);
    await page.getByLabel('Mật khẩu', { exact: true }).fill('Synthetic-pass1');
    const failure = page.getByTestId('login-failure');

    await controlStatus(request, phone.canonical, 401);
    await page.getByTestId('login-submit').click();
    await expect(failure).toContainText('chưa đúng');
    await expect(page).toHaveURL(/\/account\/login/);

    await controlStatus(request, phone.canonical, 423);
    await page.getByTestId('login-submit').click();
    await expect(failure).toContainText('tạm khoá');

    await controlStatus(request, phone.canonical, 429);
    await page.getByTestId('login-submit').click();
    await expect(failure).toContainText('quá nhanh');

    await controlStatus(request, phone.canonical, 200);
    await page.getByTestId('login-submit').click();
    await expect(page).toHaveURL((url) => url.pathname === '/');
  });

  test('biểu mẫu rỗng: lỗi từng trường và focus trường đầu', async ({ page }) => {
    await page.goto('/account/login');
    await page.getByTestId('login-submit').click();
    await expect(page.getByTestId('account-validation')).toContainText('Vui lòng sửa 2 trường');
    await expect(page.getByLabel('Số điện thoại')).toBeFocused();
  });
});

test.describe('quên và đặt lại mật khẩu', () => {
  test('luôn cùng một thông báo dù SĐT có hồ sơ hay không; có dòng liên hệ lễ tân (AC3)', async ({
    page,
    request,
  }) => {
    const messages: string[] = [];
    for (const phone of [EXISTING_PROFILE_PHONE, freshPhone().canonical]) {
      await page.goto('/account/forgot-password');
      await page.getByLabel('Số điện thoại').fill(phone);
      await page.getByTestId('forgot-submit').click();
      const done = page.getByTestId('forgot-done');
      await expect(done).toBeVisible();
      messages.push((await done.textContent()) ?? '');
      await expect(page.getByTestId('forgot-no-email')).toContainText('liên hệ lễ tân');
    }
    expect(messages[0]).toBe(messages[1]);
    expect(messages[0]).toContain('Nếu số điện thoại này có email đăng ký');
    const requested = await (await request.get(`${apiOrigin}/__guest/reset-requests`)).json();
    expect(requested).toContain(EXISTING_PROFILE_PHONE);
  });

  test('đặt lại: hai lần nhập phải khớp, token dùng một lần và bị dọn khỏi thanh địa chỉ (AC4)', async ({
    page,
    request,
  }) => {
    const { token } = await (await request.post(`${apiOrigin}/__guest/reset-token`)).json();
    await page.goto(`/account/reset-password?token=${encodeURIComponent(token)}`);
    await expect(page.getByTestId('reset-screen')).toBeVisible();
    await expect(page).toHaveURL(/\/account\/reset-password$/);

    await page.getByLabel('Mật khẩu mới', { exact: true }).fill('N3w-secret!');
    await page.getByLabel('Nhập lại mật khẩu mới').fill('N3w-secret?');
    await page.getByTestId('reset-submit').click();
    await expect(page.getByLabel('Nhập lại mật khẩu mới')).toHaveAttribute('aria-invalid', 'true');
    await expect(page.getByLabel('Nhập lại mật khẩu mới')).toBeFocused();

    await page.getByLabel('Nhập lại mật khẩu mới').fill('N3w-secret!');
    await page.getByTestId('reset-submit').click();
    await expect(page.getByTestId('reset-done-notice')).toContainText('Đã đặt lại mật khẩu');
    await page.getByRole('link', { name: 'Đến trang đăng nhập' }).click();
    await expect(page.getByTestId('login-reset-notice')).toBeVisible();

    // Cùng token lần hai → không hợp lệ, hướng dẫn yêu cầu liên kết mới.
    await page.goto(`/account/reset-password?token=${encodeURIComponent(token)}`);
    await page.getByLabel('Mật khẩu mới', { exact: true }).fill('N3w-secret!');
    await page.getByLabel('Nhập lại mật khẩu mới').fill('N3w-secret!');
    await page.getByTestId('reset-submit').click();
    await expect(page.getByTestId('reset-failure')).toContainText('không hợp lệ');
    await expect(page.getByTestId('reset-new-link')).toHaveAttribute(
      'href',
      '/account/forgot-password',
    );
  });

  test('thiếu token trên liên kết thì nói rõ và vẫn dẫn tới yêu cầu liên kết mới', async ({
    page,
  }) => {
    await page.goto('/account/reset-password');
    await expect(page.getByTestId('reset-missing-token')).toBeVisible();
    await expect(page.getByTestId('reset-new-link')).toBeVisible();
  });
});

test.describe('trợ năng và màn hình hẹp', () => {
  for (const path of [
    '/account/register',
    '/account/login',
    '/account/forgot-password',
    '/account/reset-password?token=axe-token',
  ]) {
    test(`${path}: axe không có vi phạm serious/critical, không cuộn ngang ở 360 px (AC6)`, async ({
      page,
    }) => {
      await page.setViewportSize({ width: 360, height: 800 });
      await page.goto(path);
      await expect(page.getByTestId('account-status')).toBeVisible();
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
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
  }
});
