#!/usr/bin/env node
/**
 * HB-172 — QA F8: đối chiếu **số báo cáo REP** với **SQL độc lập** do QA tự viết, kiểm RBAC báo cáo và
 * kiểm tệp CSV xuất khớp số trên màn hình. Không dùng lại truy vấn của `apps/api/src/modules/rep`
 * (`queries.ts`); các câu SQL dưới đây viết từ `docs/04-thiet-ke/csdl.md` §3.4–3.6 và
 * `docs/02-nghiep-vu/quy-tac-nghiep-vu.md` (BR-REP-01, BR-CANCEL-13, BR-OVER-15).
 *
 * Cách chạy (PG16 + Redis7 của mẻ này đang chạy sẵn):
 *
 *   DATABASE_MIGRATION_URL='postgresql://pinehill:pinehill_dev@127.0.0.1:55432/pinehill' \
 *   REDIS_URL='redis://127.0.0.1:56379' \
 *   node tests/e2e/f8/qa-f8-reconcile.mjs
 *
 * Việc script làm, trên một CSDL **tách riêng** tạo và xoá trong lượt chạy:
 *   1. tạo CSDL + `scripts/migrate.mjs` + `pnpm --filter @pinehill/api db:seed` (7 tài khoản dev, bảng kênh);
 *   2. gieo kịch bản HB-172 (đặt phòng, phí, snapshot giá, hoàn theo bậc, bất khả kháng, quá tải, khoá phòng);
 *   3. chạy **API thật** (`tsx src/main.ts`) và **worker thật** (`tsx src/main.ts`) trên CSDL đó;
 *   4. gọi 6 báo cáo REP qua HTTP, so từng con số với SQL độc lập + số tính tay;
 *   5. kiểm ma trận RBAC (MANAGER không thấy báo cáo tài chính) và 403 của lệnh xuất;
 *   6. xuất CSV cho báo cáo công suất qua worker thật, tải tệp và so với ảnh chụp JSON màn hình dùng.
 *
 * Không đạt bất kỳ phép kiểm nào ⇒ in `FAIL` và thoát mã 1.
 */
import { spawn, spawnSync } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { createServer } from 'node:net';
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import pg from 'pg';

const repoRoot = fileURLToPath(new URL('../../..', import.meta.url));
const migrationBase = process.env.DATABASE_MIGRATION_URL;
const redisBase = process.env.REDIS_URL ?? 'redis://127.0.0.1:56379';
if (!migrationBase) throw new Error('Thiếu DATABASE_MIGRATION_URL (cần quyền tạo CSDL)');

/** Cổng API trống do hệ điều hành cấp — không đụng cổng của tiến trình khác đang chạy. */
const API_PORT = await new Promise((resolve, reject) => {
  const probe = createServer();
  probe.once('error', reject);
  probe.listen(0, '127.0.0.1', () => {
    const address = probe.address();
    probe.close(() => resolve(typeof address === 'object' && address !== null ? address.port : 3821));
  });
});
const API_BASE = `http://127.0.0.1:${API_PORT}/api/v1`;
const REDIS_DB = 13;
const EXPORT_DIR = '/tmp/hb172-f8-exports';
const PASSWORD = 'Hb172-Qa-Pass-2026!';
const TZ = 'Asia/Ho_Chi_Minh';
const FROM = '2026-12-01';
const TO = '2026-12-05';
const PROPERTY = 'CS-01';

const dbName = `hb172_qa_${randomBytes(4).toString('hex')}`;
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
const redisUrl = new URL(redisBase);
redisUrl.pathname = `/${REDIS_DB}`;

