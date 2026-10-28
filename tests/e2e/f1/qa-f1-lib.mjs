/**
 * HB-025 — hạ tầng của lượt QA F1: dựng hai web Next thật (`next start`) trước **API thật + CSDL tạm**
 * của `f5/qa-f5-lib.mjs`, cộng một reverse proxy cùng-origin để browser nói chuyện với API qua chính
 * origin của web (`/api/v1/**`). Lý do proxy: F1 có màn gọi API **trực tiếp từ browser** (SCR-15,
 * `admin/users`) mà `apps/api` chưa cấu hình CORS (§4 `bang-chung-f1.md` ghi phát hiện F1-01); proxy giữ
 * nguyên hành vi sản phẩm ở phần còn lại (BFF `/api/session/**` vẫn đi qua API thật) mà không tắt bảo mật
 * trình duyệt. Không import mã trong `apps/**`/`packages/**`.
 */
import { spawn, spawnSync } from 'node:child_process';
import { createServer, request as httpRequest } from 'node:http';
import { createServer as createProbe } from 'node:net';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import AxeBuilder from '@axe-core/playwright';
import { API_BASE, PASSWORD, api, repoRoot, wait } from '../f5/qa-f5-lib.mjs';
export { API_BASE, PASSWORD, api, repoRoot, wait } from '../f5/qa-f5-lib.mjs';

export const MAILPIT = process.env.QA_MAILPIT_URL ?? 'http://127.0.0.1:8025';

// ----- kết quả -----
export const records = [];
const log = (line) => console.log(line);
function push(status, name, detail, extra) {
  records.push({ status, name, ...(detail === undefined ? {} : { detail }), ...extra });
  log(`${status === 'PASS' ? 'PASS' : status === 'FAIL' ? 'FAIL' : 'BLOCKED'}  ${name}${detail === undefined ? '' : ` — ${detail}`}`);
}
export const pass = (name, detail) => push('PASS', name, detail);
export const fail = (name, detail) => push('FAIL', name, detail);
export const blocked = (name, reason, evidence) =>
  push('BLOCKED', name, reason, { evidence });
export function report(name, ok, detail) {
  if (ok) pass(name, detail);
  else fail(name, detail);
  return Boolean(ok);
}
export function summarize() {
  const counts = { PASS: 0, FAIL: 0, BLOCKED: 0 };
  for (const record of records) counts[record.status] += 1;
  log(`\n${counts.PASS} PASS · ${counts.FAIL} FAIL · ${counts.BLOCKED} BLOCKED`);
  return counts;
}

// ----- cổng mạng -----
export function freePort() {
  return new Promise((resolve, reject) => {
    const probe = createProbe();
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const address = probe.address();
      probe.close(() => resolve(typeof address === 'object' && address !== null ? address.port : 0));
    });
  });
}

/** Reverse proxy cùng-origin: `/api/v1/**` → API thật, còn lại → Next đang chạy ở `nextPort`. */
export async function startProxy({ port, nextPort, apiBase }) {
  const apiUrl = new URL(apiBase);
  const apiTarget = { hostname: apiUrl.hostname, port: apiUrl.port };
  const server = createServer((request, response) => {
    const path = request.url ?? '/';
    const toApi = path === '/api/v1' || path.startsWith('/api/v1/');
    const upstream = httpRequest(
      {
        ...(toApi ? apiTarget : { hostname: '127.0.0.1', port: nextPort }),
        method: request.method,
        path,
        // Giữ nguyên Host của browser để `new URL(request.url)` của Next/BFF trả đúng origin công khai.
        headers: { ...request.headers },
        agent: false,
      },
      (answer) => {
        response.writeHead(answer.statusCode ?? 502, answer.headers);
        answer.pipe(response);
      },
    );
    upstream.setTimeout(180_000, () => upstream.destroy());
    upstream.on('error', () => {
      if (!response.headersSent) response.writeHead(502, { 'content-type': 'text/plain' });
      response.end('proxy: upstream không phản hồi');
    });
    request.pipe(upstream);
  });
  server.keepAliveTimeout = 5_000;
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', resolve);
  });
  return { close: () => new Promise((resolve) => server.close(() => resolve())) };
}

const webChildren = [];
export function killWeb() {
  for (const child of webChildren) {
    if (child.pid !== undefined) {
      try {
        process.kill(-child.pid, 'SIGKILL');
      } catch {
        /* nhóm đã chết */
      }
    }
    child.stdout?.destroy();
    child.stderr?.destroy();
  }
}
process.on('exit', killWeb);

