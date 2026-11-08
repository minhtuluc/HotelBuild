#!/usr/bin/env node
/**
 * HB-194 AC2 — mở SCR-40…47 của operations web **thật** (`next start`) trên API + worker thật, Chromium.
 *
 * Không có route mock: trình duyệt → proxy cùng-origin (`f1/qa-f1-lib.mjs::startProxy`) → Next (BFF
 * `app/api/session/sys/**`) → API thật. Dữ liệu F6 dựng bằng đường production (webhook OTA có ký, room move).
 * Mỗi màn ghi: HTTP của mọi lệnh BFF/API trình duyệt gọi, các `role=alert` hiển thị, và axe serious/critical.
 * WebKit: ghi BLOCKED nếu không khởi động được (host Fedora thiếu thư viện; cookie `Secure` trên http — TD-53).
 *
 * Chạy: `REDIS_URL=redis://127.0.0.1:6379/10 node tests/e2e/f6-qa/qa-f6-web.mjs` (cần build operations-web).
 */
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { chromium, webkit } from '@playwright/test';
import { axeBlocking, ensureBuild, freePort, killWeb, startNext, startProxy, waitForHttp } from '../f1/qa-f1-lib.mjs';
import {
  API_BASE,
  blocked,
  bookingOf,
  bootstrap,
  check,
  finding,
  ids,
  login,
  otaPrice,
  otaSend,
  PASSWORD,
  PROPERTY,
  repoRoot,
  setClock,
  sql,
  teardown,
  waitInbox,
  writeReport,
} from './qa-f6-lib.mjs';

const started = new Date();
const sha = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: repoRoot, encoding: 'utf8' }).stdout.trim();
const OPS_FILTER = '@pinehill/operations-web';

/** Dữ liệu tối thiểu cho mọi màn: vài booking OTA, một ca quá tải STD 12/12, một walk-out đề xuất. */
async function prepareData() {
  const stay = { roomType: 'STD', checkIn: '2026-12-12', checkOut: '2026-12-13' };
  const amount = await otaPrice({ channelCode: 'OTA_BOOKING', ...stay });
  for (let i = 1; i <= 9; i += 1) {
    const r = await otaSend({ code: `W-${i}`, ...stay, amount });
    await waitInbox(r.eventId);
  }
  const [c] = await sql('SELECT id FROM overbooking_cases WHERE room_type_id = $1 AND date = $2', [ids.roomType[PROPERTY].STD, stay.checkIn]);
  const victim = await bookingOf('W-9');
  const [br] = await sql('SELECT id FROM booking_rooms WHERE booking_id = $1', [victim.id]);
  const fd = await login('frontdesk');
  const move = await (
    await fetch(`${API_BASE}/room-moves`, {
      method: 'POST',
      headers: { authorization: `Bearer ${fd}`, 'content-type': 'application/json', 'idempotency-key': crypto.randomUUID() },
      body: JSON.stringify({
        overbookingCaseId: c.id,
        bookingId: victim.id,
        bookingRoomId: br.id,
        moveType: 'WALK_OUT',
        reason: 'HB-194 web walk-out',
        compensationAmount: 0,
        transportCost: 0,
        walkOutDocNo: 'WO-HB194-WEB',
        guestSignatureRef: 'sig-guest-web',
        staffSignatureRef: 'sig-staff-web',
      }),
    })
  ).json();
  return { caseId: c.id, bookingId: victim.id, bookingRoomId: br.id, moveId: move.id };
}

