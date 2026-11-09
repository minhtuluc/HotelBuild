/**
 * HB-184 — chạy bộ k6 trên máy dev **cục bộ** (không phải staging). Bước chuẩn bị:
 * - dựng CSDL tách riêng + API/worker thật (`tests/e2e/f5/qa-f5-lib.mjs`);
 * - đăng ký `LOAD_GUESTS` khách giả và đăng nhập nhân viên dev;
 * - cấu hình một tài khoản OTA tổng hợp;
 * - khoá mọi phòng STD trừ một trên 5 đêm của KB-B.
 *
 * Sau đó chạy k6 (`grafana/k6` qua podman/docker, `--network host`) cho KB-A, KB-B ×5, KB-C và đột
 * biến 600 VU, rồi chạy `bat-bien.sql`. Kết quả ghi vào `tests/load/results/` (gitignore).
 *
 * Số đo cục bộ chỉ để **so sánh trước/sau một thay đổi**. Cổng NFR của HB-184 là lượt chạy trên
 * staging giống production (HB-175), xem `docs/07-ban-giao/van-hanh/tai-k6.md`.
 *
 * Biến môi trường: `QA_DATABASE_PARAMS` (mặc định pool 50), `DATABASE_MIGRATION_URL`, `REDIS_URL` (DB riêng, ví dụ `/10`); `LOAD_ONLY=kb-a,kb-b`;
 * `DURATION` (mặc định 10m; đột biến 5m); `VUS`; `LOAD_GUESTS` (200); `K6_IMAGE`.
 */
import { spawn, spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { createHash, randomBytes } from 'node:crypto';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
// Pool Prisma của API lượt tải: mặc định 50 như khuyến nghị production (xem tai-k6.md); pool mặc định
// của Prisma (2 × nhân vật lý + 1 = 17 trên máy dev) bão hoà ở 600 VU. Đặt `QA_DATABASE_PARAMS=` để đo pool mặc định.
process.env.QA_DATABASE_PARAMS ??= 'connection_limit=50&pool_timeout=20';
process.env.QA_WORKER_LOG ??= join(fileURLToPath(new URL('.', import.meta.url)), 'results', 'worker-stderr.log');
const { API_BASE, PASSWORD, api, bootstrap, login, repoRoot, sql, teardown, wait } = await import('../e2e/f5/qa-f5-lib.mjs');

const loadDir = join(repoRoot, 'tests/load');
const resultsDir = join(loadDir, 'results');
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const only = new Set((process.env.LOAD_ONLY || 'kb-a,kb-b,kb-c,spike').split(','));
const GUESTS = Number(process.env.LOAD_GUESTS || 200);
const K6_IMAGE = process.env.K6_IMAGE || 'docker.io/grafana/k6:1.3.0';
const { Redis } = createRequire(join(repoRoot, 'apps/api/package.json'))('ioredis');
const redis = new Redis(process.env.REDIS_URL || 'redis://127.0.0.1:6379/10');
/**
 * Hạn mức đăng nhập/đăng ký là 10 lượt/phút/IP. Ở đây mọi khách đều đi từ 127.0.0.1, còn production
 * mỗi khách một IP. Runner chỉ xoá bộ đếm `auth:ip:*` trong Redis DB riêng của lượt tải để mô phỏng
 * nhiều IP; không đụng mã sản phẩm.
 */
async function resetAuthIpCounters() {
  const keys = await redis.keys('auth:ip:*');
  if (keys.length > 0) await redis.del(...keys);
}
const engine = spawnSync('podman', ['--version']).status === 0 ? 'podman' : 'docker';
const day = (offset) => new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);
const OTA = {
  provider: 'booking',
  keyId: 'hb184-load-booking',
  accountId: 'hb184-load-acc',
  secret: createHash('sha256').update(`hb184-load:${randomBytes(8).toString('hex')}`).digest('hex'),
};

async function guestTokens(phones) {
  const tokens = [];
  for (const phone of phones) {
    await resetAuthIpCounters();
    const res = await api('/guest-auth/login', { method: 'POST', key: null, body: { phone, password: PASSWORD } });
    if (res.status !== 200) throw new Error(`guest login ${res.status} ${JSON.stringify(res.body)}`);
    tokens.push(res.body.accessToken);
  }
  return tokens;
}