const results = [];
const check = (name, pass, detail) => {
  results.push({ name, pass: Boolean(pass), detail });
  if (!pass) process.exitCode = 1;
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${pass ? '' : ` — ${detail ?? ''}`}`);
};
const eq = (actual, expected) => JSON.stringify(actual) === JSON.stringify(expected);

/** -------- độc lập: câu SQL đối chiếu --------
 * (1) Phòng-đêm khả dụng: phòng/loại/cơ sở ACTIVE, DOR theo giường, trừ nguyên phòng bị khoá ngày đó.
 * (2) Phòng-đêm đã bán: mỗi dòng booking_rooms của booking đã xác nhận/đã ở = một đơn vị/đêm.
 * (3) Doanh thu phòng thuần: charge ROOM trừ hoa hồng **của chính đêm** lấy từ snapshot mới nhất.
 *     Kịch bản HB-172 đặt `amount` của mỗi đêm bằng đúng `grossAmount` trong snapshot nên công thức phân
 *     bổ theo tỷ lệ trong mã nguồn rút gọn còn `amount − commissionAmount`; đây là nhánh QA kiểm.
 */
const SQL_ROOM_NIGHTS = `
WITH days AS (
  SELECT gs::date AS d FROM generate_series($1::date, $2::date - interval '1 day', interval '1 day') AS gs
),
avail AS (
  SELECT n.d, sum(CASE WHEN rt.allow_shared THEN r.bed_count ELSE 1 END)::bigint AS available
    FROM rooms r
    JOIN room_types rt ON rt.id = r.room_type_id
    JOIN properties p ON p.id = r.property_id
    JOIN days n ON true
   WHERE r.status = 'ACTIVE' AND rt.status = 'ACTIVE' AND p.status = 'ACTIVE' AND p.code = $3
     AND NOT EXISTS (SELECT 1 FROM room_blocks rb
                      WHERE rb.room_id = r.id AND n.d >= rb.start_date AND n.d < rb.end_date)
   GROUP BY n.d
),
sold AS (
  SELECT n.d, count(*)::bigint AS sold
    FROM booking_rooms br
    JOIN bookings b ON b.id = br.booking_id
    JOIN properties p ON p.id = b.property_id
    JOIN days n ON n.d >= b.check_in AND n.d < b.check_out
   WHERE b.status IN ('CONFIRMED','CHECKED_IN','CHECKED_OUT') AND br.status <> 'CANCELLED'
     AND p.code = $3
   GROUP BY n.d
),
net AS (
  SELECT ch.stay_date AS d,
         sum(ch.amount - ch.voided_amount - coalesce((
           SELECT (n2->>'commissionAmount')::bigint
             FROM jsonb_array_elements(snap.payload_json->'nights') AS n2
            WHERE n2->>'bookingRoomId' = ch.booking_room_id::text
              AND n2->>'date' = ch.stay_date::text LIMIT 1), 0))::bigint AS net
    FROM booking_charges ch
    JOIN booking_rooms br ON br.id = ch.booking_room_id
    JOIN bookings b ON b.id = ch.booking_id
    JOIN properties p ON p.id = b.property_id
    LEFT JOIN LATERAL (SELECT s.payload_json FROM price_snapshots s
                        WHERE s.booking_id = b.id ORDER BY s.seq DESC LIMIT 1) snap ON true
   WHERE ch.kind = 'ROOM' AND ch.stay_date >= $1::date AND ch.stay_date < $2::date
     AND b.status IN ('CONFIRMED','CHECKED_IN','CHECKED_OUT') AND p.code = $3
   GROUP BY ch.stay_date
)
SELECT to_char(d.d, 'YYYY-MM-DD') AS day, coalesce(a.available, 0) AS available,
       coalesce(s.sold, 0) AS sold, coalesce(n.net, 0) AS net
  FROM days d LEFT JOIN avail a ON a.d = d.d LEFT JOIN sold s ON s.d = d.d LEFT JOIN net n ON n.d = d.d
 ORDER BY d.d`;

/** Doanh thu gộp/thuần theo kênh: snapshot mới nhất của booking đã xác nhận/đã ở có check_in trong kỳ. */
const SQL_CHANNEL_REVENUE = `
SELECT c.code AS channel_code,
       coalesce(sum(ps.gross_amount), 0)::bigint AS gross,
       coalesce(sum(ps.commission_amount), 0)::bigint AS commission,
       count(b.id)::bigint AS bookings
  FROM channels c
  LEFT JOIN bookings b ON b.channel_id = c.id AND b.property_id = $3
       AND b.status IN ('CONFIRMED','CHECKED_IN','CHECKED_OUT')
       AND b.check_in >= $1::date AND b.check_in < $2::date
  LEFT JOIN LATERAL (SELECT s.gross_amount, s.commission_amount FROM price_snapshots s
                      WHERE s.booking_id = b.id ORDER BY s.seq DESC LIMIT 1) ps ON true
 WHERE c.status <> 'INACTIVE'
 GROUP BY c.code ORDER BY c.code`;

/** Tỷ lệ huỷ (BR-REP-01): booking CANCELLED ÷ booking **tạo trong kỳ** theo ngày nghiệp vụ VN. */
const SQL_CANCELLATION_RATE = `
SELECT count(*) FILTER (WHERE b.status = 'CANCELLED')::bigint AS cancelled, count(*)::bigint AS created
  FROM bookings b JOIN rate_plans rp ON rp.id = b.rate_plan_id
 WHERE (b.created_at AT TIME ZONE $4)::date >= $1::date AND (b.created_at AT TIME ZONE $4)::date < $2::date
   AND b.property_id = $3`;

/** Tiền hoàn đã duyệt/đã chi theo bậc chính sách của booking huỷ trong kỳ; ca bất khả kháng tách riêng. */
const SQL_CANCELLATION_TIERS = `
SELECT rp.code AS rate_plan_code, t.offset_hours AS tier_hours,
       count(DISTINCT b.id)::bigint AS cancellations,
       sum(coalesce(rr.net_refund, rr.approved_amount, rr.requested_amount, 0))::bigint AS refund
  FROM refund_requests rr
  JOIN bookings b ON b.id = rr.booking_id
  JOIN rate_plans rp ON rp.id = b.rate_plan_id
  JOIN cancellation_tiers t ON t.id = rr.applied_tier_id
 WHERE b.status = 'CANCELLED' AND rr.status IN ('APPROVED','PAID') AND rr.is_force_majeure = false
   AND (b.cancelled_at AT TIME ZONE $4)::date >= $1::date AND (b.cancelled_at AT TIME ZONE $4)::date < $2::date
   AND b.property_id = $3
 GROUP BY 1, 2 ORDER BY 1, 2`;

/** Bất khả kháng (BR-CANCEL-13): mọi yêu cầu hoàn gắn cờ, kèm lý do ghi trên booking. */
const SQL_FORCE_MAJEURE = `
SELECT rr.booking_id, b.property_id, b.cancelled_at,
       coalesce(rr.net_refund, rr.approved_amount, rr.requested_amount, 0)::bigint AS refund, b.note
  FROM refund_requests rr JOIN bookings b ON b.id = rr.booking_id
 WHERE rr.is_force_majeure = true
   AND (b.cancelled_at AT TIME ZONE $4)::date >= $1::date AND (b.cancelled_at AT TIME ZONE $4)::date < $2::date
   AND b.property_id = $3
 ORDER BY b.cancelled_at, rr.booking_id`;

/** Quá tải (BR-OVER-15): mỗi ca + chiết khấu ghép + bồi thường walk-out + hỗ trợ đưa đón. */
const SQL_OVERBOOKING = `
WITH cases AS (
  SELECT c.id, c.property_id, c.room_type_id, c.date, c.status, c.detected_at, c.resolved_at
    FROM overbooking_cases c
   WHERE c.property_id = $3 AND c.date >= $1::date AND c.date < $2::date
),
merges AS (
  SELECT c.id AS case_id, sum(rm.discount_amount)::bigint AS merge_discount
    FROM cases c
    JOIN bookings pb ON pb.property_id = c.property_id AND pb.room_type_id = c.room_type_id
                    AND pb.check_in <= c.date AND pb.check_out > c.date
    JOIN room_merges rm ON rm.primary_booking_id = pb.id AND rm.status = 'ACTIVE'
   GROUP BY c.id
),
walks AS (
  SELECT c.id AS case_id, sum(mv.compensation_amount)::bigint AS walk_out,
         sum(coalesce(mv.transport_cost, 0))::bigint AS transport
    FROM cases c
    JOIN bookings b ON b.property_id = c.property_id AND b.room_type_id = c.room_type_id
                   AND b.check_in <= c.date AND b.check_out > c.date
    JOIN room_moves mv ON mv.booking_id = b.id AND mv.status = 'EXECUTED' AND mv.move_type = 'WALK_OUT'
   GROUP BY c.id
)
SELECT c.id AS case_id, c.room_type_id, to_char(c.date, 'YYYY-MM-DD') AS business_date, c.status,
       coalesce(mg.merge_discount, 0) AS merge_discount, coalesce(wk.walk_out, 0) AS walk_out,
       coalesce(wk.transport, 0) AS transport
  FROM cases c LEFT JOIN merges mg ON mg.case_id = c.id LEFT JOIN walks wk ON wk.case_id = c.id
 ORDER BY c.date, c.id`;

/** Làm tròn HALF_UP đúng như `formatFraction` của engine HB-161 (phần lẻ ≥ 0,5 làm tròn lên). */
function halfUp(numerator, denominator, decimals, percent) {
  const den = BigInt(denominator);
  if (den === 0n) return 0;
  const scale = 10n ** BigInt(decimals);
  const top = BigInt(numerator) * (percent ? 100n : 1n) * scale;
  const rounded = (2n * top + den) / (2n * den);
  return Number(rounded) / Number(scale);
}

async function sql(rows, text, values) {
  const client = new pg.Client({ connectionString: ownerUrl });
  await client.connect();
  try {
    const result = await client.query(text, values);
    return result.rows;
  } finally {
    await client.end();
  }
}

async function api(path, { token, method = 'GET', body, headers = {} } = {}) {
  const response = await fetch(`${API_BASE}${path}`, {
    method,
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...headers,
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
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

async function login(username) {
  const response = await api('/auth/login', {
    method: 'POST',
    body: { username, password: PASSWORD, clientSurface: 'OPS_WEB' },
  });
  if (response.status !== 200) throw new Error(`login ${username} → ${response.status}`);
  return response.body.accessToken;
}

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitForHealth(child) {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    if (child.exitCode !== null) throw new Error(`API thoát sớm (mã ${child.exitCode})`);
    try {
      const response = await fetch(`${API_BASE}/system/health`);
      if (response.ok) return;
    } catch {
      /* chưa lên */
    }
    await wait(1000);
  }
  throw new Error('API không lên trong 60 giây');
}

const children = [];

/** `pnpm exec` để lại tiến trình con (`tsx`/node) giữ ống stdout mở; phải giết **cả nhóm** tiến trình. */
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

function startApp(filter, env) {
  const child = spawn('pnpm', ['--filter', filter, 'exec', 'tsx', 'src/main.ts'], {
    cwd: repoRoot,
    env: { ...process.env, ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: true,
  });
  child.stdout.on('data', () => {});
  child.stderr.on('data', (data) => process.stderr.write(`[${filter}] ${data}`));
  children.push(child);
  return child;
}

async function main() {
  const admin = new pg.Client({ connectionString: migrationBase });
  await admin.connect();
  const owner = new pg.Client({ connectionString: ownerUrl });
  let apiChild;
  let workerChild;
  try {
    console.log(`# CSDL tách riêng: ${dbName}`);
    await admin.query(`CREATE DATABASE "${dbName}"`);
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

    // ---- gieo kịch bản HB-172 (số tính tay ở đầu mỗi khối) ----
    await owner.connect();
    const insert = async (text, values) => (await owner.query(text, values)).rows[0];
    const rows = (text, values) => owner.query(text, values).then((r) => r.rows);
    const ids = {};
    ids.property = (await insert('SELECT id FROM properties WHERE code = $1', [PROPERTY])).id;
    ids.std = (await insert('SELECT id FROM room_types WHERE property_id = $1 AND code = $2', [ids.property, 'STD'])).id;
    ids.dor = (await insert('SELECT id FROM room_types WHERE property_id = $1 AND code = $2', [ids.property, 'DOR'])).id;
    ids.dlx = (await insert('SELECT id FROM room_types WHERE property_id = $1 AND code = $2', [ids.property, 'DLX'])).id;
    ids.stdRoom = (await insert('SELECT id FROM rooms WHERE property_id = $1 AND code = $2', [ids.property, 'STD01'])).id;
    ids.dorRoom = (await insert('SELECT id FROM rooms WHERE property_id = $1 AND code = $2', [ids.property, 'DOR01'])).id;
    ids.web = (await insert('SELECT id FROM channels WHERE code = $1', ['WEB'])).id;
    ids.ota = (await insert('SELECT id FROM channels WHERE code = $1', ['OTA_BOOKING'])).id;
    ids.agency = (await insert('SELECT id FROM channels WHERE code = $1', ['AGENCY'])).id;
    ids.phone = (await insert('SELECT id FROM channels WHERE code = $1', ['PHONE'])).id;
    ids.flex = (await insert("SELECT id FROM rate_plans WHERE code = 'FLEX7'")).id;
    ids.tier72 = (await insert(
      'SELECT t.id FROM cancellation_tiers t JOIN cancellation_policies p ON p.id = t.policy_id WHERE p.code = $1 AND t.offset_hours = 72',
      ['CP-FLEX7'],
    )).id;
    ids.ownerUser = (await insert("SELECT id FROM users WHERE username = 'owner'")).id;
    // Người duyệt phải KHÁC người yêu cầu (trigger `fn_guard_refund_approval`) và có phạm vi CS-01.
    ids.approver = (await insert("SELECT id FROM users WHERE username = 'manager'")).id;
    ids.guest = (await insert("INSERT INTO guests(full_name, phone) VALUES('Khách HB-172', '+84900000172') RETURNING id")).id;
    // Kế toán chỉ có phạm vi CS-03 theo seed; mở CS-01 để phép kiểm tài chính chạy trên cùng dữ liệu.
    await owner.query(
      "INSERT INTO user_property_scopes(user_id, property_id) SELECT id, $1 FROM users WHERE username = 'accountant' ON CONFLICT DO NOTHING",
      [ids.property],
    );

    /** B1 WEB 620k×2 đêm (hoa hồng 0) · B2 DOR OTA 240k×2 (24k/36k) · B3 AGENCY 600k (60k) · B4/B5 huỷ. */
    const booking = async (spec) => {
      const row = await insert(
        `INSERT INTO bookings(code, guest_id, property_id, room_type_id, rate_plan_id, channel_id, check_in,
             check_out, adults, deposit_percent, status, note, total_amount, cancelled_at, cancel_reason, created_at)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8,2,30,$9,$10,$11,$12,$13,$14) RETURNING id`,
        [spec.code, ids.guest, ids.property, spec.type, ids.flex, spec.channel, spec.checkIn, spec.checkOut,
          spec.status, spec.note ?? null, spec.nights.reduce((t, n) => t + n.amount, 0),
          spec.cancelledAt ?? null, spec.reason ?? null, spec.createdOn],
      );
      const br = await insert(
        'INSERT INTO booking_rooms(booking_id, room_type_id, adults, price_per_night) VALUES($1,$2,2,$3) RETURNING id',
        [row.id, spec.type, spec.nights[0].amount],
      );
      for (const night of spec.nights) {
        await owner.query(
          `INSERT INTO booking_charges(booking_id, booking_room_id, stay_date, kind, source_key, amount)
           VALUES($1,$2,$3,'ROOM',$4,$5)`,
          [row.id, br.id, night.day, `stay:${night.day}:${spec.code}`, night.amount],
        );
      }
      const payload = spec.nights.map((n) => ({
        bookingRoomId: br.id, date: n.day, grossAmount: n.amount, commissionAmount: n.commission,
      }));
      await owner.query(
        `INSERT INTO price_snapshots(booking_id, seq, payload_json, gross_amount, commission_amount,
             policy_snapshot_json, engine_version, captured_at)
         VALUES($1,1,jsonb_build_object('schemaVersion',1,'nights',$2::jsonb),$3,$4,'{}'::jsonb,'hb172-qa',$5)`,
        [row.id, JSON.stringify(payload), payload.reduce((t, n) => t + n.grossAmount, 0),
          payload.reduce((t, n) => t + n.commissionAmount, 0), spec.createdOn],
      );
      return { id: row.id, room: br.id };
    };

    const b1 = await booking({
      code: 'PH-261201-QAB01', type: ids.std, channel: ids.web, checkIn: '2026-12-01', checkOut: '2026-12-03',
      status: 'CONFIRMED', createdOn: '2026-12-01T08:00:00+07:00',
      nights: [{ day: '2026-12-01', amount: 620000, commission: 0 }, { day: '2026-12-02', amount: 620000, commission: 0 }],
    });
    const b2 = await booking({
      code: 'PH-261201-QAB02', type: ids.dor, channel: ids.ota, checkIn: '2026-12-02', checkOut: '2026-12-04',
      status: 'CONFIRMED', createdOn: '2026-12-01T09:00:00+07:00',
      nights: [{ day: '2026-12-02', amount: 240000, commission: 24000 }, { day: '2026-12-03', amount: 240000, commission: 36000 }],
    });
    const b3 = await booking({
      code: 'PH-261201-QAB03', type: ids.std, channel: ids.agency, checkIn: '2026-12-01', checkOut: '2026-12-02',
      status: 'CHECKED_OUT', createdOn: '2026-12-01T10:00:00+07:00',
      nights: [{ day: '2026-12-01', amount: 600000, commission: 60000 }],
    });
    const b4 = await booking({
      code: 'PH-261201-QAB04', type: ids.std, channel: ids.web, checkIn: '2026-12-02', checkOut: '2026-12-04',
      status: 'CANCELLED', createdOn: '2026-12-01T11:00:00+07:00', cancelledAt: '2026-12-03T09:00:00+07:00',
      reason: 'GUEST_REQUEST', nights: [{ day: '2026-12-02', amount: 400000, commission: 0 }],
    });
    const b5 = await booking({
      code: 'PH-261201-QAB05', type: ids.dlx, channel: ids.phone, checkIn: '2026-12-03', checkOut: '2026-12-04',
      status: 'CANCELLED', createdOn: '2026-12-02T08:00:00+07:00', cancelledAt: '2026-12-04T08:00:00+07:00',
      reason: 'FORCE_MAJEURE', note: 'Bão lũ miền Trung',
      nights: [{ day: '2026-12-03', amount: 1000000, commission: 0 }],
    });
    /** Trigger `fn_guard_refund_request` bắt yêu cầu hoàn **bắt đầu PENDING** rồi mới duyệt kèm
     * `refund_approvals` (maker–checker) — làm đúng chuỗi thao tác của nghiệp vụ, không tắt kiểm. */
    const approveRefund = async (refund, amount, reason, decidedAt) => {
      await insert(
        `INSERT INTO refund_approvals(refund_request_id, request_version, approver_id, approver_role, decision,
             approved_amount, refund_fee, reason)
         VALUES($1,1,$2,'MANAGER','APPROVED',$3,0,$4) RETURNING id`,
        [refund, ids.approver, amount, reason],
      );
      await owner.query(
        `UPDATE refund_requests SET status='APPROVED', approved_amount=$2, approved_by=$3::uuid,
                decided_at=$4 WHERE id=$1`,
        [refund, amount, ids.approver, decidedAt],
      );
    };
    const refundB4 = (await insert(
      `INSERT INTO refund_requests(booking_id, event_key, policy_id, hours_before_check_in, applied_tier_id,
           refund_percent, requested_amount, status, reason, requester_type, requester_id, requested_by)
       SELECT $1,'hb172-evt-b4', rp.cancellation_policy_id, 40, $2, 50, 400000, 'PENDING',
              'GUEST_REQUEST','USER',$3::text,$4::uuid
         FROM rate_plans rp WHERE rp.id = $5 RETURNING id`,
      [b4.id, ids.tier72, ids.ownerUser, ids.ownerUser, ids.flex],
    )).id;
    await approveRefund(refundB4, 300000, 'Duyệt theo bậc 72 giờ', '2026-12-03T09:30:00+07:00');
    const refundB5 = (await insert(
      `INSERT INTO refund_requests(booking_id, event_key, policy_id, hours_before_check_in, refund_percent,
           requested_amount, status, reason, is_force_majeure, requester_type, requester_id, requested_by)
       SELECT $1,'hb172-evt-b5', rp.cancellation_policy_id, 72, 100, 1000000, 'PENDING',
              'FORCE_MAJEURE', true, 'USER', $2::text, $3::uuid
         FROM rate_plans rp WHERE rp.id = $4 RETURNING id`,
      [b5.id, ids.ownerUser, ids.ownerUser, ids.flex],
    )).id;
    await approveRefund(refundB5, 1000000, 'Bất khả kháng — hoàn 100%', '2026-12-04T09:00:00+07:00');
    const case1 = await insert(
      `INSERT INTO overbooking_cases(property_id, date, room_type_id, shortage_count, status, detected_at)
       VALUES($1,'2026-12-02',$2,1,'OPEN','2026-12-01T22:00:00+07:00') RETURNING id`,
      [ids.property, ids.std],
    );
    const case2 = await insert(
      `INSERT INTO overbooking_cases(property_id, date, room_type_id, shortage_count, status, detected_at)
       VALUES($1,'2026-12-02',$2,1,'PROPOSED','2026-12-01T23:00:00+07:00') RETURNING id`,
      [ids.property, ids.dor],
    );
    await owner.query(
      `INSERT INTO room_merges(primary_booking_id, secondary_booking_id, room_id, move_type, consent_primary,
           consent_secondary, discount_pct, discount_amount, approved_by, status)
       VALUES($1,$2,$3,'MERGE_SHARE',true,true,15,100000,$4,'ACTIVE')`,
      [b1.id, b3.id, ids.stdRoom, ids.ownerUser],
    );
    await owner.query(
      `INSERT INTO room_moves(booking_id, booking_room_id, move_type, reason, compensation_amount,
           transport_cost, status, from_room_id, approved_by, walk_out_doc_no)
       VALUES($1,$2,'WALK_OUT','Quá tải tại cơ sở',500000,100000,'EXECUTED',$3,$4,'HB172-WO-1')`,
      [b2.id, b2.room, ids.dorRoom, ids.ownerUser],
    );
    // Khoá DOR01 ngày 12-02 → khả dụng 34 → 28 (DOR bán theo giường: 2 phòng × 6 giường = 12).
    await owner.query(
      `INSERT INTO room_blocks(room_id, start_date, end_date, reason, created_by)
       VALUES($1,'2026-12-02','2026-12-03','MAINTENANCE',$2)`,
      [ids.dorRoom, ids.ownerUser],
    );

    // ---- chạy API + worker thật ----
    mkdirSync(EXPORT_DIR, { recursive: true });
    const sharedEnv = {
      DATABASE_URL: runtimeUrl,
      REDIS_URL: redisUrl.href,
      EXPORT_DIR,
      LOG_LEVEL: 'silent',
      BUSINESS_TIMEZONE: TZ,
    };
    apiChild = startApp('@pinehill/api', {
      ...sharedEnv,
      JWT_ACCESS_SECRET: randomBytes(32).toString('hex'),
      JWT_REFRESH_SECRET: randomBytes(32).toString('hex'),
      IDEMPOTENCY_TTL_HOURS: '24',
      HOST: '127.0.0.1',
      PORT: String(API_PORT),
    });
    await waitForHealth(apiChild);
    workerChild = startApp('@pinehill/worker', { ...sharedEnv, ENABLE_REPEATABLE_SCHEDULERS: 'false' });
    await wait(4000);

    const tokens = {
      owner: await login('owner'),
      manager: await login('manager'),
      accountant: await login('accountant'),
    };

    // ---- 1. đối chiếu 6 báo cáo với SQL độc lập ----
    const query = `from=${FROM}&to=${TO}&propertyId=${ids.property}`;
    const occupancy = (await api(`/reports/occupancy?${query}&groupBy=DAY`, { token: tokens.manager })).body;
    const adr = (await api(`/reports/adr-revpar?${query}&groupBy=DAY`, { token: tokens.manager })).body;
    const revenue = (await api(`/reports/revenue-by-channel?${query}`, { token: tokens.accountant })).body;
    const cancellations = (await api(`/reports/cancellations?${query}`, { token: tokens.accountant })).body;
    const forceMajeure = (await api(`/reports/force-majeure?from=${FROM}&to=${TO}`, { token: tokens.owner })).body;
    const overbooking = (await api(`/reports/overbooking?${query}`, { token: tokens.manager })).body;

    const sqlRooms = await sql(null, SQL_ROOM_NIGHTS, [FROM, TO, PROPERTY]);
    const expectedRooms = [
      { day: '2026-12-01', sold: 2, available: 34, net: 1160000 },
      { day: '2026-12-02', sold: 2, available: 28, net: 836000 },
      { day: '2026-12-03', sold: 1, available: 34, net: 204000 },
      { day: '2026-12-04', sold: 0, available: 34, net: 0 },
    ];
    check('SQL phòng-đêm = số tính tay', eq(sqlRooms.map((r) => ({ day: r.day, sold: Number(r.sold), available: Number(r.available), net: Number(r.net) })), expectedRooms), JSON.stringify(sqlRooms));
    const occupancyRows = occupancy.rows.map((r) => ({ day: r.businessDate, sold: r.soldUnits, available: r.availableUnits }));
    check('SCR-52 công suất khớp SQL (đã bán/khả dụng)', eq(occupancyRows, expectedRooms.map((r) => ({ day: r.day, sold: r.sold, available: r.available }))), JSON.stringify(occupancy.rows));
    check('SCR-52 công suất % khớp HALF_UP độc lập', eq(occupancy.rows.map((r) => r.occupancyPct), expectedRooms.map((r) => halfUp(r.sold, r.available, 2, true))), JSON.stringify(occupancy.rows));
    const adrRows = adr.rows.map((r) => ({ day: r.businessDate, sold: r.roomNightsSold, available: r.roomNightsAvailable, net: r.netRevenue, adr: r.adr, revpar: r.revpar }));
    check('SCR-52 ADR/RevPAR khớp SQL phòng-đêm thuần', eq(adrRows.map((r) => ({ day: r.day, net: r.net })), expectedRooms.map((r) => ({ day: r.day, net: r.net }))), JSON.stringify(adr.rows));
    check('SCR-52 ADR/RevPAR khớp HALF_UP độc lập', eq(adr.rows.map((r) => [r.adr, r.revpar]), expectedRooms.map((r) => [halfUp(r.net, r.sold, 0, false), halfUp(r.net, r.available, 0, false)])), JSON.stringify(adr.rows));

    const sqlRevenue = await sql(null, SQL_CHANNEL_REVENUE, [FROM, TO, ids.property]);
    const expectedRevenue = sqlRevenue.map((r) => [r.channel_code, Number(r.gross), Number(r.commission), Number(r.bookings)]);
    const apiRevenue = revenue.rows.map((r) => [r.channelCode, r.grossAmount, r.commissionAmount, r.bookings]);
    check('SCR-53 doanh thu theo kênh khớp SQL độc lập', eq(apiRevenue, expectedRevenue), `SQL=${JSON.stringify(expectedRevenue)} API=${JSON.stringify(apiRevenue)}`);
    check('SCR-53 doanh thu kênh = số tính tay (WEB/OTA/AGENCY)', eq(
      apiRevenue.filter((r) => ['WEB', 'OTA_BOOKING', 'AGENCY'].includes(r[0])),
      [['AGENCY', 600000, 60000, 1], ['OTA_BOOKING', 480000, 60000, 1], ['WEB', 1240000, 0, 1]],
    ), JSON.stringify(apiRevenue));
    check('SCR-53 thuần = gộp − hoa hồng', revenue.rows.every((r) => r.netAmount === r.grossAmount - r.commissionAmount));

    const [sqlRate] = await sql(null, SQL_CANCELLATION_RATE, [FROM, TO, ids.property, TZ]);
    check('SCR-54 tỷ lệ huỷ khớp SQL độc lập', cancellations.cancellationRate === halfUp(Number(sqlRate.cancelled), Number(sqlRate.created), 2, false), `${JSON.stringify(sqlRate)} → ${cancellations.cancellationRate}`);
    check('SCR-54 tỷ lệ huỷ = số tính tay (2/5)', cancellations.cancellationRate === 0.4, String(cancellations.cancellationRate));
    const sqlTiers = await sql(null, SQL_CANCELLATION_TIERS, [FROM, TO, ids.property, TZ]);
    check('SCR-54 tiền hoàn theo bậc khớp SQL độc lập', eq(
      cancellations.rows.map((r) => [r.ratePlanCode, r.appliedTierOffsetHours, r.cancellations, r.refundAmount]),
      sqlTiers.map((r) => [r.rate_plan_code, r.tier_hours, Number(r.cancellations), Number(r.refund)]),
    ), JSON.stringify(cancellations.rows));
    check('SCR-54 bậc hoàn = số tính tay (FLEX7/72h/1/300.000)', eq(
      cancellations.rows.map((r) => [r.ratePlanCode, r.appliedTierOffsetHours, r.cancellations, r.refundAmount]),
      [['FLEX7', 72, 1, 300000]],
    ), JSON.stringify(cancellations.rows));

    const sqlForce = await sql(null, SQL_FORCE_MAJEURE, [FROM, TO, ids.property, TZ]);
    check('SCR-54 bất khả kháng khớp SQL độc lập', eq(
      forceMajeure.rows.map((r) => [r.bookingId, r.refundAmount, r.note]),
      sqlForce.map((r) => [r.booking_id, Number(r.refund), r.note]),
    ), JSON.stringify(forceMajeure.rows));
    check('SCR-54 bất khả kháng = số tính tay (1 ca, 1.000.000)', eq(
      forceMajeure.rows.map((r) => [r.bookingId, r.refundAmount]), [[b5.id, 1000000]],
    ), JSON.stringify(forceMajeure.rows));

    const sqlOver = await sql(null, SQL_OVERBOOKING, [FROM, TO, ids.property]);
    check('SCR-55 quá tải khớp SQL độc lập', eq(
      overbooking.rows.map((r) => [r.caseId, r.status, r.mergeDiscountAmount, r.walkOutCompensationAmount, r.transportSupportAmount, r.totalCost]),
      sqlOver.map((r) => [r.case_id, r.status, Number(r.merge_discount), Number(r.walk_out), Number(r.transport), Number(r.merge_discount) + Number(r.walk_out) + Number(r.transport)]),
    ), JSON.stringify(overbooking.rows));
    check('SCR-55 tổng chi phí = tổng ba khoản', overbooking.rows.every((r) => r.totalCost === r.mergeDiscountAmount + r.walkOutCompensationAmount + r.transportSupportAmount));
    // Thứ tự ca do `c.date, c.id` quyết định nên so theo `caseId` đã sắp, không phụ thuộc UUID ngẫu nhiên.
    const byId = (left, right) => (left[0] < right[0] ? -1 : 1);
    const caseCosts = overbooking.rows
      .map((r) => [r.caseId, r.mergeDiscountAmount, r.walkOutCompensationAmount, r.transportSupportAmount, r.totalCost])
      .sort(byId);
    check('SCR-55 hai ca = số tính tay (STD ghép 100k; DOR walk-out 600k)', eq(
      caseCosts,
      [[case1.id, 100000, 0, 0, 100000], [case2.id, 0, 500000, 100000, 600000]].sort(byId),
    ), JSON.stringify(overbooking.rows));

    // ---- 2. RBAC báo cáo (api.md §2.12) ----
    const roleMatrix = [
      ['manager', 'occupancy', 200], ['manager', 'adr-revpar', 200], ['manager', 'overbooking', 200],
      ['manager', 'revenue-by-channel', 403], ['manager', 'cancellations', 403], ['manager', 'force-majeure', 403],
      ['accountant', 'revenue-by-channel', 200], ['accountant', 'cancellations', 200],
      ['accountant', 'occupancy', 403], ['accountant', 'adr-revpar', 403], ['accountant', 'overbooking', 403],
      ['accountant', 'force-majeure', 403],
      ['owner', 'occupancy', 200], ['owner', 'force-majeure', 200],
    ];
    for (const [role, report, expected] of roleMatrix) {
      const params = report === 'force-majeure' ? `from=${FROM}&to=${TO}` : query;
      const response = await api(`/reports/${report}?${params}`, { token: tokens[role] });
      check(`RBAC ${role} → ${report} = ${expected}`, response.status === expected, `${response.status} ${JSON.stringify(response.body)}`);
    }
    const managerExport = await api('/reports/export', {
      method: 'POST',
      token: tokens.manager,
      body: { report: 'occupancy', format: 'CSV', params: { from: FROM, to: TO, propertyId: ids.property } },
      headers: { 'Idempotency-Key': randomUUID() },
    });
    check('RBAC MANAGER → POST /reports/export = 403', managerExport.status === 403, `${managerExport.status}`);

    // ---- 3. xuất CSV qua worker thật khớp màn hình (report JSON) ----
    const exportRequest = await api('/reports/export', {
      method: 'POST',
      token: tokens.accountant,
      body: { report: 'occupancy', format: 'CSV', params: { from: FROM, to: TO, propertyId: ids.property } },
      headers: { 'Idempotency-Key': randomUUID() },
    });
    check('POST /reports/export = 202 kèm operationId', exportRequest.status === 202 && typeof exportRequest.body.operationId === 'string', `${exportRequest.status} ${JSON.stringify(exportRequest.body)}`);
    let operation = exportRequest.body;
    for (let attempt = 0; attempt < 60 && operation.status !== 'SUCCEEDED'; attempt += 1) {
      await wait(1000);
      operation = (await api(`/operations/${exportRequest.body.operationId}`, { token: tokens.accountant })).body;
      if (operation.status === 'FAILED') break;
    }
    check('worker sinh tệp → thao tác SUCCEEDED có link tải', operation.status === 'SUCCEEDED' && typeof operation.resultRef === 'string', JSON.stringify(operation));
    if (operation.resultRef) {
      const download = await fetch(`${API_BASE.replace(/\/api\/v1$/, '')}${operation.resultRef}`, {
        headers: { Authorization: `Bearer ${tokens.accountant}` },
      });
      const csv = await download.text();
      const lines = csv.replace(/^\uFEFF/, '').trim().split('\r\n');
      const headers = lines[0].split(',');
      const csvRows = lines.slice(1).map((line) => line.split(','));
      writeFileSync(join(EXPORT_DIR, 'hb172-occupancy.csv'), csv);
      check('CSV tải được (200, text/csv)', download.status === 200 && (download.headers.get('content-type') ?? '').includes('text/csv'), `${download.status} ${download.headers.get('content-type')}`);
      check('CSV có đủ tiêu đề 7 cột', headers.length === 7, headers.join('|'));
      const csvProjection = csvRows.map((cells) => [cells[0], cells[4], cells[5], cells[6]]);
      const jsonProjection = occupancy.rows.map((r) => [r.key, String(r.soldUnits), String(r.availableUnits), String(r.occupancyPct)]);
      check('CSV khớp số trên màn hình (đã bán/khả dụng/công suất)', eq(csvProjection, jsonProjection), `CSV=${JSON.stringify(csvProjection)} JSON=${JSON.stringify(jsonProjection)}`);
    }

    const failed = results.filter((r) => !r.pass);
    console.log(`\n# ${results.length - failed.length}/${results.length} phép kiểm đạt`);
    if (failed.length > 0) console.log(`# Không đạt: ${failed.map((r) => r.name).join('; ')}`);
  } finally {
    killChildren();
    await owner.end().catch(() => {});
    await admin.query(`DROP DATABASE IF EXISTS "${dbName}" WITH (FORCE)`).catch(() => {});
    await admin.end().catch(() => {});
  }
}

await main();