/** `next build` một lần nếu chưa có artefact (biến môi trường chỉ là giá trị hợp lệ để build động). */
export function ensureBuild(filter, appDir) {
  if (existsSync(join(appDir, '.next', 'BUILD_ID'))) return;
  log(`# next build ${filter} …`);
  const result = spawnSync('pnpm', ['--filter', filter, 'exec', 'next', 'build'], {
    cwd: repoRoot,
    env: {
      ...process.env,
      NEXT_TELEMETRY_DISABLED: '1',
      NEXT_PUBLIC_API_BASE_URL: 'http://127.0.0.1:9/api/v1',
      SESSION_APP_ORIGIN: 'http://127.0.0.1:9',
    },
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  if (result.status !== 0) throw new Error(`next build ${filter} lỗi:\n${result.stderr || result.stdout}`);
}

export async function waitForHttp(url, timeoutMs = 60_000) {
  const deadline = Date.now() + timeoutMs;
  let lastError;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url, { redirect: 'manual' });
      if (response.status < 500) return response;
    } catch (error) {
      lastError = error;
    }
    await wait(500);
  }
  throw new Error(`không lên trong ${timeoutMs}ms: ${url} (${lastError?.message ?? 'không có phản hồi'})`);
}

/** Chạy `next start` trên cổng nội bộ, trả về tiến trình (bị kill ở teardown). */
export function startNext({ filter, port, env }) {
  const child = spawn('pnpm', ['--filter', filter, 'exec', 'next', 'start', '--port', String(port)], {
    cwd: repoRoot,
    env: {
      ...process.env,
      NEXT_TELEMETRY_DISABLED: '1',
      NODE_ENV: 'production',
      ...env,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: true,
  });
  const tail = [];
  child.stdout.on('data', (data) => {
    tail.push(String(data));
    if (tail.length > 40) tail.shift();
    if (process.env.QA_DEBUG) process.stdout.write(`[${filter}] ${data}`);
  });
  child.stderr.on('data', (data) => {
    tail.push(String(data));
    if (tail.length > 40) tail.shift();
    if (process.env.QA_DEBUG) process.stderr.write(`[${filter}] ${data}`);
  });
  child.on('exit', (code) => {
    if (code !== 0) log(`[${filter}] thoát ${code}: ${tail.join('').slice(-800)}`);
  });
  webChildren.push(child);
  return child;
}

// ----- trình duyệt / axe -----
export async function axeBlocking(page) {
  const analysis = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze();
  return analysis.violations
    .filter((violation) => violation.impact === 'serious' || violation.impact === 'critical')
    .map((violation) => `${violation.id} (${violation.impact})`);
}

/** Quét axe một màn; trả về `null` khi sạch, ngược lại chuỗi vi phạm. */
export async function axeCheck(page, label) {
  const blocking = await axeBlocking(page);
  report(`axe · ${label}`, blocking.length === 0, blocking.length === 0 ? '0 serious/critical' : blocking.join(', '));
}

// ----- Mailpit -----
export async function mailpitClear() {
  const response = await fetch(`${MAILPIT}/api/v1/messages`, { method: 'DELETE' });
  if (!response.ok) throw new Error(`Mailpit không xoá được hộp thư: ${response.status}`);
}

/** Thư gần nhất gửi tới `email` trong `timeoutMs`; trả `{subject, text}`. */
export async function mailTo(email, timeoutMs = 20_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const listing = await (await fetch(`${MAILPIT}/api/v1/messages?limit=50`)).json();
    const hit = (listing.messages ?? []).find((message) =>
      (message.To ?? []).some((to) => to.Address?.toLowerCase() === email.toLowerCase()),
    );
    if (hit !== undefined) {
      const message = await (await fetch(`${MAILPIT}/api/v1/message/${hit.ID}`)).json();
      return { subject: message.Subject, text: message.Text ?? '' };
    }
    await wait(500);
  }
  throw new Error(`không thấy thư tới ${email} trong ${timeoutMs}ms`);
}

// ----- JWT / đồng hồ -----
export function decodeJwt(token) {
  const payload = token.split('.')[1];
  return JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
}

const dateFmt = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Ho_Chi_Minh' });
const timeFmt = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Asia/Ho_Chi_Minh',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hourCycle: 'h23',
});
export const vnDate = (ms) => dateFmt.format(new Date(ms));
export const vnTime = (ms) => timeFmt.format(new Date(ms));
/** Ngày nghiệp vụ (yyyy-mm-dd) của `ms` cộng `days` ngày. */
export const businessDate = (ms, days = 0) => vnDate(ms + days * 86_400_000);

/** Đăng nhập API trực tiếp (không cache) kèm `clientSurface` tường minh. */
export async function apiLogin(username, { password = PASSWORD, surface = 'OPS_WEB' } = {}) {
  const response = await api('/auth/login', {
    method: 'POST',
    body: { username, password, clientSurface: surface },
    key: null,
  });
  return response;
}