async function prepare() {
  await bootstrap();
  const [property] = await sql("SELECT id, code FROM properties WHERE code = 'CS-01'");
  const types = await sql('SELECT id, code FROM room_types WHERE property_id = $1 ORDER BY code', [property.id]);
  const std = types.find((t) => t.code === 'STD');
  const [{ id: ownerId }] = await sql("SELECT id FROM users WHERE username = 'owner'");
  // Tài khoản dev: reservation thuộc CS-02, accountant thuộc CS-03. Lượt tải chạy trên CS-01 nên cấp thêm
  // phạm vi CS-01 trong CSDL tạm (dữ liệu giả của lượt tải).
  await sql(
    `INSERT INTO user_property_scopes(user_id, property_id)
     SELECT u.id, $1 FROM users u WHERE u.username IN ('reservation', 'accountant') ON CONFLICT DO NOTHING`,
    [property.id],
  );

  const phones = [];
  for (let i = 0; i < GUESTS; i += 1) {
    const phone = `+8498${String(1_000_000 + i).slice(-7)}`;
    await resetAuthIpCounters();
    const res = await api('/guest-auth/register', {
      method: 'POST',
      key: null,
      body: { phone, fullName: `Khách tải ${i}`, password: PASSWORD, consentMarketing: false, consentVersion: 'load-v1' },
    });
    if (![200, 201].includes(res.status)) throw new Error(`register ${res.status} ${JSON.stringify(res.body)}`);
    phones.push(phone);
  }

  // KB-B: 5 đêm, mỗi đêm chỉ còn đúng một phòng STD bán được.
  const nights = [0, 1, 2, 3, 4].map((k) => ({ checkIn: day(120 + 2 * k), checkOut: day(121 + 2 * k) }));
  const rooms = await sql("SELECT id FROM rooms WHERE room_type_id = $1 AND status = 'ACTIVE' ORDER BY code", [std.id]);
  for (const night of nights)
    for (const room of rooms.slice(1))
      await sql(
        "INSERT INTO room_blocks(room_id, start_date, end_date, reason, created_by) VALUES ($1, $2, $3, 'MAINTENANCE', $4)",
        [room.id, night.checkIn, night.checkOut, ownerId],
      );

  // OTA tổng hợp: tài khoản ký HMAC + ánh xạ STD cho OTA_BOOKING; số tiền = giá engine của máy chủ.
  await sql(
    `INSERT INTO system_settings(key, value, value_type, description) VALUES ('chan.ota.accounts', $1, 'JSON', 'HB-184 load')
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, value_type = 'JSON'`,
    [JSON.stringify({ booking: [{ keyId: OTA.keyId, accountId: OTA.accountId, secret: OTA.secret }] })],
  );
  const owner = await login('owner');
  const channels = await api('/channels', { token: owner });
  const channel = channels.body.data.find((c) => c.code === 'OTA_BOOKING');
  const mapped = await api(`/channels/${channel.id}/mappings`, {
    token: owner,
    method: 'PUT',
    headers: { 'If-Match': `"${channel.version}"` },
    body: { roomTypeId: std.id, providerRoomTypeCode: 'STD', allotmentPct: 80 },
  });
  if (![200, 201, 204].includes(mapped.status)) throw new Error(`mapping ${mapped.status}`);
  const price = await api('/quotes/multi-channel', {
    token: await login('manager'),
    method: 'POST',
    key: null,
    body: { roomTypeId: std.id, checkIn: nights[0].checkIn, checkOut: nights[0].checkOut, channelCodes: ['OTA_BOOKING'] },
  });
  const amount = price.body?.options?.find((o) => o.channelCode === 'OTA_BOOKING')?.totalFrom;

  return {
    runId: stamp,
    propertyId: property.id,
    propertyCode: property.code,
    roomTypes: types.map(({ id, code }) => ({ id, code })),
    ratePlanCode: 'FLEX7',
    phones,
    window: { from: day(7), days: 60, grid: day(36) },
    report: { from: day(-60), to: day(29) },
    lastRoom: { roomTypeId: std.id, nights },
    ota: amount ? { ...OTA, roomTypeCode: 'STD', amount } : null,
  };
}