async function staffSession(browser, base, username) {
  const context = await browser.newContext({ baseURL: base, viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();
  page.setDefaultTimeout(30_000);
  await page.goto('/login');
  await page.getByLabel('Tên đăng nhập').fill(username);
  await page.getByLabel('Mật khẩu', { exact: true }).fill(PASSWORD);
  await page.getByTestId('login-submit').click();
  await page.waitForFunction(
    () => location.pathname === '/select-property' || document.querySelector('[data-testid="staff-bar"]') !== null,
    null,
    { timeout: 40_000 },
  );
  if (page.url().includes('/select-property')) {
    await page.getByRole('radio').first().check();
    await page.getByTestId('property-continue').click();
    await page.getByTestId('staff-bar').waitFor({ state: 'visible' });
  }
  return { context, page };
}

/** Mở một màn, chờ mạng lặng, trả các lệnh lỗi + thông báo lỗi đang hiển thị. */
async function visit(page, path) {
  const calls = [];
  const onResponse = (response) => {
    const url = new URL(response.url());
    if (url.pathname.startsWith('/api/')) calls.push({ path: url.pathname, status: response.status() });
  };
  page.on('response', onResponse);
  await page.goto(path);
  await page.waitForLoadState('networkidle').catch(() => undefined);
  await page.waitForTimeout(1500);
  page.off('response', onResponse);
  const alerts = (await page.getByRole('alert').allInnerTexts()).map((t) => t.replace(/\s+/g, ' ').trim()).filter(Boolean);
  const heading = (await page.getByRole('heading', { level: 1 }).allInnerTexts())[0] ?? null;
  return { calls, alerts, heading };
}

async function surfaces(browserName, browser, base, data) {
  const screens = [
    ['SCR-40', '/channels/configuration', 'owner'],
    ['SCR-41', '/channels/sync', 'manager'],
    ['SCR-42', '/channels/ota-bookings', 'manager'],
    ['SCR-43', '/overbooking/cases', 'manager'],
    ['SCR-44', `/overbooking/relocation?caseId=${data.caseId}&bookingId=${data.bookingId}&bookingRoomId=${data.bookingRoomId}`, 'frontdesk'],
    ['SCR-45/46', `/overbooking/merge-walkout?moveId=${data.moveId}`, 'manager'],
    ['SCR-47', '/overbooking/policy-exceptions', 'manager'],
  ];
  const sessions = {};
  for (const [scr, path, user] of screens) {
    const name = `${scr}_${browserName}_real_api`;
    try {
      sessions[user] ??= await staffSession(browser, base, user);
      const { page } = sessions[user];
      const result = await visit(page, path);
      const failed = result.calls.filter((c) => c.status >= 400);
      const errorAlerts = result.alerts.filter((a) => /Không gọi được|protocol|lỗi|không khớp|Không thể/i.test(a));
      const axe = await axeBlocking(page);
      check(
        `real_api_chromium_webkit_routes::${name}`,
        result.heading !== null && failed.length === 0 && errorAlerts.length === 0,
        `user=${user} h1=${JSON.stringify(result.heading)} failedCalls=${JSON.stringify(failed)} alerts=${JSON.stringify(result.alerts)} calls=${result.calls.length}`,
      );
      check(`keyboard_axe_mobile_width::${name}::axe`, axe.length === 0, axe.length === 0 ? '0 serious/critical' : axe.join(', '));
      await page.setViewportSize({ width: 360, height: 800 });
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      check(`keyboard_axe_mobile_width::${name}::360px_no_horizontal_scroll`, overflow <= 0, `overflowPx=${overflow}`);
      await page.setViewportSize({ width: 1280, height: 900 });
    } catch (error) {
      check(`real_api_chromium_webkit_routes::${name}`, false, error instanceof Error ? error.message.split('\n')[0] : String(error));
    }
  }
  for (const s of Object.values(sessions)) await s.context.close();
}

const proxies = [];
let chrome;
try {
  await bootstrap();
  await setClock('2026-12-01', '09:00');
  const data = await prepareData();
  ensureBuild(OPS_FILTER, join(repoRoot, 'apps/operations-web'));
  const internal = await freePort();
  const opsPort = await freePort();
  const OPS = `http://127.0.0.1:${opsPort}`;
  startNext({ filter: OPS_FILTER, port: internal, env: { NEXT_PUBLIC_API_BASE_URL: `${OPS}/api/v1`, SESSION_APP_ORIGIN: OPS } });
  await waitForHttp(`http://127.0.0.1:${internal}/login`, 120_000);
  proxies.push(await startProxy({ port: opsPort, nextPort: internal, apiBase: API_BASE }));
  await waitForHttp(`${OPS}/login`, 30_000);

  chrome = await chromium.launch();
  await surfaces('chromium', chrome, OPS, data);
  try {
    const wk = await webkit.launch();
    await wk.close();
    blocked('real_api_chromium_webkit_routes::webkit', 'WebKit khởi động được nhưng cookie phiên `Secure` bị bỏ trên http://127.0.0.1 (TD-53) — không đăng nhập được');
  } catch (error) {
    blocked('real_api_chromium_webkit_routes::webkit', `WebKit không khởi động trên host: ${String(error.message).split('\n')[0]}`);
  }
  const versions = { chromium: chrome.version() };
  console.log(`# trình duyệt: ${JSON.stringify(versions)}`);
  if (process.env.QA_FINDINGS !== '0') {
    const failures = (await import('./qa-f6-lib.mjs')).results.filter((r) => !r.pass && r.name.startsWith('real_api'));
    if (failures.length > 0)
      finding('QA-F6-11', `${failures.length} màn F6 lỗi khi mở trên API thật (Chromium)`, failures.map((f) => f.name).join(', '));
  }
} finally {
  await chrome?.close().catch(() => undefined);
  for (const p of proxies) p.close?.();
  killWeb();
  writeReport('web', { sha, startedAt: started.toISOString(), finishedAt: new Date().toISOString() });
  await teardown();
}
