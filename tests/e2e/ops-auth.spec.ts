import { randomUUID } from 'node:crypto';
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { fixtureOrigin } from './operations-web/collect-fixture';
import { operationsWebOnly } from './operations-web/guard';

/**
 * SCR-14 (HB-020) — đăng nhập nội bộ, buộc đổi mật khẩu, chọn cơ sở đang làm việc, hết phiên/nhàn rỗi.
 * Chạy trên BFF cookie thật + API giả (`fake-api/core` cho đăng nhập/khoá, `fake-api/staff` cho hồ sơ,
 * cơ sở, đổi mật khẩu). Màn đích dùng `/access-denied` (không gọi API) để không lẫn với E2E của màn khác.
 */
operationsWebOnly();

const PASSWORD = 'Synthetic-password';
const TARGET = '/access-denied';
const WORKING_PROPERTY_KEY = 'pinehill.ops.workingProperty';

const account = (kind: 'single' | 'must' | 'multi' | 'owner') => `ops-auth-${kind}-${randomUUID()}`;

async function signIn(page: Page, username: string, password = PASSWORD): Promise<void> {
  await page.getByLabel('Tên đăng nhập').fill(username);
  await page.getByLabel('Mật khẩu', { exact: true }).fill(password);
  await page.getByTestId('login-submit').click();
}

async function control(page: Page, username: string, status: number): Promise<void> {
  const response = await page.request.post(`${fixtureOrigin}/__control/${encodeURIComponent(username)}`, {
    data: { status },
  });
  expect(response.ok()).toBe(true);
}

async function expectAxeClean(page: Page): Promise<void> {
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze();
  const blocking = results.violations.filter(
    (violation) => violation.impact === 'serious' || violation.impact === 'critical',
  );
  expect(blocking.map((violation) => violation.id)).toEqual([]);
}

async function noHorizontalScroll(page: Page): Promise<boolean> {
  return page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
}

test('chưa đăng nhập: vào khu vực nhân viên bị đưa về /login kèm next', async ({ page }) => {
  await page.goto(TARGET);
  await expect(page).toHaveURL(/\/login\?next=%2Faccess-denied$/);
  await expect(page.getByRole('heading', { name: 'Đăng nhập nhân viên' })).toBeVisible();
  await expect(page.getByLabel('Tên đăng nhập')).toBeVisible();
  await expect(page.getByLabel('Mật khẩu', { exact: true })).toBeVisible();
});

test('biểu mẫu đăng nhập: axe sạch và 360 px không cuộn ngang, kể cả khi có lỗi', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 800 });
  await page.goto('/login');
  await expectAxeClean(page);
  expect(await noHorizontalScroll(page)).toBe(true);
  await page.getByTestId('login-submit').click();
  await expect(page.getByTestId('login-summary')).toBeVisible();
  await expectAxeClean(page);
  expect(await noHorizontalScroll(page)).toBe(true);
});

test('gửi trống: lỗi gắn trường, tiêu điểm về trường lỗi đầu tiên và không gửi request', async ({ page }) => {
  const sent: string[] = [];
  page.on('request', (request) => {
    if (request.url().includes('/api/session/login')) sent.push(request.url());
  });
  await page.goto('/login');
  await page.getByTestId('login-submit').click();
  await expect(page.getByTestId('login-summary')).toContainText('2 trường');
  const username = page.getByLabel('Tên đăng nhập');
  await expect(username).toHaveAttribute('aria-invalid', 'true');
  await expect(username).toBeFocused();
  await expect(page.getByTestId('login-username-error')).toHaveText('Bắt buộc nhập.');
  await expect(page.getByTestId('login-password-error')).toHaveText('Bắt buộc nhập.');
  // Mật khẩu ngắn hơn hợp đồng cũng bị chặn tại chỗ.
  await username.fill('letan01');
  await page.getByLabel('Mật khẩu', { exact: true }).fill('ngan');
  await page.getByTestId('login-submit').click();
  await expect(page.getByTestId('login-password-error')).toContainText('8–128');
  expect(sent).toEqual([]);
});

test('đăng nhập thành công về đúng next, hiện thanh đầu trang, rồi đăng xuất', async ({ page }) => {
  await page.goto(TARGET);
  await signIn(page, account('single'));
  await expect(page).toHaveURL(new RegExp(`${TARGET}$`));
  const bar = page.getByTestId('staff-bar');
  await expect(bar).toBeVisible();
  await expect(page.getByTestId('staff-user')).toContainText('Nhân viên SCR-14 (FRONT_DESK)');
  await expect(page.getByTestId('staff-property')).toContainText('Pine Hill Đà Lạt');
  await expectAxeClean(page);

  await page.getByTestId('staff-logout').click();
  await expect(page).toHaveURL(/\/login$/);
  // Phiên đã thu hồi: vào lại khu vực nhân viên bị chặn, cookie không còn đủ để vào.
  await page.goto(TARGET);
  await expect(page).toHaveURL(/\/login\?next=%2Faccess-denied$/);
});

