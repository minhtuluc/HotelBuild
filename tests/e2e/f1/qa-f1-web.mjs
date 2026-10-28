#!/usr/bin/env node
/**
 * HB-025 — QA F1 trên **API thật + CSDL tạm + hai web Next thật** (Chromium; WebKit ghi BLOCKED).
 *
 * Một phát chạy: `node tests/e2e/f1/qa-f1-web.mjs`
 *   • cần `DATABASE_MIGRATION_URL`, `DATABASE_URL`, `REDIS_URL` như `tests/e2e/f5` (CSDL `hb117_qa_*` tạm,
 *     Redis DB riêng — không đụng DB 0…12/14…15), Mailpit ở `127.0.0.1:1025/8025`.
 *   • `E2E_BROWSERS` (mặc định `chromium,webkit`): WebKit thiếu thư viện hệ thống trên host này ⇒ BLOCKED.
 *   • Kết quả: `n PASS · m FAIL · k BLOCKED`; thoát 0 khi không có FAIL (BLOCKED không làm đỏ).
 *
 * Đồng hồ: `setClock()` của `f5/qa-f5-lib.mjs` điều khiển `Date` của tiến trình API (clock-shim), nên TTL
 * access token (900 s) và khoá đăng nhập (15 phút) đo được mà không chờ thật. Hẹn giờ nhàn rỗi phía
 * client thì không đọc đồng hồ API — nó được kiểm bằng chính đường máy chủ (last_seen_at + TTL).
 */
