/**
 * HB-117 — hạ tầng dùng chung của lượt QA F5 (sao từ HB-196 `qa-f7-lib.mjs`; thêm worker chi hoàn và khoá PSP thử nghiệm): CSDL tách riêng, API **thật** với đồng hồ nghiệp vụ điều khiển được
 * (`clock-shim.mjs`), gọi HTTP, SQL độc lập, ghi kết quả PASS/FAIL. Không import mã trong `apps/**`/`packages/**`.
 */
import { spawn, spawnSync } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { createServer } from 'node:net';
import { writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import pg from 'pg';

export const repoRoot = fileURLToPath(new URL('../../..', import.meta.url));
const migrationBase = process.env.DATABASE_MIGRATION_URL;
const redisBase = process.env.REDIS_URL ?? 'redis://127.0.0.1:6379/10';
if (!migrationBase) throw new Error('Thiếu DATABASE_MIGRATION_URL (cần quyền tạo CSDL)');

/** Khoá PSP thử nghiệm của lượt QA (không phải bí mật thật): đủ bộ ⇒ cổng ở chế độ `live`, không cần `PSP_ALLOW_MOCK`. */
export const PSP = {
  vnpay: { tmn: 'HB117QA01', secret: 'hb117-qa-vnpay-secret-for-local-run-only' },
  momo: { partner: 'HB117QAMOMO', accessKey: 'hb117-qa-momo-access', secret: 'hb117-qa-momo-secret-for-local-run-only' },
};
export const PASSWORD = 'Hb117-Qa-Pass-2026!';
export const PIN = '123456';
export const TZ = 'Asia/Ho_Chi_Minh';

const dbName = `hb117_qa_${randomBytes(4).toString('hex')}`;
const withDb = (raw, name) => {
  const url = new URL(raw);
  url.pathname = `/${name}`;
  return url.href;
};
const ownerUrl = withDb(migrationBase, dbName);
const runtimeUrl = (() => {
  const url = new URL(migrationBase);
  return `postgresql://app_rw:app_rw_dev@${url.hostname}:${url.port}/${dbName}`;
})();

const port = await new Promise((resolve, reject) => {
  const probe = createServer();
  probe.once('error', reject);
  probe.listen(0, '127.0.0.1', () => {
    const address = probe.address();
    probe.close(() => resolve(typeof address === 'object' && address !== null ? address.port : 3851));
  });
});
export const API_BASE = `http://127.0.0.1:${port}/api/v1`;

export const results = [];
export const findings = [];
export function check(name, pass, detail) {
  results.push({ name, pass: Boolean(pass), detail });
  if (!pass) process.exitCode = 1;
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${pass ? '' : ` — ${detail ?? ''}`}`);
}
/** Ghi nhận một phát hiện lệch (mã ↔ BR/AC) mà không làm đỏ lượt chạy: nó là kết quả của QA, không phải lỗi script. */
export function finding(id, summary, evidence) {
  findings.push({ id, summary, evidence });
  console.log(`FINDING ${id}  ${summary}\n         ${evidence}`);
}
export const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);
export const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export async function sql(text, values = [], url = ownerUrl) {
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    return (await client.query(text, values)).rows;
  } finally {
    await client.end();
  }
}

// ----- đồng hồ nghiệp vụ -----
const clockDir = mkdtempSync(join(tmpdir(), 'hb117-clock-'));
const clockFile = join(clockDir, 'offset');
writeFileSync(clockFile, '0');
let apiChild = null;
let workerChild = null;
let clockEpoch = 0;
const tokenCache = new Map();
export const vn = (date, time) => Date.parse(`${date}T${time}+07:00`);
/** Đặt giờ VN hiện hành của API. Token cũ bị bỏ vì hạn 15 phút tính theo đồng hồ ảo. */
export async function setClock(date, time) {
  const offset = vn(date, time) - Date.now();
  writeFileSync(clockFile, String(offset));
  await wait(120);
  clockEpoch += 1;
  tokenCache.clear();
}

// ----- HTTP -----
export async function api(path, { token, method = 'GET', body, headers = {}, key } = {}) {
  const write = method !== 'GET' && method !== 'HEAD';
  const response = await fetch(`${API_BASE}${path}`, {
    method,
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      ...(write && key !== null ? { 'Idempotency-Key': key ?? randomUUID() } : {}),
      ...headers,
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  const text = await response.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    json = text;
  }
  return { status: response.status, body: json, headers: response.headers };
}

export async function login(username) {
  const cached = tokenCache.get(username);
  if (cached) return cached;
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const response = await api('/auth/login', {
      method: 'POST',
      body: { username, password: PASSWORD, clientSurface: 'OPS_ANDROID' },
      key: null,
    });
    if (response.status === 429) {
      // Giới hạn tần suất đăng nhập dùng chung theo IP (Redis): chờ đúng thời gian máy chủ báo.
      await wait((Number(response.body.retryAfterSeconds) || 2) * 1000 + 250);
      continue;
    }
    if (response.status !== 200) throw new Error(`login ${username} → ${response.status} ${JSON.stringify(response.body)}`);
    tokenCache.set(username, response.body.accessToken);
    return response.body.accessToken;
  }
  throw new Error(`login ${username} bị giới hạn tần suất liên tục`);
}

/** pinToken dùng một lần, gắn đúng booking (BR-RBAC-05). */
export async function mintPin(username, bookingId, pin = PIN) {
  const token = await login(username);
  const response = await api('/auth/pin/verify', {
    token,
    method: 'POST',
    body: bookingId ? { pin, bookingId } : { pin },
    key: null,
  });
  if (response.status !== 200) throw new Error(`pin/verify ${username} → ${response.status} ${JSON.stringify(response.body)}`);
  return response.body.pinToken;
}

// ----- tiến trình -----
const children = [];
function killChildren() {
  for (const child of children) {
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
process.on('exit', killChildren);
process.on('SIGINT', () => {
  killChildren();
  process.exit(130);
});

async function waitForHealth(child) {
  for (let attempt = 0; attempt < 90; attempt += 1) {
    if (child.exitCode !== null) throw new Error(`API thoát sớm (mã ${child.exitCode})`);
    try {
      const response = await fetch(`${API_BASE}/system/health`);
      if (response.ok) return;
    } catch {
      /* chưa lên */
    }
    await wait(1000);
  }
  throw new Error('API không lên trong 90 giây');
}

export const dbInfo = { name: dbName };

/** Tạo CSDL riêng, migrate, seed, đặt PIN cho các tài khoản dev, chạy API thật với đồng hồ điều khiển được. */
/** Redis DB riêng của lát cắt: dọn sạch trước mỗi lượt để job BullMQ/khoá của lượt trước (worker bị SIGKILL) không làm lệch lượt này. */
function flushOwnRedis() {
  const db = new URL(redisBase).pathname.replace('/', '') || '0';
  if (db === '0') throw new Error('Từ chối FLUSHDB Redis DB 0 — đặt REDIS_URL sang DB riêng của lát cắt');
  const r = spawnSync('docker', ['exec', 'pinehill-dev-redis-1', 'redis-cli', '-n', db, 'FLUSHDB'], { encoding: 'utf8' });
  if (r.status !== 0) console.log(`# cảnh báo: không dọn được Redis DB ${db}: ${r.stderr || r.stdout}`);
}

export async function bootstrap() {
  flushOwnRedis();
  const admin = new pg.Client({ connectionString: migrationBase });
  await admin.connect();
  try {
    console.log(`# CSDL tách riêng: ${dbName} · Redis ${redisBase}`);
    await admin.query(`CREATE DATABASE "${dbName}"`);
  } finally {
    await admin.end();
  }
  const migrate = spawnSync('node', ['scripts/migrate.mjs'], {
    cwd: repoRoot,
    env: { ...process.env, DATABASE_MIGRATION_URL: ownerUrl, DATABASE_URL: '' },
    encoding: 'utf8',
  });
  if (migrate.status !== 0) throw new Error(`migrate lỗi: ${migrate.stderr || migrate.stdout}`);
  const seed = spawnSync('pnpm', ['--filter', '@pinehill/api', 'db:seed'], {
    cwd: repoRoot,
    env: { ...process.env, DATABASE_URL: ownerUrl, SEED_DEV_PASSWORD: PASSWORD },
    encoding: 'utf8',
  });
  if (seed.status !== 0) throw new Error(`seed lỗi: ${seed.stderr || seed.stdout}`);

  const env = {
    ...process.env,
    DATABASE_URL: runtimeUrl,
    REDIS_URL: redisBase,
    LOG_LEVEL: 'silent',
    BUSINESS_TIMEZONE: TZ,
    JWT_ACCESS_SECRET: randomBytes(32).toString('hex'),
    JWT_REFRESH_SECRET: randomBytes(32).toString('hex'),
    IDEMPOTENCY_TTL_HOURS: '24',
    HOST: '127.0.0.1',
    PORT: String(port),
    QA_CLOCK_FILE: clockFile,
    VNPAY_TMN_CODE: PSP.vnpay.tmn,
    VNPAY_HASH_SECRET: PSP.vnpay.secret,
    MOMO_PARTNER_CODE: PSP.momo.partner,
    MOMO_ACCESS_KEY: PSP.momo.accessKey,
    MOMO_SECRET_KEY: PSP.momo.secret,
    PAYMENT_PSP_CALLBACK_BASE_URL: `http://127.0.0.1:${port}`,
    PAYMENT_RETURN_URL_ORIGINS: 'https://example.test',
  };
  apiChild = spawn(
    'node',
    ['--import', join(repoRoot, 'tests/e2e/f7/clock-shim.mjs'), '--import', 'tsx', 'src/main.ts'],
    { cwd: join(repoRoot, 'apps/api'), env, stdio: ['ignore', 'pipe', 'pipe'], detached: true },
  );
  apiChild.stdout.on('data', (d) => process.env.QA_DEBUG && process.stdout.write('[api-out] ' + d));
  apiChild.on('exit', (code, sig) => console.log('[api] exit', code, sig));
  apiChild.stderr.on('data', (data) => process.stderr.write(`[api] ${data}`));
  children.push(apiChild);
  await waitForHealth(apiChild);

  // Worker THẬT chi hoàn: quét `q.refund-payout` mỗi 2 giây, cổng PSP mô phỏng bền (`REFUND_PAYOUT_SIMULATOR`) cho VNPAY/MOMO;
  // BANK_TRANSFER luôn dừng UNKNOWN chờ kế toán xác nhận (mặc định sản phẩm).
  workerChild = spawn('node', ['--import', 'tsx', 'src/main.ts'], {
    cwd: join(repoRoot, 'apps/worker'),
    env: {
      ...process.env,
      DATABASE_URL: runtimeUrl,
      REDIS_URL: redisBase,
      LOG_LEVEL: 'silent',
      ENABLE_REPEATABLE_SCHEDULERS: 'true',
      REFUND_PAYOUT_INTERVAL_SECONDS: '2',
      REFUND_PAYOUT_RETRY_SECONDS: '5',
      REFUND_PAYOUT_SIMULATOR: process.env.QA_PAYOUT_SIMULATOR ?? 'true',
      HOLD_EXPIRY_INTERVAL_SECONDS: process.env.QA_HOLD_EXPIRY_SECONDS ?? '2',
      OUTBOX_RELAY_INTERVAL_SECONDS: '600',
      QA_CLOCK_FILE: clockFile,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: true,
  });
  workerChild.stderr.on('data', (data) => process.env.QA_DEBUG && process.stderr.write(`[worker] ${data}`));
  workerChild.on('exit', (code, sig) => console.log('[worker] exit', code, sig));
  children.push(workerChild);

  // PIN 6 số cho các tài khoản sẽ thu tiền / nhận-trả phòng (QĐ-01 mục 6).
  for (const user of ['frontdesk', 'manager', 'owner', 'accountant', 'reservation']) {
    const token = await login(user);
    const response = await api('/auth/pin', {
      token,
      method: 'PUT',
      body: { pin: PIN, currentPassword: PASSWORD },
      key: null,
    });
    if (response.status !== 204) throw new Error(`đặt PIN ${user} → ${response.status} ${JSON.stringify(response.body)}`);
  }
}

export async function teardown() {
  killChildren();
  await wait(500);
  const admin = new pg.Client({ connectionString: migrationBase });
  await admin.connect();
  try {
    await admin.query(`DROP DATABASE IF EXISTS "${dbName}" WITH (FORCE)`);
  } finally {
    await admin.end();
  }
  rmSync(clockDir, { recursive: true, force: true });
}