test.describe('lỗi đăng nhập', () => {
  test('sai thông tin: báo chung, giữ tên đăng nhập, xoá mật khẩu', async ({ page }) => {
    const username = account('single');
    await control(page, username, 401);
    await page.goto('/login');
    await signIn(page, username);
    await expect(page.getByTestId('login-failure')).toHaveText('Tên đăng nhập hoặc mật khẩu không đúng.');
    await expect(page.getByLabel('Tên đăng nhập')).toHaveValue(username);
    await expect(page.getByLabel('Mật khẩu', { exact: true })).toHaveValue('');
    await expectAxeClean(page);
  });

  test('khoá tài khoản: nêu thời gian chờ máy chủ trả', async ({ page }) => {
    const username = account('single');
    await control(page, username, 423);
    await page.goto('/login');
    await signIn(page, username);
    await expect(page.getByTestId('login-failure')).toContainText('tạm khoá');
    await expect(page.getByTestId('login-failure')).toContainText('42 giây');
  });

  test('giới hạn tần suất: nêu thời gian chờ máy chủ trả', async ({ page }) => {
    const username = account('single');
    await control(page, username, 429);
    await page.goto('/login');
    await signIn(page, username);
    await expect(page.getByTestId('login-failure')).toContainText('Quá nhiều lần thử');
    await expect(page.getByTestId('login-failure')).toContainText('42 giây');
  });

  test('mất mạng: báo lỗi mạng, giữ nhập và cho thử lại', async ({ page }) => {
    await page.route('**/api/session/login', (route) => route.abort('failed'));
    await page.goto('/login');
    const username = account('single');
    await signIn(page, username);
    await expect(page.getByTestId('login-failure')).toContainText('Không kết nối được máy chủ');
    await expect(page.getByLabel('Tên đăng nhập')).toHaveValue(username);
    await expect(page.getByTestId('login-submit')).toBeEnabled();
  });
});

test('next chỉ nhận đường dẫn nội bộ (chống open redirect)', async ({ page }) => {
  await page.goto('/login?next=//evil.example/steal');
  await signIn(page, account('single'));
  await expect(page.getByTestId('staff-bar')).toBeVisible();
  const url = new URL(page.url());
  expect(url.origin).toBe(new URL(page.url()).origin);
  expect(url.hostname).not.toBe('evil.example');
  expect(url.pathname).toBe('/');
});

test.describe('đổi mật khẩu bắt buộc', () => {
  test('không vào được trang khác cho tới khi đổi xong; xác nhận, sai mật khẩu cũ, rồi vào next', async ({ page }) => {
    await page.goto(TARGET);
    await signIn(page, account('must'));
    await expect(page).toHaveURL(/\/change-password\?next=%2Faccess-denied$/);
    await expect(page.getByTestId('change-intro')).toContainText('phải đổi mật khẩu tạm');
    await expectAxeClean(page);

    // Đi thẳng tới trang khác vẫn bị đưa về đổi mật khẩu.
    await page.goto(TARGET);
    await expect(page).toHaveURL(/\/change-password\?next=%2Faccess-denied$/);

    // Kiểm biểu mẫu tại chỗ: mật khẩu mới ngắn, xác nhận không khớp.
    await page.getByLabel('Mật khẩu hiện tại').fill(PASSWORD);
    await page.getByLabel('Mật khẩu mới', { exact: true }).fill('ngan');
    await page.getByLabel('Nhập lại mật khẩu mới').fill('khac');
    await page.getByTestId('change-submit').click();
    await expect(page.getByTestId('change-new-error')).toContainText('8–128');
    await expect(page.getByTestId('change-confirm-error')).toHaveText('Mật khẩu xác nhận không khớp.');
    await expect(page.getByLabel('Mật khẩu mới', { exact: true })).toBeFocused();

    // Mật khẩu hiện tại sai: lỗi gắn đúng trường, ở lại trang.
    await page.getByLabel('Mật khẩu hiện tại').fill('sai-mat-khau-cu');
    await page.getByLabel('Mật khẩu mới', { exact: true }).fill('Mat-khau-moi-1');
    await page.getByLabel('Nhập lại mật khẩu mới').fill('Mat-khau-moi-1');
    await page.getByTestId('change-submit').click();
    await expect(page.getByTestId('change-current-error')).toHaveText('Mật khẩu hiện tại không đúng.');
    await expect(page).toHaveURL(/\/change-password/);

    // Đổi thành công: vào đúng next và thấy thanh đầu trang.
    await page.getByLabel('Mật khẩu hiện tại').fill(PASSWORD);
    await page.getByLabel('Mật khẩu mới', { exact: true }).fill('Mat-khau-moi-1');
    await page.getByLabel('Nhập lại mật khẩu mới').fill('Mat-khau-moi-1');
    await page.getByTestId('change-submit').click();
    await expect(page).toHaveURL(new RegExp(`${TARGET}$`));
    await expect(page.getByTestId('staff-bar')).toBeVisible();
  });

  test('360 px không cuộn ngang', async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 800 });
    await page.goto('/login');
    await signIn(page, account('must'));
    await expect(page.getByTestId('change-submit')).toBeVisible();
    expect(await noHorizontalScroll(page)).toBe(true);
  });
});

