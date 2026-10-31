#!/usr/bin/env node
/**
 * HB-187 — đối chiếu giá giữa API và các frontend (BR-RATE-17, TC-RATE-21) + đo lại NFR giao diện (NFR-PERF-05).
 *
 * Nguồn đo được trên máy này: **API thật**, **customer-web**, **operations-web** (hai web chạy ở chế độ
 * `next start` trên API thật + CSDL tạm do `tests/e2e/f5/qa-f5-lib.mjs` dựng). **customer-android** và
 * **operations-android** là BLOCKED (không có `adb`/emulator): chạy bộ unit của hai app và kiểm tĩnh rằng
 * chúng dùng chung `@pinehill/api-client`/`@pinehill/contracts` — cùng nguồn giá với web và API.
 *
 *   DATABASE_MIGRATION_URL='postgresql://pinehill:pinehill_dev@127.0.0.1:5432/pinehill' \
 *   REDIS_URL='redis://127.0.0.1:6379/14' NODE_ENV=development \
 *   node tests/e2e/price-parity/run.mjs
 *
 * `SKIP_BUILD=1` bỏ `next build` khi `.next` đã dựng cho cùng `BUILD_API_BASE` (mặc định: build lại).
 */
import { spawn, spawnSync } from 'node:child_process';
import { createServer } from 'node:http';
import { gzipSync } from 'node:zlib';
import { chromium } from '@playwright/test';
import { API_BASE, PASSWORD, api, bootstrap, login, repoRoot, sql, teardown, wait } from '../f5/qa-f5-lib.mjs';

const CUSTOMER_PORT = Number(process.env.PARITY_CUSTOMER_PORT ?? 3101);
const OPS_PORT = Number(process.env.PARITY_OPS_PORT ?? 3102);
const CUSTOMER = `http://127.0.0.1:${CUSTOMER_PORT}`;
const OPS = `http://127.0.0.1:${OPS_PORT}`;
/**
 * `NEXT_PUBLIC_*` được nhúng **lúc build**, còn cổng API của harness đổi mỗi lượt. Build hai web với địa chỉ
 * cố định này, rồi reverse proxy cùng cổng trỏ về API thật của lượt hiện tại (thêm CORS cho trình duyệt).
 */
const BUILD_API_BASE = 'http://127.0.0.1:4310/api/v1';
const PROXY_PORT = 4310;
const DAY = 86_400_000;
const results = [];
const children = [];