/** Token sống 15 phút: phát lại ngay trước mỗi kịch bản; khách trước (argon2 chậm), nhân viên sau cùng. */
async function writeFixture(base) {
  const guests = await guestTokens(base.phones);
  const staff = {};
  for (const role of ['reservation', 'manager', 'accountant', 'frontdesk']) {
    await resetAuthIpCounters();
    // Không dùng `login()` của qa-f5-lib: hàm đó nhớ token mãi, token hết hạn giữa các kịch bản ⇒ 401.
    const res = await api('/auth/login', {
      method: 'POST',
      key: null,
      body: { username: role, password: PASSWORD, clientSurface: 'OPS_ANDROID' },
    });
    if (res.status !== 200) throw new Error(`staff login ${role} ${res.status}`);
    staff[role] = res.body.accessToken;
  }
  const fixture = { ...base, staff, guests };
  delete fixture.phones;
  writeFileSync(join(resultsDir, 'fixture.json'), JSON.stringify(fixture));
}

async function k6(script, name, env = {}) {
  const args = ['run', '--rm', '--network', 'host', '-v', `${loadDir}:/load:Z`, '-e', `BASE_URL=${API_BASE}`];
  for (const [key, value] of Object.entries({ LOAD_FIXTURE: '/load/results/fixture.json', ...env }))
    args.push('-e', `${key}=${value}`);
  // Tóm tắt văn bản của k6 (stdout) được lưu nguyên vào `<lượt>-<kịch bản>.log`.
  args.push(K6_IMAGE, 'run', '--quiet', `/load/${script}`);
  console.log(`# k6 ${name}`);
  // Bất đồng bộ: `spawnSync` chặn event loop của runner suốt kịch bản, nên pipe stdout/stderr của API và
  // worker không được đọc và sự kiện thoát của chúng bị trễ tới hết kịch bản.
  const child = spawn(engine, args, { stdio: ['ignore', 'pipe', 'pipe'] });
  let output = '';
  child.stdout.on('data', (d) => (output += d));
  child.stderr.on('data', (d) => (output += d));
  const status = await new Promise((resolve) => child.on('close', resolve));
  writeFileSync(join(resultsDir, `${stamp}-${name}.log`), output);
  console.log(`  ${status === 0 ? 'ĐẠT ngưỡng' : `KHÔNG ĐẠT ngưỡng (k6 exit ${status})`}`);
  return { name, exit: status };
}

async function invariants(lastType) {
  const text = readFileSync(join(loadDir, 'bat-bien.sql'), 'utf8').replaceAll(":'last_type'", `'${lastType}'`);
  const rows = [];
  const statements = text
    .replace(/^\s*--.*$/gm, '')
    .split(';')
    .map((s) => s.trim())
    .filter(Boolean);
  for (const statement of statements)
    rows.push(...(await sql(statement)));
  return rows;
}

mkdirSync(resultsDir, { recursive: true });
const runs = [];
let base;
try {
  base = await prepare();
  const dur = process.env.DURATION ? { DURATION: process.env.DURATION } : {};
  const vus = process.env.VUS ? { VUS: process.env.VUS } : {};
  if (only.has('kb-a')) {
    await writeFixture(base);
    runs.push(await k6('kb-a-tim-phong.js', 'kb-a', { ...dur, ...vus }));
  }
  if (only.has('kb-b'))
    for (let i = 0; i < 5; i += 1) {
      await writeFixture(base);
      runs.push(await k6('kb-b-phong-cuoi.js', `kb-b-${i + 1}`, { LAST_NIGHT: String(i), ...vus }));
    }
  if (only.has('kb-c')) {
    await writeFixture(base);
    runs.push(await k6('kb-c-bao-cao.js', 'kb-c', { ...dur, ...vus }));
  }
  if (only.has('spike')) {
    await writeFixture(base);
    runs.push(await k6('dot-bien-600.js', 'spike', process.env.DURATION ? { DURATION: process.env.DURATION } : {}));
  }
  await wait(65_000); // hold bỏ dở phải được worker giải phóng ≤ 60 giây (NFR-REL-02).
  const checks = await invariants(base.lastRoom.roomTypeId);
  for (const row of checks) console.log(`${Number(row.vi_pham) === 0 ? 'ĐẠT' : 'KHÔNG ĐẠT'}  ${row.bat_bien}: ${row.vi_pham}`);
  writeFileSync(join(resultsDir, `${stamp}-tong-hop.json`), JSON.stringify({ runs, invariants: checks }, null, 2));
  if (runs.some((r) => r.exit !== 0) || checks.some((r) => Number(r.vi_pham) !== 0)) process.exitCode = 1;
} finally {
  rmSync(join(resultsDir, 'fixture.json'), { force: true });
  redis.disconnect();
  await teardown();
}