import { randomInt } from 'node:crypto';
import { join } from 'node:path';
import { existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { chromium, webkit } from '@playwright/test';
import {
  API_BASE,
  PASSWORD,
  bootstrap,
  finding,
  setClock,
  sql,
  teardown,
} from '../f5/qa-f5-lib.mjs';
import {
  api,
  apiLogin,
  axeCheck,
  blocked,
  businessDate,
  decodeJwt,
  ensureBuild,
  fail,
  freePort,
  killWeb,
  mailTo,
  mailpitClear,
  pass,
  report,
  repoRoot,
  startNext,
  startProxy,
  summarize,
  vnDate,
  vnTime,
  waitForHttp,
} from './qa-f1-lib.mjs';

const OPS_FILTER = '@pinehill/operations-web';
const CUST_FILTER = '@pinehill/customer-web';
const REQUESTED_BROWSERS = (process.env.E2E_BROWSERS ?? 'chromium,webkit')
  .split(',')
  .map((value) => value.trim())
  .filter(Boolean);

// ----- cổng + cấu hình phải chốt TRƯỚC bootstrap (API cần GUEST_WEB_BASE_URL khi gửi thư) -----
const opsInternal = await freePort();
const opsPort = await freePort();
const custInternal = await freePort();
const custPort = await freePort();
const OPS = `http://127.0.0.1:${opsPort}`;
const CUST = `http://127.0.0.1:${custPort}`;
process.env.SMTP_URL ??= 'smtp://127.0.0.1:1025';
process.env.SMTP_FROM ??= 'Pine Hill QA <qa@pinehill.test>';
process.env.GUEST_WEB_BASE_URL = CUST;

/** Mốc đồng hồ API; mỗi lần `nextWindow()` nhảy sang phút kế (ô hạn mức đăng nhập 60 giây của LoginAttempts). */
let cursor = Math.ceil((Date.now() + 60_000) / 60_000) * 60_000;
async function nextWindow() {
  cursor += 60_000;
  await setClock(vnDate(cursor), vnTime(cursor));
  return cursor;
}
async function advance(minutes) {
  cursor += minutes * 60_000;
  await setClock(vnDate(cursor), vnTime(cursor));
  return cursor;
}

// ----- tiến trình -----
const proxies = [];
let browser;
async function shutdown() {
  await browser?.close().catch(() => undefined);
  await Promise.all(proxies.map((proxy) => proxy.close().catch(() => undefined)));
  killWeb();
  await teardown().catch(() => undefined);
}

const props = {};
const QA_USERS = {};
let guest = {};

async function prepareData() {
  for (const row of await sql('SELECT id, code FROM properties ORDER BY code')) props[row.code] = row.id;
  const definitions = [
    { username: 'qa_f1_fd_cs02', role: 'FRONT_DESK', codes: ['CS-02'] },
    { username: 'qa_f1_lock', role: 'HOUSEKEEPING', codes: ['CS-01'] },
    { username: 'qa_f1_must', role: 'FRONT_DESK', codes: ['CS-01'], mustChange: true },
  ];
  for (const definition of definitions) {
    const [row] = await sql(
      `INSERT INTO users (username, password_hash, full_name, role, is_active, must_change_password)
       SELECT $1, password_hash, $2, $3, true, $4 FROM users WHERE username = 'frontdesk'
       ON CONFLICT (username) DO NOTHING
       RETURNING id`,
      [definition.username, `QA F1 ${definition.role}`, definition.role, definition.mustChange ?? false],
    );
    const [found] =
      row === undefined
        ? await sql('SELECT id FROM users WHERE username = $1', [definition.username])
        : [row];
    QA_USERS[definition.username] = found.id;
    await sql('DELETE FROM user_property_scopes WHERE user_id = $1', [found.id]);
    for (const code of definition.codes) {
      await sql('INSERT INTO user_property_scopes (user_id, property_id) VALUES ($1, $2)', [
        found.id,
        props[code],
      ]);
    }
  }
}

// ----- điều khiển operations web -----
async function newPage(target = OPS) {
  const context = await browser.newContext({ baseURL: target, viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();
  page.setDefaultTimeout(30_000);
  return { context, page };
}

async function opsLogin(page, username, password = PASSWORD) {
  await page.goto('/login');
  await page.getByLabel('Tên đăng nhập').fill(username);
  await page.getByLabel('Mật khẩu', { exact: true }).fill(password);
  await page.getByTestId('login-submit').click();
}

/** Chờ cổng phiên ổn định; tự chọn cơ sở đầu tiên khi OWNER/MANAGER phải chọn. */
async function settleOps(page) {
  await page.waitForFunction(
    () =>
      location.pathname === '/select-property' ||
      document.querySelector('[data-testid="staff-bar"]') !== null ||
      document.querySelector('[data-testid="staff-no-property"]') !== null ||
      document.querySelector('[data-testid="login-failure"]') !== null,
    null,
    { timeout: 40_000 },
  );
  if (page.url().includes('/select-property')) {
    await page.getByRole('radio').first().check();
    await page.getByTestId('property-continue').click();
    await page.getByTestId('staff-bar').waitFor({ state: 'visible' });
  }
}

async function openUsersAs(page, username) {
  await opsLogin(page, username);
  await settleOps(page);
  await page.goto('/admin/users');
  return page;
}

// ----- 7 vai trò (hợp đồng `userRoleSchema`) -----
const SEED_ROLES = [
  ['OWNER', 'owner'],
  ['SYSADMIN', 'sysadmin'],
  ['MANAGER', 'manager'],
  ['FRONT_DESK', 'frontdesk'],
  ['HOUSEKEEPING', 'housekeeping'],
  ['ACCOUNTANT', 'accountant'],
  ['RESERVATION_AGENT', 'reservation'],
];

async function roleSweep() {
  for (const [role, username] of SEED_ROLES) {
    await nextWindow();
    const { context, page } = await newPage();
    try {
      await opsLogin(page, username);
      await settleOps(page);
      if (role === 'SYSADMIN') {
        await page.getByTestId('staff-no-property').waitFor({ state: 'visible' });
        pass(
          `SCR-14 · đăng nhập web vai trò ${role}`,
          'xác thực OK; seed không cấp cơ sở nên cổng dừng ở thông báo "chưa có cơ sở"',
        );
      } else {
        const text = (await page.getByTestId('staff-user').innerText()).trim();
        report(`SCR-14 · đăng nhập web vai trò ${role}`, text.endsWith(`(${role})`), text);
      }
    } catch (error) {
      fail(`SCR-14 · đăng nhập web vai trò ${role}`, error.message);
    } finally {
      await context.close();
    }
  }
}

// ----- TC-AUTH-04 -----
async function tcAuth04() {
  await nextWindow();
  const outsider = await apiLogin('qa_f1_fd_cs02');
  if (outsider.status !== 200) {
    fail('TC-AUTH-04 · chuẩn bị FRONT_DESK CS-02', `login ${outsider.status} ${outsider.body?.code}`);
    return;
  }
  const token = outsider.body.accessToken;
  const from = businessDate(cursor, 0);
  const to = businessDate(cursor, 2);
  const gridPath = `/inventory/grid?propertyId=${props['CS-01']}&from=${from}&to=${to}`;
  const owner = await apiLogin('owner');
  const ownerGrid = await api(gridPath, { token: owner.body.accessToken });
  report('TC-AUTH-04 · oracle OWNER đọc tồn CS-01', ownerGrid.status === 200, `HTTP ${ownerGrid.status}`);

  const attempts = [
    ['tồn phòng (inventory/grid)', await api(gridPath, { token })],
    ['hồ sơ khách (guests)', await api(`/guests?propertyId=${props['CS-01']}`, { token })],
    ['nhiệm vụ buồng phòng (housekeeping/tasks)', await api(`/housekeeping/tasks?propertyId=${props['CS-01']}&businessDate=${from}`, { token })],
  ];
  for (const [label, response] of attempts) {
    report(
      `TC-AUTH-04 · FRONT_DESK CS-02 đọc ${label} CS-01 bị chặn`,
      response.status === 403,
      `HTTP ${response.status} ${response.body?.code ?? ''}`,
    );
  }
  const bookings = await api(`/bookings?propertyId=${props['CS-01']}`, { token });
  const empty =
    bookings.status === 200 && Array.isArray(bookings.body?.data) && bookings.body.data.length === 0;
  report(
    'TC-AUTH-04 · danh sách booking CS-01 không trả bản ghi nào',
    empty,
    `HTTP ${bookings.status}, data=${bookings.body?.data?.length ?? '?'}`,
  );
}

// ----- TC-AUTH-01 -----
async function tcAuth01() {
  await nextWindow();
  const lockedAt = cursor;
  const wrong = [];
  for (let index = 0; index < 5; index += 1) {
    wrong.push(
      await api('/auth/login', {
        method: 'POST',
        body: { username: 'qa_f1_lock', password: 'Sai-mat-khau-QA1', clientSurface: 'OPS_WEB' },
        key: null,
      }),
    );
  }
  const codes = wrong.map((response) => `${response.status}:${response.body?.code ?? '?'}`);
  report(
    'TC-AUTH-01 · 5 lần sai liên tiếp trả 401 chung (không lộ tài khoản)',
    codes.every((code) => code === '401:E_AUTH_INVALID_CREDENTIALS'),
    codes.join(' · '),
  );

  const sixth = await apiLogin('qa_f1_lock');
  report(
    'TC-AUTH-01 · lần thứ 6 đúng mật khẩu vẫn bị từ chối (E_AUTH_ACCOUNT_LOCKED)',
    sixth.status === 401 && sixth.body?.code === 'E_AUTH_ACCOUNT_LOCKED',
    `HTTP ${sixth.status} ${sixth.body?.code ?? ''}, retryAfterSeconds=${sixth.body?.retryAfterSeconds ?? '—'}`,
  );

  const [row] = await sql(
    'SELECT failed_login_count, locked_until FROM users WHERE username = $1',
    ['qa_f1_lock'],
  );
  const lockedUntilMs = row?.locked_until ? new Date(row.locked_until).getTime() : 0;
  const deltaSeconds = Math.round((lockedUntilMs - lockedAt) / 1000);
  report(
    'TC-AUTH-01 · User.failedLoginCount = 5 và lockedUntil = lúc khoá + 15 phút',
    row?.failed_login_count === 5 && deltaSeconds >= 895 && deltaSeconds <= 905,
    `failed_login_count=${row?.failed_login_count}, locked_until−T=${deltaSeconds}s`,
  );

  // Màn đăng nhập thật phải hiện đúng trạng thái khoá (ô hạn mức mới ⇒ không lẫn 429).
  await nextWindow();
  const { context, page } = await newPage();
  try {
    await opsLogin(page, 'qa_f1_lock');
    const failureText = await page.getByTestId('login-failure').innerText();
    report(
      'TC-AUTH-01 · màn đăng nhập hiện "tạm khoá" kèm thời gian chờ',
      failureText.includes('tạm khoá') && /sau \d+ phút/.test(failureText),
      failureText.trim(),
    );
  } catch (error) {
    fail('TC-AUTH-01 · màn đăng nhập hiện trạng thái khoá', error.message);
  } finally {
    await context.close();
  }

  await advance(16);
  const unlocked = await apiLogin('qa_f1_lock');
  const [after] = await sql(
    'SELECT failed_login_count, locked_until FROM users WHERE username = $1',
    ['qa_f1_lock'],
  );
  report(
    'TC-AUTH-01 · hết 15 phút tự mở khoá và bộ đếm về 0',
    unlocked.status === 200 && after?.failed_login_count === 0 && after?.locked_until === null,
    `HTTP ${unlocked.status}, failed=${after?.failed_login_count}, locked_until=${after?.locked_until ?? 'null'}`,
  );
}

// ----- TC-AUTH-02 (máy chủ) -----
async function tcAuth02Server() {
  await nextWindow();
  const login = await apiLogin('accountant', { surface: 'OPS_ANDROID' });
  const token = login.body?.accessToken;
  if (token === undefined) {
    fail('TC-AUTH-02 · token TTL 900 giây', `login ${login.status} ${login.body?.code}`);
    return;
  }
  const claims = decodeJwt(token);
  report(
    'TC-AUTH-02 · access token TTL 900 giây theo đồng hồ tiêm (exp − iat)',
    claims.exp - claims.iat === 900,
    `iat=${new Date(claims.iat * 1000).toISOString()} exp=${new Date(claims.exp * 1000).toISOString()}`,
  );
  const before = await api('/auth/me', { token });
  await advance(16);
  const after = await api('/auth/me', { token });
  report(
    'TC-AUTH-02 · cùng token sau 16 phút bị từ chối 401 (không thao tác được bằng phiên cũ)',
    before.status === 200 && after.status === 401,
    `trước=${before.status}, sau=${after.status} ${after.body?.code ?? ''}`,
  );
}

// ----- TC-AUTH-02 (web) -----
async function tcAuth02Web() {
  await nextWindow();
  const { context, page } = await newPage();
  try {
    await openUsersAs(page, 'manager');
    await page.getByTestId('users-table').waitFor({ state: 'visible' });
    const rows = await page.getByTestId('users-table').locator('tbody tr').count();
    if (rows === 0) {
      fail('TC-AUTH-02 · phiên web hết sau 15 phút nhàn rỗi', 'bảng người dùng rỗng trước khi hết phiên');
      return;
    }
    await advance(16);
    await page.getByTestId('users-reload').click();
    await page.getByTestId('users-expired').waitFor({ state: 'visible' });
    const tableGone = (await page.getByTestId('users-table').count()) === 0;
    report(
      'TC-AUTH-02 · request kế tiếp sau 16 phút bị chặn, bảng cũ bị bỏ',
      tableGone,
      `trước=${rows} hàng, sau: users-expired hiện, users-table=${tableGone ? 'đã bỏ' : 'còn'}`,
    );

    await page.reload();
    await page.waitForURL((url) => url.pathname === '/login', { timeout: 40_000 });
    const barGone = (await page.getByTestId('staff-bar').count()) === 0;
    report(
      'TC-AUTH-02 · tải lại trang bị đẩy về /login (phiên máy chủ đã chết)',
      barGone && page.url().includes('/login'),
      `${new URL(page.url()).pathname}${new URL(page.url()).search}`,
    );
  } catch (error) {
    fail('TC-AUTH-02 · phiên web hết sau 15 phút nhàn rỗi', error.message);
  } finally {
    await context.close();
  }
}

// ----- TC-AUTH-10 -----
async function tcAuth10() {
  // (a) thu hồi phạm vi cơ sở khi token còn hạn ⇒ request kế tiếp 403 ngay (guard đọc CSDL mỗi request).
  await nextWindow();
  const login = await apiLogin('manager', { surface: 'OPS_WEB' });
  const token = login.body?.accessToken;
  const from = businessDate(cursor, 0);
  const to = businessDate(cursor, 1);
  const gridPath = `/inventory/grid?propertyId=${props['CS-01']}&from=${from}&to=${to}`;
  const before = await api(gridPath, { token });
  await sql(
    'DELETE FROM user_property_scopes WHERE user_id = (SELECT id FROM users WHERE username = $1) AND property_id = $2',
    ['manager', props['CS-01']],
  );
  let after;
  try {
    after = await api(gridPath, { token });
  } finally {
    await sql(
      "INSERT INTO user_property_scopes (user_id, property_id) SELECT id, $2 FROM users WHERE username = $1 ON CONFLICT DO NOTHING",
      ['manager', props['CS-01']],
    );
  }
  report(
    'TC-AUTH-10 · thu hồi scope CS-01 khi token còn hạn ⇒ request kế tiếp 403',
    before.status === 200 && after.status === 403,
    `trước=${before.status}, sau=${after.status} ${after.body?.code ?? ''}`,
  );

  // (b) thu hồi quyền (đổi vai trò) khi trang SCR-15 đang mở ⇒ màn hình bỏ dữ liệu cũ, hiện từ chối.
  await nextWindow();
  const { context, page } = await newPage();
  try {
    await openUsersAs(page, 'manager');
    await page.getByTestId('users-table').waitFor({ state: 'visible' });
    const stale = await page.getByTestId('users-table').locator('tbody tr').count();
    await sql("UPDATE users SET role = 'HOUSEKEEPING' WHERE username = 'manager'");
    let forbidden;
    try {
      await page.getByTestId('users-reload').click();
      await page.getByText('Bạn không có quyền xem nội dung này').waitFor({ state: 'visible' });
      forbidden = true;
    } finally {
      await sql("UPDATE users SET role = 'MANAGER' WHERE username = 'manager'");
    }
    const tableGone = (await page.getByTestId('users-table').count()) === 0;
    report(
      'TC-AUTH-10 · thu hồi vai trò khi đang mở SCR-15 ⇒ bị chặn và không còn dữ liệu cũ',
      forbidden && tableGone,
      `trước=${stale} hàng, sau: forbidden=${forbidden}, users-table=${tableGone ? 'đã bỏ' : 'còn'}`,
    );
  } catch (error) {
    fail('TC-AUTH-10 · thu hồi vai trò khi đang mở SCR-15', error.message);
  } finally {
    await context.close();
  }
}

// ----- HOUSEKEEPING không thấy tuyến quản trị -----
async function housekeepingAdmin() {
  await nextWindow();
  const { context, page } = await newPage();
  try {
    await opsLogin(page, 'housekeeping');
    await settleOps(page);
    await page.goto('/admin/users');
    await page.getByText('Bạn không có quyền xem nội dung này').waitFor({ state: 'visible' });
    const table = await page.getByTestId('users-table').count();
    report(
      'SCR-14/SCR-15 · HOUSEKEEPING vào /admin/users chỉ thấy từ chối, không có bảng',
      table === 0 && page.url().endsWith('/admin/users'),
      `HTTP hiển thị forbidden, users-table=${table}`,
    );
  } catch (error) {
    fail('SCR-14/SCR-15 · HOUSEKEEPING vào /admin/users', error.message);
  } finally {
    await context.close();
  }
}

// ----- khách: đăng ký / đăng nhập / quên mật khẩu qua Mailpit -----
function freshPhone() {
  return `+849${String(randomInt(10_000_000, 99_999_999))}`;
}

async function guestSignedIn(context, page) {
  await page.waitForURL((url) => url.pathname === '/profile', { timeout: 40_000 });
  const cookies = await context.cookies();
  return cookies.some((cookie) => cookie.name === 'pinehill_guest_refresh');
}

async function guestRegisterAndLogin() {
  await nextWindow();
  await mailpitClear();
  const phone = freshPhone();
  const email = `qa.f1.${Date.now()}.${randomInt(1000, 9999)}@example.test`;
  const password = 'Qa-Guest-Pass-2026!';
  guest = { phone, email, password };
  const { context, page } = await newPage(CUST);
  try {
    await page.goto('/account/register');
    await page.getByLabel('Họ và tên').fill('Khách QA F1');
    await page.getByLabel('Số điện thoại').fill(phone);
    await page.getByLabel('Email (không bắt buộc)').fill(email);
    await page.getByLabel('Mật khẩu', { exact: true }).fill(password);
    await page.getByTestId('register-submit').click();
    const signedIn = await guestSignedIn(context, page);
    const [row] = await sql('SELECT id, email FROM guests WHERE phone = $1', [phone]);
    report(
      'SCR-08 · khách đăng ký trên web thật rồi vào phiên',
      row?.email === email && signedIn,
      `guest=${row === undefined ? 'không có' : row.id}, cookie refresh=${signedIn ? 'có' : 'không'}`,
    );

    // Đăng xuất trên đầu trang khu tài khoản rồi đăng nhập lại bằng đúng SĐT/mật khẩu.
    await page.goto('/account/login');
    await page.getByTestId('account-status-text').waitFor({ state: 'visible' });
    await page.waitForFunction(
      () => document.querySelector('[data-testid="account-status-text"]')?.dataset.status === 'in',
    );
    await page.getByTestId('account-logout').click();
    await page.waitForFunction(
      () => document.querySelector('[data-testid="account-status-text"]')?.dataset.status === 'out',
    );
    const afterLogout = await context.cookies();
    const cookieGone = !afterLogout.some((cookie) => cookie.name === 'pinehill_guest_refresh');
    await nextWindow();
    await page.getByLabel('Số điện thoại').fill(phone);
    await page.getByLabel('Mật khẩu', { exact: true }).fill(password);
    await page.getByTestId('login-submit').click();
    const backIn = await guestSignedIn(context, page);
    report(
      'SCR-08 · khách đăng xuất (cookie refresh bị xoá) rồi đăng nhập lại được',
      cookieGone && backIn,
      `cookie pinehill_guest_refresh=${cookieGone ? 'đã xoá' : 'còn'}, đăng nhập lại=${backIn ? 'có phiên' : 'không'}`,
    );
  } catch (error) {
    fail('SCR-08 · khách đăng ký/đăng nhập trên web thật', error.message);
  } finally {
    await context.close();
  }
}

async function guestPasswordReset() {
  if (guest.phone === undefined) {
    blocked('SCR-08 · quên mật khẩu qua Mailpit', 'không có tài khoản khách từ bước đăng ký');
    return;
  }
  await nextWindow();
  const newPassword = 'Qa-Guest-Pass-2026-New!';
  const { context, page } = await newPage(CUST);
  try {
    await page.goto('/account/forgot-password');
    await page.getByLabel('Số điện thoại').fill(guest.phone);
    await page.getByTestId('forgot-submit').click();
    await page.getByTestId('forgot-done').waitFor({ state: 'visible' });

    const message = await mailTo(guest.email);
    const link = /https?:\/\/\S+reset-password\?token=[^\s]+/.exec(message.text)?.[0];
    report(
      'SCR-08 · yêu cầu đặt lại mật khẩu gửi thư thật qua SMTP tới Mailpit',
      message.subject === 'Đặt lại mật khẩu tài khoản Pine Hill' && link !== undefined,
      `${message.subject}${link === undefined ? ' — không thấy liên kết' : ''}`,
    );
    if (link === undefined) return;

    const target = new URL(link);
    await page.goto(`${target.pathname}${target.search}`);
    await page.getByTestId('reset-screen').waitFor({ state: 'visible' });
    await page.getByLabel('Mật khẩu mới', { exact: true }).fill(newPassword);
    await page.getByLabel('Nhập lại mật khẩu mới').fill(newPassword);
    await page.getByTestId('reset-submit').click();
    await page.getByTestId('reset-done').waitFor({ state: 'visible' });

    await nextWindow();
    await page.goto('/account/login');
    await page.getByLabel('Số điện thoại').fill(guest.phone);
    await page.getByLabel('Mật khẩu', { exact: true }).fill(newPassword);
    await page.getByTestId('login-submit').click();
    const signedIn = await guestSignedIn(context, page);
    const [used] = await sql(
      'SELECT count(*)::int AS total FROM guest_password_resets WHERE guest_id = (SELECT id FROM guests WHERE phone = $1) AND consumed_at IS NOT NULL',
      [guest.phone],
    );
    report(
      'SCR-08 · token một lần đổi mật khẩu, đăng nhập bằng mật khẩu mới',
      used?.total === 1 && signedIn,
      `token đã dùng=${used?.total}, đăng nhập=${signedIn ? 'có phiên' : 'không'}`,
    );
  } catch (error) {
    fail('SCR-08 · quên mật khẩu qua Mailpit', error.message);
  } finally {
    await context.close();
  }
}

// ----- axe trên mọi màn F1 -----
async function a11yScans() {
  // Ops công khai
  {
    const { context, page } = await newPage();
    try {
      await page.goto('/login');
      await page.getByTestId('login-submit').waitFor();
      await axeCheck(page, 'ops /login');
    } catch (error) {
      fail('axe · ops /login', error.message);
    } finally {
      await context.close();
    }
  }
  // Ops sau đăng nhập: trang chủ + /access-denied
  {
    await nextWindow();
    const { context, page } = await newPage();
    try {
      await opsLogin(page, 'frontdesk');
      await settleOps(page);
      await page.getByTestId('staff-bar').waitFor();
      await axeCheck(page, 'ops / (trang chủ)');
      await page.goto('/access-denied');
      await page.getByTestId('staff-bar').waitFor();
      await axeCheck(page, 'ops /access-denied');
    } catch (error) {
      fail('axe · ops trang chủ/access-denied', error.message);
    } finally {
      await context.close();
    }
  }
  // Ops: /select-property và /admin/users (MANAGER)
  {
    await nextWindow();
    const { context, page } = await newPage();
    try {
      await opsLogin(page, 'manager');
      await page.waitForURL((url) => url.pathname === '/select-property', { timeout: 40_000 });
      await page.getByTestId('property-continue').waitFor();
      await axeCheck(page, 'ops /select-property');
      await page.getByRole('radio').first().check();
      await page.getByTestId('property-continue').click();
      await page.getByTestId('staff-bar').waitFor();
      await page.goto('/admin/users');
      await page.getByTestId('users-table').waitFor({ state: 'visible' });
      await axeCheck(page, 'ops /admin/users');
    } catch (error) {
      fail('axe · ops /select-property hoặc /admin/users', error.message);
    } finally {
      await context.close();
    }
  }
  // Ops: /change-password (tài khoản bắt buộc đổi mật khẩu)
  {
    await nextWindow();
    const { context, page } = await newPage();
    let me = { status: 0, body: undefined };
    try {
      const apiSession = await apiLogin('qa_f1_must');
      me = await api('/auth/me', { token: apiSession.body?.accessToken });
      await opsLogin(page, 'qa_f1_must');
      await page.getByTestId('change-submit').waitFor({ state: 'visible', timeout: 15_000 });
      await axeCheck(page, 'ops /change-password');
      report(
        'SCR-14 · GET /auth/me cho tài khoản buộc đổi mật khẩu',
        me.status === 200,
        `HTTP ${me.status} ${me.body?.code ?? ''}`,
      );
    } catch (error) {
      const dom = (await page.locator('body').innerText().catch(() => '')).slice(0, 400);
      const evidence =
        `GET /auth/me → HTTP ${me.status} ${me.body?.code ?? ''}; màn /change-password dừng ở: ` +
        `${dom.replaceAll('\n', ' | ')}; lỗi chờ: ${error.message.split('\n')[0]}`;
      blocked('axe · ops /change-password', 'không chạy được: màn không hiển thị (phát hiện F1-02)', evidence);
      finding(
        'F1-02',
        'SCR-14 /change-password treo ở "Đang kiểm tra phiên…" với tài khoản must_change_password trên API thật',
        `${evidence} — AuthGuard của apps/api chặn GET /auth/me bằng 403 E_AUTH_PASSWORD_CHANGE_REQUIRED vì tuyến không có @AllowPasswordChange, còn useStaffGate luôn gọi loadProfile trước khi xét stage; E2E cũ (ops-auth.spec.ts) chỉ chạy API giả luôn trả mustChangePassword nên không lộ.`,
      );
    } finally {
      await context.close();
    }
  }
  // Khách
  {
    const { context, page } = await newPage(CUST);
    try {
      for (const [path, label] of [
        ['/', 'customer /'],
        ['/account/register', 'customer /account/register'],
        ['/account/login', 'customer /account/login'],
        ['/account/forgot-password', 'customer /account/forgot-password'],
        ['/account/reset-password?token=qa-invalid-token', 'customer /account/reset-password'],
        ['/access-denied', 'customer /access-denied'],
      ]) {
        await page.goto(path);
        await page.waitForLoadState('networkidle');
        await axeCheck(page, label);
      }
    } catch (error) {
      fail('axe · màn khách', error.message);
    } finally {
      await context.close();
    }
  }
}

// ----- WebKit -----
async function webkitAvailability() {
  if (!REQUESTED_BROWSERS.includes('webkit')) {
    pass('WebKit · NFR-USE-04', 'không yêu cầu trong E2E_BROWSERS');
    return;
  }
  try {
    const instance = await webkit.launch();
    await instance.close();
    pass('WebKit · NFR-USE-04', 'khởi động được trên host');
  } catch (error) {
    const message = error.message.includes('missing dependencies')
      ? 'Host thiếu thư viện hệ thống (libicu74, libjpeg-turbo8)'
      : error.message.split('\n')[0];
    blocked(
      'WebKit · NFR-USE-04 (axe + luồng F1 trên WebKit)',
      `${message} — cần cài dependency của Playwright hoặc máy khác`,
      `playwright webkit.launch() → ${error.message.split('\n').slice(0, 3).join(' ')}`,
    );
  }
}

// ----- Maestro -----
function maestroAvailability() {
  const maestro = spawnSync('bash', ['-lc', 'command -v maestro || true'], { encoding: 'utf8' }).stdout.trim();
  const adb = spawnSync('bash', ['-lc', 'command -v adb || true'], { encoding: 'utf8' }).stdout.trim();
  const flows = ['tests/maestro/hb025-scr56-login-pin.yaml', 'tests/maestro/hb025-scr71-guest-auth.yaml'].map(
    (file) => `${file}=${existsSync(join(repoRoot, file)) ? 'có' : 'thiếu'}`,
  );
  blocked(
    'Maestro · SCR-56 (đăng nhập, đặt PIN, sai PIN 3 lần) và SCR-71',
    `không có thiết bị/emulator: maestro=${maestro === '' ? 'không có' : maestro}, adb=${adb === '' ? 'không có' : adb}`,
    `luồng đã giao: ${flows.join(', ')}`,
  );
}

// ----- phát hiện CORS: browser gọi thẳng API khác origin -----
async function corsFinding() {
  const target = `${API_BASE}/users`;
  const preflight = await fetch(target, {
    method: 'OPTIONS',
    headers: {
      origin: OPS,
      'access-control-request-method': 'GET',
      'access-control-request-headers': 'authorization',
    },
  });
  const allowOrigin = preflight.headers.get('access-control-allow-origin');
  if (allowOrigin === null) {
    finding(
      'F1-01',
      'API không trả CORS cho web khác origin: SCR-15 gọi thẳng /api/v1/users từ browser sẽ hỏng khi triển khai Vercel → API tách miền',
      `OPTIONS ${target} (Origin: ${OPS}) → HTTP ${preflight.status}, access-control-allow-origin=null; ` +
        'apps/api/src/main.ts không bật CORS. Harness dùng reverse proxy cùng-origin để kiểm phần còn lại.',
    );
  } else {
    pass('CORS · preflight cho browser khác origin', `allow-origin=${allowOrigin}`);
  }
}

// ----- chạy -----
try {
  console.log(`# API thật: ${API_BASE} · operations ${OPS} · customer ${CUST}`);
  await bootstrap();
  await prepareData();
  ensureBuild(OPS_FILTER, join(repoRoot, 'apps/operations-web'));
  ensureBuild(CUST_FILTER, join(repoRoot, 'apps/customer-web'));

  const opsEnv = { NEXT_PUBLIC_API_BASE_URL: `${OPS}/api/v1`, SESSION_APP_ORIGIN: OPS };
  const custEnv = { NEXT_PUBLIC_API_BASE_URL: `${CUST}/api/v1`, SESSION_APP_ORIGIN: CUST };
  startNext({ filter: OPS_FILTER, port: opsInternal, env: opsEnv });
  startNext({ filter: CUST_FILTER, port: custInternal, env: custEnv });
  await waitForHttp(`http://127.0.0.1:${opsInternal}/login`, 120_000);
  await waitForHttp(`http://127.0.0.1:${custInternal}/account/login`, 120_000);
  proxies.push(await startProxy({ port: opsPort, nextPort: opsInternal, apiBase: `${API_BASE}` }));
  proxies.push(await startProxy({ port: custPort, nextPort: custInternal, apiBase: `${API_BASE}` }));
  await waitForHttp(`${OPS}/login`, 30_000);
  await waitForHttp(`${CUST}/account/login`, 30_000);

  browser = await chromium.launch();

  await roleSweep();
  await tcAuth04();
  await tcAuth01();
  await tcAuth02Server();
  await tcAuth02Web();
  await tcAuth10();
  await housekeepingAdmin();
  await guestRegisterAndLogin();
  await guestPasswordReset();
  await a11yScans();
  await webkitAvailability();
  maestroAvailability();
  await corsFinding();
} catch (error) {
  fail('hạ tầng harness', error.stack ?? error.message);
} finally {
  const counts = summarize();
  await shutdown();
  process.exitCode = counts.FAIL > 0 ? 1 : 0;
}