const check = (name, pass, detail) => {
  results.push({ name, pass, detail });
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail === undefined ? '' : ` — ${detail}`}`);
};
const vnDate = (ms) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Ho_Chi_Minh' }).format(new Date(ms));
const addDays = (date, n) => vnDate(Date.parse(`${date}T00:00:00Z`) + n * DAY);
const vnd = (text) => {
  const match = String(text).match(/([\d.]+)\s*₫/u);
  return match === null ? null : Number(match[1].replaceAll('.', ''));
};
const money = (n) => `${Number(n).toLocaleString('vi-VN')} ₫`;

function shutDown() {
  for (const child of children) {
    if (child.pid !== undefined) {
      try {
        process.kill(-child.pid, 'SIGKILL');
      } catch {
        /* nhóm đã chết */
      }
    }
  }
}
process.on('exit', shutDown);

function start(args, env) {
  const child = spawn('pnpm', args, {
    cwd: repoRoot,
    env: { ...process.env, ...env },
    stdio: ['ignore', 'ignore', 'inherit'],
    detached: true,
  });
  children.push(child);
  return child;
}

const CORS_HEADERS = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'authorization,content-type,idempotency-key,if-match',
  'access-control-allow-methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS',
  'access-control-expose-headers': 'etag,location,retry-after',
};

/** Reverse proxy `BUILD_API_BASE` → API thật của lượt chạy (thêm CORS cho trình duyệt của hai web). */
function startApiProxy() {
  const server = createServer(async (request, response) => {
    if (request.method === 'OPTIONS') {
      response.writeHead(204, CORS_HEADERS);
      response.end();
      return;
    }
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    try {
      const upstream = await fetch(`${API_BASE}${(request.url ?? '').replace(/^\/api\/v1/, '')}`, {
        method: request.method,
        headers: { ...request.headers, host: new URL(API_BASE).host },
        body: chunks.length === 0 ? undefined : Buffer.concat(chunks),
        redirect: 'manual',
      });
      const body = Buffer.from(await upstream.arrayBuffer());
      const headers = Object.fromEntries(upstream.headers);
      delete headers['content-encoding'];
      delete headers['transfer-encoding'];
      response.writeHead(upstream.status, { ...headers, ...CORS_HEADERS, 'content-length': String(body.length) });
      response.end(body);
    } catch (error) {
      response.writeHead(502, CORS_HEADERS);
      response.end(String(error));
    }
  });
  server.listen(PROXY_PORT, '127.0.0.1');
  server.unref();
  return server;
}

async function waitFor(url, label) {
  for (let attempt = 0; attempt < 120; attempt += 1) {
    try {
      if ((await fetch(url)).ok) return;
    } catch {
      /* chưa lên */
    }
    await wait(1000);
  }
  throw new Error(`${label} không lên trong 120 giây`);
}

const quote = (sample, channelCode, planCode = sample.ratePlanCode, token) =>
  api('/quotes', {
    token,
    method: 'POST',
    body: {
      propertyId: sample.propertyId,
      roomTypeId: sample.roomTypeId,
      channelCode,
      ratePlanCode: planCode,
      checkIn: sample.checkIn,
      checkOut: sample.checkOut,
      adults: 2,
      children: 0,
      roomCount: sample.roomCount,
    },
  });

/** Customer web tự chọn gói đầu tiên danh mục trả về (`room-detail-screen`); API phải so với **gói đó**. */
async function firstPlanCode(sample) {
  const list = await api(
    `/rate-plans?propertyId=${sample.propertyId}&checkIn=${sample.checkIn}&checkOut=${sample.checkOut}`,
  );
  const code = list.body?.data?.[0]?.code;
  if (typeof code !== 'string') throw new Error(`không có gói giá cho ${sample.id}`);
  return code;
}

async function readCustomerTotal(page, sample) {
  const query = new URLSearchParams({
    propertyId: sample.propertyId,
    checkIn: sample.checkIn,
    checkOut: sample.checkOut,
    adults: '2',
    children: '0',
    roomCount: String(sample.roomCount),
  });
  await page.goto(`${CUSTOMER}/rooms/${sample.roomTypeId}?${query}`);
  const row = page.locator('[data-testid="quote-summary"] tr').filter({ hasText: 'Tổng phải trả' });
  await row.waitFor({ timeout: 30_000 });
  return vnd(await row.locator('td').innerText());
}

async function loginOps(page) {
  await page.goto(`${OPS}/login`);
  await page.locator('input[autocomplete="username"]').fill('owner');
  await page.locator('input[autocomplete="current-password"]').fill(PASSWORD);
  await page.locator('[data-testid="login-submit"]').click();
  await page.waitForURL((url) => !url.pathname.startsWith('/login'), { timeout: 20_000 });
}

async function readOpsTotal(page, sample) {
  await page.goto(`${OPS}/bookings/new`);
  const channelSelect = page.locator('select[name="channel"]');
  const continueButton = page.locator('[data-testid="property-continue"]');
  // OWNER có 3 cơ sở ⇒ lần đầu vào khu vận hành phải chọn cơ sở.
  await Promise.race([
    channelSelect.waitFor({ timeout: 20_000 }),
    continueButton.waitFor({ timeout: 20_000 }),
  ]).catch(() => undefined);
  if ((await continueButton.count()) > 0) {
    await page.locator(`input[name="property"][value="${sample.propertyId}"]`).check();
    await continueButton.click();
  }
  await channelSelect.waitFor({ timeout: 20_000 });
  await channelSelect.selectOption('WALKIN');
  await page.locator('input[name="propertyId"]').fill(sample.propertyId);
  await page.locator('input[name="checkIn"]').fill(sample.checkIn);
  await page.locator('input[name="checkOut"]').fill(sample.checkOut);
  await page.locator('[data-testid="new-booking-next"]').click();
  await page.locator('select[name="roomTypeId"]').selectOption(sample.roomTypeId, { timeout: 20_000 });
  await page.locator('select[name="ratePlanCode"]').selectOption(sample.ratePlanCode, { timeout: 20_000 });
  await page.locator('[data-testid="new-booking-next"]').click();
  await page.locator('input[name="guestPhone"]').fill('+84900000001');
  await page.locator('input[name="guestFullName"]').fill('Khách QA giá');
  await page.locator('[data-testid="new-booking-next"]').click();
  const line = page.locator('[data-testid="confirm-quote"]');
  await line.waitFor({ timeout: 20_000 });
  return vnd(await line.innerText());
}

try {
  await bootstrap();
  const [property] = await sql('SELECT id FROM properties WHERE code = $1', ['CS-01']);
  const roomTypes = await sql('SELECT code, id FROM room_types WHERE property_id = $1 ORDER BY code', [property.id]);
  const byCode = Object.fromEntries(roomTypes.map((row) => [row.code, row.id]));

  // Điều kiện đầu bằng SQL (CSDL tạm): một mùa cao điểm, để 10 kỳ mẫu khác nhau về mùa/ngày.
  const today = vnDate(Date.now());
  await sql(
    `INSERT INTO seasons (code, name, property_id, start_date, end_date, multiplier, priority, weekend_surcharge_enabled, status)
     VALUES ('SE-SUM', 'Cao điểm QA', $1::uuid, $2::date, $3::date, 1.350, 10, true, 'ACTIVE')`,
    [property.id, addDays(today, 30), addDays(today, 44)],
  );

  const samples = [
    { id: 'S01 giữa tuần · STD · khách web', channel: 'WEB', roomTypeCode: 'STD', checkIn: addDays(today, 10), nights: 2, roomCount: 1 },
    { id: 'S02 cuối tuần · DLX · khách web', channel: 'WEB', roomTypeCode: 'DLX', checkIn: addDays(today, 12), nights: 2, roomCount: 1 },
    { id: 'S03 cuối tuần · SUP · khách web', channel: 'WEB', roomTypeCode: 'SUP', checkIn: addDays(today, 19), nights: 3, roomCount: 1 },
    { id: 'S04 cao điểm · FAM · khách web', channel: 'WEB', roomTypeCode: 'FAM', checkIn: addDays(today, 31), nights: 2, roomCount: 1 },
    { id: 'S05 cao điểm · DLX · khách web (2 phòng)', channel: 'WEB', roomTypeCode: 'DLX', checkIn: addDays(today, 35), nights: 2, roomCount: 2 },
    { id: 'S06 giữa tuần · STD · tại quầy', channel: 'WALKIN', roomTypeCode: 'STD', ratePlanCode: 'FLEX7', checkIn: addDays(today, 11), nights: 2, roomCount: 1 },
    { id: 'S07 cuối tuần · DLX · tại quầy', channel: 'WALKIN', roomTypeCode: 'DLX', ratePlanCode: 'SAVER3', checkIn: addDays(today, 26), nights: 3, roomCount: 1 },
    { id: 'S08 cao điểm · SUP · tại quầy', channel: 'WALKIN', roomTypeCode: 'SUP', ratePlanCode: 'FLEX7', checkIn: addDays(today, 33), nights: 2, roomCount: 1 },
    { id: 'S09 cao điểm · FAM · tại quầy', channel: 'WALKIN', roomTypeCode: 'FAM', ratePlanCode: 'NONREF', checkIn: addDays(today, 40), nights: 2, roomCount: 1 },
    { id: 'S10 cuối tuần · STD · tại quầy (7 đêm)', channel: 'WALKIN', roomTypeCode: 'STD', ratePlanCode: 'FLEX7', checkIn: addDays(today, 45), nights: 7, roomCount: 1 },
  ].map((sample) => ({
    ...sample,
    propertyId: property.id,
    roomTypeId: byCode[sample.roomTypeCode],
    checkOut: addDays(sample.checkIn, sample.nights),
  }));

  const webEnv = {
    NEXT_PUBLIC_API_BASE_URL: BUILD_API_BASE,
    NEXT_TELEMETRY_DISABLED: '1',
    NODE_ENV: 'production',
  };
  if (process.env.SKIP_BUILD !== '1') {
    for (const filter of ['@pinehill/customer-web', '@pinehill/operations-web']) {
      const build = spawnSync('pnpm', ['--filter', filter, 'build'], {
        cwd: repoRoot,
        env: { ...process.env, ...webEnv },
        encoding: 'utf8',
      });
      if (build.status !== 0) {
        console.error(build.stdout, build.stderr);
        throw new Error(`build ${filter} lỗi (mã ${build.status}, tín hiệu ${build.signal})`);
      }
    }
  }
  startApiProxy();
  start(
    ['--filter', '@pinehill/customer-web', 'exec', 'next', 'start', '--port', String(CUSTOMER_PORT)],
    { ...webEnv, SESSION_APP_ORIGIN: CUSTOMER },
  );
  start(
    ['--filter', '@pinehill/operations-web', 'exec', 'next', 'start', '--port', String(OPS_PORT)],
    { ...webEnv, SESSION_APP_ORIGIN: OPS },
  );
  await waitFor(`${CUSTOMER}/api/ready`, 'customer-web');
  await waitFor(`${OPS}/api/ready`, 'operations-web');

  const browser = await chromium.launch();
  const customerPage = await (await browser.newContext()).newPage();
  const opsPage = await (await browser.newContext()).newPage();

  // FINDING F-GIA-01 (sản phẩm, ngoài allow): ops-web gửi POST/PUT tới BFF **thiếu** `x-session-request`
  // ⇒ BFF trả 403 CSRF khi chạy với API thật (E2E cũ chỉ dùng API giả). Bơm header ở tầng trình duyệt để
  // đo được phần còn lại; bằng chứng lỗi nằm trong bảng bằng chứng (mục "Phát hiện").
  await opsPage.route('**/api/session/**', (route) => {
    const request = route.request();
    if (request.method() === 'GET') return route.continue();
    return route.continue({ headers: { ...request.headers(), 'x-session-request': '1' } });
  });
  console.log('# FINDING F-GIA-01: ops-web thiếu `x-session-request` trên POST/PUT tới BFF — harness bơm header để đo tiếp.');
  await loginOps(opsPage);

  const ownerToken = await login('owner');
  const rows = [];
  for (const sample of samples) {
    const planCode = sample.channel === 'WEB' ? await firstPlanCode(sample) : sample.ratePlanCode;
    const fromApi = await quote(sample, sample.channel, planCode, sample.channel === 'WEB' ? undefined : ownerToken);
    const apiTotal = fromApi.body?.total;
    const webTotal =
      sample.channel === 'WEB' ? await readCustomerTotal(customerPage, sample) : await readOpsTotal(opsPage, sample);
    const source = sample.channel === 'WEB' ? 'customer-web' : 'operations-web';
    rows.push({ sample: sample.id, channel: sample.channel, plan: planCode, api: apiTotal, web: webTotal, source });
    check(
      `${sample.id} (${planCode}): ${source} = API · ${money(apiTotal)}`,
      fromApi.status === 201 && apiTotal === webTotal && webTotal !== null,
      `api=${apiTotal} ${source}=${webTotal}`,
    );
  }

  // NFR-PERF-05: lưới tồn 30 ngày × 55 phòng ≤ 200 KB sau nén gzip.
  const gridResponse = await fetch(
    `${API_BASE}/inventory/grid?propertyId=${property.id}&from=${addDays(today, 1)}&to=${addDays(today, 30)}`,
    { headers: { authorization: `Bearer ${ownerToken}` } },
  );
  const gridJson = await gridResponse.json();
  const gridBytes = gridResponse.ok ? gzipSync(Buffer.from(JSON.stringify(gridJson))).length : null;
  check(
    'NFR-PERF-05: lưới tồn 30 ngày ≤ 200 KB gzip',
    gridResponse.ok && gridBytes <= 200 * 1024,
    `HTTP ${gridResponse.status} · ${gridBytes} byte gzip`,
  );

  // Walk-in 20 lượt: chỉ đo (ticket không đặt ngưỡng), ghi p50/p95/max.
  const walkinSample = samples[5];
  const timings = [];
  for (let index = 0; index < 20; index += 1) {
    const started = performance.now();
    const response = await quote(walkinSample, 'WALKIN', walkinSample.ratePlanCode, ownerToken);
    timings.push(performance.now() - started);
    if (response.status !== 201) throw new Error(`walk-in lượt ${index + 1}: HTTP ${response.status}`);
  }
  timings.sort((a, b) => a - b);
  const p50 = timings[Math.floor(timings.length * 0.5)];
  const p95 = timings[Math.floor(timings.length * 0.95)];
  console.log(`# walk-in 20 lượt: p50 ${p50.toFixed(1)} ms · p95 ${p95.toFixed(1)} ms · max ${timings.at(-1).toFixed(1)} ms`);

  // Android: thiết bị BLOCKED; chạy bộ unit + kiểm tĩnh dùng chung client/hợp đồng giá.
  for (const app of ['customer-android', 'operations-android']) {
    const test = spawnSync('pnpm', ['--filter', `@pinehill/${app}`, 'test'], {
      cwd: repoRoot,
      env: process.env,
      encoding: 'utf8',
    });
    const passed = `${test.stdout}${test.stderr}`.match(/Tests\s+(\d+) passed/);
    check(
      `Android ${app}: bộ unit xanh (thiết bị BLOCKED)`,
      test.status === 0,
      `${passed === null ? '?' : passed[1]} ca`,
    );
    const usage = spawnSync('grep', ['-rl', '@pinehill/api-client', `apps/${app}/src`], { cwd: repoRoot, encoding: 'utf8' });
    check(
      `Android ${app}: dùng chung @pinehill/api-client (cùng nguồn giá với web/API)`,
      usage.stdout.trim() !== '',
      `${usage.stdout.trim().split('\n').length} tệp`,
    );
  }
  console.log('# BLOCKED: customer-android, operations-android — không có adb/emulator; parity trên thiết bị chưa kiểm.');

  const failed = results.filter((result) => !result.pass);
  console.log(
    `\n# TỔNG: ${results.length - failed.length}/${results.length} PASS · ${failed.length} FAIL · 2 BLOCKED (Android) · ${rows.length} kỳ mẫu`,
  );
  await browser.close();
  if (failed.length > 0) process.exitCode = 1;
} catch (error) {
  check('Script chạy hết không lỗi ngoài ý muốn', false, error instanceof Error ? error.stack : String(error));
  process.exitCode = 1;
} finally {
  try {
    await teardown();
  } catch {
    /* đã dọn */
  }
  await wait(200);
  process.exit(process.exitCode ?? 0);
}