test.describe('cơ sở đang làm việc', () => {
  test('nhiều cơ sở: chọn sau đăng nhập, lưu ở sessionStorage, đổi được trên thanh đầu trang', async ({ page }) => {
    await page.goto(TARGET);
    await signIn(page, account('multi'));
    await expect(page).toHaveURL(/\/select-property\?next=%2Faccess-denied$/);
    await expectAxeClean(page);

    // Chưa chọn thì không đi tiếp.
    await page.getByTestId('property-continue').click();
    await expect(page.getByTestId('property-missing')).toBeVisible();

    await page.getByLabel('Pine Hill Nha Trang').check();
    await page.getByTestId('property-continue').click();
    await expect(page).toHaveURL(new RegExp(`${TARGET}$`));
    const select = page.getByTestId('staff-property-select');
    await expect(select).toHaveValue('p-nhatrang');
    expect(await page.evaluate((key) => sessionStorage.getItem(key), WORKING_PROPERTY_KEY)).toBe(
      'p-nhatrang',
    );

    // Đổi cơ sở không cần đăng nhập lại; tải lại trang giữ lựa chọn.
    await select.selectOption('p-dalat');
    expect(await page.evaluate((key) => sessionStorage.getItem(key), WORKING_PROPERTY_KEY)).toBe(
      'p-dalat',
    );
    await page.reload();
    await expect(page.getByTestId('staff-property-select')).toHaveValue('p-dalat');
  });

  test('OWNER thấy mọi cơ sở máy chủ liệt kê để chọn', async ({ page }) => {
    await page.goto(TARGET);
    await signIn(page, account('owner'));
    await expect(page).toHaveURL(/\/select-property/);
    await expect(page.getByRole('radio')).toHaveCount(3);
    await expect(page.getByLabel('Pine Hill Vũng Tàu')).toBeVisible();
  });
});

test.describe('hết phiên', () => {
  test('đăng xuất từ tab khác: tab này về /login với thông báo hết phiên', async ({ page, context }) => {
    await page.goto(TARGET);
    await signIn(page, account('single'));
    await expect(page.getByTestId('staff-bar')).toBeVisible();

    const other = await context.newPage();
    await other.goto('/login');
    await other.evaluate(async (origin) => {
      const module: typeof import('../../packages/web-session/src/client.js') = await import(
        origin + '/__test/session-client.js'
      );
      const client = module.createSessionClient({ kind: 'staff' });
      try {
        await client.logout();
      } finally {
        client.dispose();
      }
    }, fixtureOrigin);

    await expect(page).toHaveURL(/\/login\?next=%2Faccess-denied&reason=expired$/);
    await expect(page.getByTestId('login-expired')).toHaveText('Phiên đã hết hạn. Hãy đăng nhập lại.');
  });

  test('sự kiện session-expired của client phiên dùng chung cũng đưa về /login', async ({ page }) => {
    await page.goto(TARGET);
    await signIn(page, account('single'));
    await expect(page.getByTestId('staff-bar')).toBeVisible();
    await page.evaluate(() => window.dispatchEvent(new Event('session-expired')));
    await expect(page).toHaveURL(/\/login\?next=%2Faccess-denied&reason=expired$/);
  });

  test('15 phút không thao tác: thu hồi phiên và về /login; thao tác trước đó thì gia hạn', async ({ page }) => {
    await page.clock.install();
    await page.goto(TARGET);
    await signIn(page, account('single'));
    await expect(page.getByTestId('staff-bar')).toBeVisible();
    const logouts: string[] = [];
    page.on('request', (request) => {
      if (request.url().includes('/api/session/logout')) logouts.push(request.url());
    });

    await page.clock.fastForward('14:00');
    await page.mouse.click(10, 10); // thao tác ⇒ đếm lại từ đầu
    await page.clock.fastForward('14:00');
    await expect(page.getByTestId('staff-bar')).toBeVisible();

    await page.clock.fastForward('01:10');
    await expect(page).toHaveURL(/\/login\?next=%2Faccess-denied&reason=expired$/);
    await expect(page.getByTestId('login-expired')).toBeVisible();
    expect(logouts.length).toBeGreaterThan(0);
  });
});
