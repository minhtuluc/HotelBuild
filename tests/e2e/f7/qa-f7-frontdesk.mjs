#!/usr/bin/env node
/**
 * HB-196 — QA F7 (tiền sảnh) trên **API thật** + CSDL riêng + seed dev, đồng hồ nghiệp vụ điều khiển được.
 * Đối chiếu số tiền/trạng thái với **biểu thức/SQL độc lập** do QA viết từ `quy-tac-nghiep-vu.md` và `csdl.md`
 * (không dùng lại engine `packages/domain/src/front-office` hay truy vấn trong `apps/api/src/modules/fo`).
 *
 * Cách chạy (PG16 + Redis7 dev đang chạy sẵn; Redis dev chỉ có DB 0–15 — bản v1 ghi `/21` là **không hợp lệ**,
 * QĐ-06 mục 6):
 *
 *   DATABASE_MIGRATION_URL='postgresql://pinehill:pinehill_dev@127.0.0.1:5432/pinehill' \
 *   REDIS_URL='redis://127.0.0.1:6379/9' \
 *   node tests/e2e/f7/qa-f7-frontdesk.mjs
 *
 * Ca phủ (mã ca ở `docs/05-ke-hoach/ke-hoach-kiem-thu.md`): TC-BOOK-17 (walk-in), TC-FO-01 (check-in/nợ), TC-FO-02
 * (sau 23:59), TC-FO-03 (phụ thu trả muộn), TC-FO-04 (phụ thu nhận sớm), TC-FO-05 (số dư/buồng phòng/giao phòng),
 * TC-FO-07 (no-show, phần API), RBAC/PIN/idempotency của lệnh FO. TC-FO-06/08 và đo chạm Android: xem bằng chứng.
 * `PASS/FAIL` là kết luận của phép kiểm; `FINDING` là lệch mã ↔ BR/AC cần lead xem (không làm đỏ lượt chạy).
 */
import { randomUUID } from 'node:crypto';
import {
  API_BASE,
  api,
  bootstrap,
  check,
  dbInfo,
  eq,
  findings,
  finding,
  login,
  mintPin,
  results,
  setClock,
  sql,
  teardown,
} from './qa-f7-lib.mjs';

/** Ngày nghiệp vụ VN thật hôm nay: hold của walk-in tính theo giờ CSDL thật nên ngày lưu trú phải khớp. */
const D = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Ho_Chi_Minh' }).format(new Date());
const add = (date, n) => new Date(Date.parse(`${date}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
const dow = (date) => new Date(`${date}T00:00:00Z`).getUTCDay(); // 5 = thứ Sáu, 6 = thứ Bảy
const money = (n) => `${Number(n).toLocaleString('vi-VN')} ₫`;
const ceil1000 = (n) => (n % 1000n === 0n ? n : (n / 1000n + 1n) * 1000n);
const floor1000 = (n) => (n / 1000n) * 1000n;
/** ⌈n × pct / 100⌉ đến 1.000 VND (BR-GEN-03 làm tròn LÊN với giá bán/cọc/phụ thu). */
const ceilPct = (n, pct) => ceil1000((n * pct + 99n) / 100n);

// ---------- biểu thức giá độc lập (BR-RATE: mục "Công thức giá", BR-RATE-06/07, §4.4, BR-GEN-03) ----------
/** Đêm `date`: base × 1,2 (T6/T7) × LOS × kênh, kẹp sàn–trần, làm tròn LÊN 1.000. Hệ số lấy từ CSDL seed, không từ API. */
function expectedNight(price, date, nights, plan) {
  const weekend = dow(date) === 5 || dow(date) === 6 ? BigInt(Math.round(price.weekend * 1000)) : 1000n;
  const los = plan.losDiscount ? BigInt(Math.round(losFactor(nights) * 1000)) : 1000n;
  const channel = BigInt(Math.round(price.channel * 1000));
  const exact = BigInt(price.base) * weekend * los * channel; // VND × 1e9
  let value = (exact + 999_999_999n) / 1_000_000_000n;
  if (value < BigInt(price.min)) value = BigInt(price.min);
  if (value > BigInt(price.max)) value = BigInt(price.max);
  return ceil1000(value);
}
function losFactor(nights) {
  if (nights >= 14) return 0.85;
  if (nights >= 7) return 0.9;
  if (nights >= 3) return 0.95;
  return 1;
}

const ids = { rooms: {} };
const book = {}; // nhãn → { id, code, roomIds[], total, deposit }
const roomOf = (label) => book[label].roomIds[0];
const errCode = (res) => (res.body && typeof res.body === 'object' ? res.body.code : undefined);
const dayOf = (label) => book[label].checkIn;

async function loadReference() {
  const [p] = await sql("SELECT id FROM properties WHERE code = 'CS-01'");
  const [p2] = await sql("SELECT id FROM properties WHERE code = 'CS-02'");
  ids.property = p.id;
  ids.property2 = p2.id;
  const types = await sql('SELECT id, code, base_price, min_price, max_price, property_id FROM room_types');
  ids.type = Object.fromEntries(types.filter((t) => t.property_id === p.id).map((t) => [t.code, t]));
  ids.type2 = Object.fromEntries(types.filter((t) => t.property_id === p2.id).map((t) => [t.code, t]));
  const [{ multiplier }] = await sql("SELECT multiplier FROM channels WHERE code = 'WALKIN'");
  const [weekendRow] = await sql("SELECT value FROM system_settings WHERE key = 'pricing.weekendMultiplier'");
  ids.walkinMultiplier = Number(multiplier);
  ids.weekendMultiplier = Number(String(weekendRow.value).replace(/"/g, ''));
  const plans = await sql('SELECT code, deposit_percent, los_discount_enabled FROM rate_plans');
  ids.plan = Object.fromEntries(plans.map((r) => [r.code, { deposit: Number(r.deposit_percent), losDiscount: r.los_discount_enabled }]));
}

const priceOf = (typeCode, props = ids.type) => {
  const t = props[typeCode];
  return { base: t.base_price, min: t.min_price, max: t.max_price, channel: ids.walkinMultiplier, weekend: ids.weekendMultiplier };
};

/** Walk-in + (tuỳ chọn) thu cọc có PIN; đối chiếu giá/cọc/mã với biểu thức độc lập ngay khi tạo. */
async function makeBooking(label, { role = 'frontdesk', property = ids.property, types = ids.type, type, plan = 'FLEX7', from, to, rooms = 1, pay = true }) {
  const token = await login(role);
  const nights = (Date.parse(to) - Date.parse(from)) / 86_400_000;
  const res = await api('/walk-in', {
    token,
    method: 'POST',
    body: {
      propertyId: property,
      roomTypeId: types[type].id,
      ratePlanCode: plan,
      checkIn: from,
      checkOut: to,
      adults: 2,
      children: 0,
      roomCount: rooms,
      guest: { fullName: `Khách QA ${label}`, phone: `09${String(10_000_000 + Object.keys(book).length * 137).slice(0, 8)}` },
    },
  });
  if (res.status !== 201) throw new Error(`walk-in ${label} → ${res.status} ${JSON.stringify(res.body)}`);
  const b = res.body.booking;
  const rows = await sql(
    `SELECT a.room_id FROM room_assignments a JOIN booking_rooms br ON br.id = a.booking_room_id
      WHERE br.booking_id = $1 AND a.released_at IS NULL ORDER BY br.created_at, a.room_id`,
    [b.id],
  );
  book[label] = { id: b.id, code: b.code, roomIds: rows.map((r) => r.room_id), total: b.totalAmount, deposit: b.depositAmount, checkIn: from, checkOut: to, nights, type, plan, rooms, types, quote: res.body.quote };
  if (pay) {
    const pin = await mintPin(role, b.id);
    const paid = await api('/payments', { token, method: 'POST', body: { bookingId: b.id, type: 'DEPOSIT', method: 'CASH', amount: b.depositAmount, pinToken: pin } });
    if (paid.status !== 201 || paid.body.status !== 'SUCCEEDED') throw new Error(`cọc ${label} → ${paid.status} ${JSON.stringify(paid.body)}`);
  }
  return book[label];
}

/**
 * Bằng chứng sẵn sàng qua **API thật** (HB-207): `POST /housekeeping/tasks` trạng thái `INSPECTED`.
 * Bản v1 phải `INSERT SQL` vì chưa có tuyến này (FINDING F7-QA-01); v2 không còn SQL cho điều kiện đầu.
 */
async function markInspected(roomId, date) {
  const res = await api('/housekeeping/tasks', {
    token: await login('frontdesk'),
    method: 'POST',
    body: { roomId, businessDate: date, status: 'INSPECTED', reason: 'Kiểm phòng — QA F7 v2 (HB-196)' },
    key: randomUUID(),
  });
  if (res.status !== 201)
    throw new Error(`POST /housekeeping/tasks (${roomId}, ${date}) → ${res.status} ${JSON.stringify(res.body)}`);
  return res;
}
async function dbBalance(bookingId) {
  const [row] = await sql(
    `SELECT (coalesce(sum(c.amount - c.voided_amount), 0)
           - coalesce((SELECT sum(al.amount) FROM payment_allocations al JOIN booking_charges c2 ON c2.id = al.charge_id WHERE c2.booking_id = $1), 0))::bigint AS due
       FROM booking_charges c WHERE c.booking_id = $1`,
    [bookingId],
  );
  return Number(row.due);
}
const statusOf = async (id) => (await sql('SELECT status FROM bookings WHERE id = $1', [id]))[0].status;

const checkInBody = (label, extra = {}) => ({ bookingId: book[label].id, actualRoomIds: book[label].roomIds, earlyCheckIn: false, ...extra });
const postCheckIn = async (role, label, extra, key) =>
  api('/front-office/check-in', { token: await login(role), method: 'POST', body: checkInBody(label, extra), key });
async function payBalance(label, role = 'frontdesk') {
  const bal = await api(`/bookings/${book[label].id}/balance`, { token: await login(role) });
  const due = bal.body.balanceDue;
  if (due === 0) return { due, res: null };
  const pin = await mintPin(role, book[label].id);
  const res = await api('/payments', { token: await login(role), method: 'POST', body: { bookingId: book[label].id, type: 'BALANCE', method: 'CASH', amount: due, pinToken: pin } });
  return { due, res };
}
const postCheckOut = async (label, { late = false, early = false, role = 'frontdesk', pin = true, key } = {}) => {
  const body = { bookingId: book[label].id, lateCheckOut: late, earlyCheckOut: early };
  if (pin) body.pinToken = await mintPin(role, book[label].id);
  return api('/front-office/check-out', { token: await login(role), method: 'POST', body, key });
};
const lastNightCharge = async (bookingId) =>
  Number((await sql("SELECT (amount - voided_amount) AS a FROM booking_charges WHERE booking_id = $1 AND kind = 'ROOM' ORDER BY stay_date DESC LIMIT 1", [bookingId]))[0].a);
const firstNightCharge = async (bookingId) =>
  Number((await sql("SELECT (amount - voided_amount) AS a FROM booking_charges WHERE booking_id = $1 AND kind = 'ROOM' ORDER BY stay_date ASC LIMIT 1", [bookingId]))[0].a);

// ====================================================================================================
async function main() {
  await bootstrap();
  await loadReference();
  const hkId = (await sql("SELECT id FROM users WHERE username = 'housekeeping'"))[0].id;
  console.log(`# ngày nghiệp vụ D=${D} (thứ ${dow(D)}), API ${API_BASE}`);

  // ---------- Era 0 (giờ thật): dựng booking + thu cọc (hold walk-in tính theo giờ CSDL thật nên làm trước khi nhảy giờ) ----------
  console.log('\n## 0. TC-BOOK-17 walk-in + thu cọc bằng PIN (đối chiếu giá/cọc/mã với biểu thức độc lập)');
  await makeBooking('M1', { type: 'STD', plan: 'FLEX7', from: D, to: add(D, 2) });
  await makeBooking('N1', { type: 'STD', plan: 'FLEX7', from: add(D, 2), to: add(D, 3) });
  await makeBooking('T1', { type: 'STD', plan: 'NONREF', from: D, to: add(D, 1) });
  await makeBooking('T2', { type: 'STD', plan: 'SAVER3', from: D, to: add(D, 3) });
  await makeBooking('T3', { type: 'FAM', plan: 'FLEX7', from: D, to: add(D, 7) });
  await makeBooking('MR', { type: 'DLX', plan: 'FLEX7', from: D, to: add(D, 1), rooms: 2 });
  await makeBooking('W2', { type: 'DLX', plan: 'NONREF', from: add(D, 5), to: add(D, 6) });
  await makeBooking('T4', { type: 'SUP', plan: 'FLEX7', from: add(D, 1), to: add(D, 2) });
  await makeBooking('V1', { type: 'STD', plan: 'FLEX7', from: D, to: add(D, 1) });
  for (const label of ['U1', 'U2', 'E1', 'E2', 'E3']) await makeBooking(label, { type: 'SUP', plan: 'NONREF', from: D, to: add(D, 1) });
  for (const label of ['L1', 'L2', 'L3']) await makeBooking(label, { type: 'DLX', plan: 'NONREF', from: D, to: add(D, 4) });
  await makeBooking('X1', { role: 'manager', property: ids.property2, types: ids.type2, type: 'STD', plan: 'FLEX7', from: D, to: add(D, 1), pay: false });

  for (const label of ['M1', 'T1', 'T2', 'T3', 'V1', 'U2', 'E2', 'L1', 'L3']) {
    const b = book[label];
    const price = priceOf(b.type);
    const expected = Array.from({ length: b.nights }, (_u, i) => expectedNight(price, add(b.checkIn, i), b.nights, ids.plan[b.plan]));
    const gotNights = b.quote.nights.map((n) => n.nightlyPrice);
    check(`TC-BOOK-17 ${label}: giá từng đêm = biểu thức độc lập (${expected.map((e) => e.toString()).join('+')})`, eq(gotNights, expected.map(Number)), `API ${gotNights} ≠ ${expected}`);
    const sum = expected.reduce((t, n) => t + n, 0n);
    const expectedTotal = floor1000(sum);
    check(`TC-BOOK-17 ${label}: tổng tiền = ⌊Σ đêm⌋ 1.000 (${money(expectedTotal)})`, BigInt(b.total) === expectedTotal, `API ${b.total} ≠ ${expectedTotal}`);
    const expectedDeposit = ceilPct(expectedTotal, BigInt(ids.plan[b.plan].deposit));
    check(`TC-BOOK-17 ${label}: cọc = làm tròn LÊN 1.000 của ${ids.plan[b.plan].deposit}% (BR-PAY-01) = ${money(expectedDeposit)}`, BigInt(b.deposit) === expectedDeposit, `API ${b.deposit} ≠ ${expectedDeposit}`);
  }
  {
    const b = book.M1;
    const [row] = await sql(
      `SELECT bk.status, bk.code, c.code AS channel, bk.paid_amount, bk.deposit_amount,
              (SELECT count(*) FROM price_snapshots s WHERE s.booking_id = bk.id) AS snapshots,
              (SELECT sum(amount) FROM booking_charges WHERE booking_id = bk.id AND kind = 'ROOM') AS charges
         FROM bookings bk JOIN channels c ON c.id = bk.channel_id WHERE bk.id = $1`,
      [b.id],
    );
    check('TC-BOOK-17: mã booking đúng định dạng PH-YYMMDD-NNNNN', /^PH-\d{6}-\d{5}$/.test(row.code), row.code);
    check('TC-BOOK-17: kênh = WALKIN, có đúng 1 PriceSnapshot, tổng nghĩa vụ ROOM = tổng tiền (BR-RATE-16)', row.channel === 'WALKIN' && Number(row.snapshots) === 1 && Number(row.charges) === b.total, JSON.stringify(row));
    check('BR-BOOK-09: sau khi thu đủ cọc booking CONFIRMED, paidAmount = cọc', row.status === 'CONFIRMED' && Number(row.paid_amount) === b.deposit, JSON.stringify(row));
  }

  // ---------- Era 1: 06:30 ----------
  console.log('\n## 1. TC-FO-04 check-in sớm: 06:30 (trước 08:00) — và F7-QA-01 ghi nhận bằng chứng sẵn sàng qua API (HB-207)');
  // Điều kiện đầu qua **API** HB-207 (INSPECTED) cho mọi phòng sẽ giao trong ngày D, trừ T1 để kiểm F7-QA-01.
  for (const label of ['T2', 'T3', 'V1', 'U1', 'U2', 'E1', 'E2', 'E3', 'M1', 'MR', 'L1', 'L2', 'L3']) for (const room of book[label].roomIds) await markInspected(room, D);
  await setClock(D, '06:30:00');
  let r = await postCheckIn('frontdesk', 'E3');
  check('TC-FO-04 06:30: trả 409 E_FO_CHECKIN_NOT_ALLOWED (bắt buộc đặt thêm 1 đêm, BR-FO-04)', r.status === 409 && errCode(r) === 'E_FO_CHECKIN_NOT_ALLOWED', `${r.status} ${JSON.stringify(r.body)}`);
  check('TC-FO-04 06:30: thông điệp nêu "đặt thêm một đêm"', /đặt thêm một đêm/.test(r.body?.message ?? ''), r.body?.message);
  check('TC-FO-04 06:30: booking vẫn CONFIRMED, không có assignment mới', (await statusOf(book.E3.id)) === 'CONFIRMED');

  await setClock(D, '10:00:00');
  r = await postCheckIn('frontdesk', 'T1');
  check('F7-QA-01: phòng chưa có bằng chứng sẵn sàng của lượt giải phóng ⇒ 409 "chưa sẵn sàng" (BR-FO-07)', r.status === 409 && /chưa sẵn sàng/.test(r.body?.message ?? ''), `${r.status} ${JSON.stringify(r.body)}`);
  const hkApiCreate = await markInspected(roomOf('T1'), D);
  check('F7-QA-01: POST /housekeeping/tasks (INSPECTED) ghi nhận bằng chứng sẵn sàng qua API ⇒ 201 (HB-207 — đóng F7-QA-01, không cần SQL)', hkApiCreate.status === 201 && hkApiCreate.body.status === 'INSPECTED' && hkApiCreate.body.roomId === roomOf('T1'), JSON.stringify(hkApiCreate.body));

  // ---------- Era 2: 09:00 ----------
  console.log('\n## 2. TC-FO-04 check-in sớm: 09:00 (phòng sẵn sàng) → miễn phí');
  await setClock(D, '09:00:00');
  r = await postCheckIn('frontdesk', 'E1', { earlyCheckIn: true });
  check('TC-FO-04 09:00: check-in 201, earlyCheckInFee = 0', r.status === 201 && r.body.status === 'CHECKED_IN' && r.body.earlyCheckInFee === 0, `${r.status} ${JSON.stringify(r.body)}`);
  check('TC-FO-04 09:00: số dư sau check-in vẫn 0 (không phát sinh nghĩa vụ)', (await dbBalance(book.E1.id)) === 0);

  // ---------- Era 3: 10:00 — nợ, ngưỡng, phân quyền, idempotency ----------
  console.log('\n## 3. TC-FO-01 ngưỡng nợ (BR-FO-01) · BR-FO-02 sai ngày · RBAC · idempotency');
  await setClock(D, '10:00:00');
  // M1: FLEX7 cọc 30% ⇒ nợ 70% > 50% tổng ⇒ FRONT_DESK và MANAGER đều bị chặn; thu đủ rồi nhận phòng.
  r = await postCheckIn('frontdesk', 'M1');
  check('TC-FO-01 M1 (nợ 70% tổng): FRONT_DESK bị chặn 409', r.status === 409 && /nợ/.test(r.body?.message ?? ''), `${r.status} ${JSON.stringify(r.body)}`);
  r = await postCheckIn('manager', 'M1', { note: 'xin cho nợ' });
  const m1Due = book.M1.total - book.M1.deposit;
  check(`TC-FO-01 M1: MANAGER bị chặn vì nợ ${money(m1Due)} = ${Math.round((m1Due / book.M1.total) * 100)}% > 50% (phải vượt cả hai ngưỡng ⇒ chỉ cần một ngưỡng vượt là chặn)`, r.status === 409, `${r.status} ${JSON.stringify(r.body)}`);
  check('TC-FO-01 M1: booking vẫn CONFIRMED sau hai lần bị từ chối', (await statusOf(book.M1.id)) === 'CONFIRMED');
  const refusedAudit = await sql("SELECT count(*)::int AS n FROM audit_logs WHERE action = 'CHECKIN_REFUSED' AND entity_id = $1", [book.M1.id]);
  finding(
    'F7-QA-02',
    'Nhật ký CHECKIN_REFUSED không bao giờ tồn tại sau lệnh bị từ chối (ghi rồi rollback cùng transaction) ⇒ BR-SYS-05 "ai, booking nào, lý do" cho lượt từ chối không truy vết được.',
    `Sau 2 lượt check-in M1 bị 409, SELECT count(*) FROM audit_logs WHERE action='CHECKIN_REFUSED' AND entity_id=<M1> = ${refusedAudit[0].n}. service.ts ghi chú: "Lệnh bị từ chối vẫn rollback, nên dòng này chỉ có tác dụng bắt lỗi hạ tầng audit (không lưu lại)" — đúng ý định HB-143 nhưng khác diễn giải BR-SYS-05; cần lead xác nhận.`,
  );
  const due = await payBalance('M1');
  check(`BR-PAY-02: GET /balance (${money(due.due)}) = nghĩa vụ − phân bổ tính độc lập bằng SQL; thu BALANCE đúng số`, due.due === m1Due && due.res?.status === 201, `${due.due} vs ${m1Due}; ${due.res?.status}`);
  const key = randomUUID();
  r = await postCheckIn('frontdesk', 'M1', {}, key);
  check('AC1 M1: sau khi thu đủ, FRONT_DESK check-in 201, trạng thái CHECKED_IN', r.status === 201 && r.body.status === 'CHECKED_IN', `${r.status} ${JSON.stringify(r.body)}`);
  const replay = await postCheckIn('frontdesk', 'M1', {}, key);
  const hist = await sql("SELECT count(*)::int AS n FROM booking_status_history WHERE booking_id = $1 AND to_status = 'CHECKED_IN'", [book.M1.id]);
  check('Idempotency: gửi lại cùng Idempotency-Key ⇒ cùng phản hồi, đúng 1 dòng lịch sử CHECKED_IN', replay.status === 201 && replay.body.checkedInAt === r.body.checkedInAt && hist[0].n === 1, `${replay.status} hist=${hist[0].n}`);
  const again = await postCheckIn('frontdesk', 'M1');
  check('Check-in lần hai (khoá mới) bị từ chối: chỉ nhận phòng cho booking đã xác nhận', again.status === 409, `${again.status}`);

  // T1: đủ tiền (NONREF 100%)
  r = await postCheckIn('frontdesk', 'T1');
  check('TC-FO-01 lượt 1 (đủ tiền): FRONT_DESK check-in 201', r.status === 201 && r.body.earlyCheckInFee === 0, `${r.status} ${JSON.stringify(r.body)}`);

  // T2: SAVER3 cọc 50% ⇒ nợ ≤ 50% tổng và ≤ 5.000.000
  const t2Due = book.T2.total - book.T2.deposit;
  check(`TC-FO-01 T2 dữ kiện: nợ ${money(t2Due)} ≤ 5.000.000 và ≤ 50% tổng ${money(book.T2.total)}`, t2Due <= 5_000_000 && t2Due * 100 <= book.T2.total * 50, 'dữ kiện sai');
  r = await postCheckIn('frontdesk', 'T2');
  check('TC-FO-01 T2: FRONT_DESK không tự cho nợ ⇒ 409', r.status === 409, `${r.status}`);
  r = await postCheckIn('manager', 'T2', { note: 'Khách đoàn hẹn thu tại quầy ngày mai' });
  check('TC-FO-01 lượt 2: MANAGER cho nợ ≤ ngưỡng ⇒ 201', r.status === 201, `${r.status} ${JSON.stringify(r.body)}`);
  const t2Audit = await sql("SELECT reason, after_json FROM audit_logs WHERE action = 'CHECKIN_DEBT_APPROVED' AND entity_id = $1", [book.T2.id]);
  check('TC-FO-01 lượt 2: AuditLog CHECKIN_DEBT_APPROVED có lý do + hạn thu = ngày trả phòng + số nợ được duyệt', t2Audit.length === 1 && t2Audit[0].reason === 'Khách đoàn hẹn thu tại quầy ngày mai' && t2Audit[0].after_json.collectionDeadline === book.T2.checkOut && Number(t2Audit[0].after_json.approvedDebt) === t2Due, JSON.stringify(t2Audit));

  // T3: nợ vượt cả hai ngưỡng ⇒ chỉ OWNER
  const t3Due = book.T3.total - book.T3.deposit;
  check(`TC-FO-01 T3 dữ kiện: nợ ${money(t3Due)} vượt cả 5.000.000 và 50% tổng ${money(book.T3.total)}`, t3Due > 5_000_000 && t3Due * 100 > book.T3.total * 50, 'dữ kiện sai');
  r = await postCheckIn('manager', 'T3', { note: 'thử' });
  check('TC-FO-01 lượt 3: MANAGER không duyệt được nợ vượt ngưỡng ⇒ 409', r.status === 409, `${r.status} ${JSON.stringify(r.body)}`);
  r = await postCheckIn('owner', 'T3', { note: 'Chủ cho nợ, khách VIP' });
  check('TC-FO-01 lượt 3: OWNER duyệt được ⇒ 201', r.status === 201, `${r.status} ${JSON.stringify(r.body)}`);
  const t3Audit = await sql("SELECT actor_role, reason FROM audit_logs WHERE action = 'CHECKIN_DEBT_APPROVED' AND entity_id = $1", [book.T3.id]);
  check('TC-FO-01 lượt 3: AuditLog duyệt nợ ghi vai trò OWNER + lý do', t3Audit.length === 1 && t3Audit[0].actor_role === 'OWNER' && t3Audit[0].reason === 'Chủ cho nợ, khách VIP', JSON.stringify(t3Audit));

  // T4: sai ngày VN
  r = await postCheckIn('frontdesk', 'T4');
  check('TC-FO-01 lượt 4: check-in sai ngày VN (booking nhận phòng D+1) ⇒ 409 "Hôm nay không phải ngày nhận phòng"', r.status === 409 && /không phải ngày nhận phòng/.test(r.body?.message ?? ''), `${r.status} ${JSON.stringify(r.body)}`);

  // MR: booking 2 phòng — giá & thứ tự phòng khi check-in
  console.log('\n## 3a. Booking nhiều phòng (BR-BOOK-10): giá và ánh xạ phòng thực tế');
  {
    const price = priceOf('DLX');
    const perRoom = Array.from({ length: book.MR.nights }, (_u, i) => expectedNight(price, add(book.MR.checkIn, i), book.MR.nights, ids.plan.FLEX7)).reduce((t, n) => t + n, 0n);
    const expectedTotal = floor1000(perRoom * 2n);
    check(`BR-BOOK-10/BR-RATE: booking 2 phòng DLX 1 đêm phải bằng 2 × giá 1 phòng = ${money(expectedTotal)} (QA tự tính từ BR-RATE-06/07)`, BigInt(book.MR.total) === expectedTotal, `API tính ${money(book.MR.total)} = ${money(floor1000(perRoom))} (giá của MỘT phòng)`);
    const quotes = [];
    for (const rooms of [1, 2, 3]) {
      const q = await api('/quotes', { token: await login('frontdesk'), method: 'POST', body: { propertyId: ids.property, roomTypeId: ids.type.SUP.id, channelCode: 'WALKIN', ratePlanCode: 'FLEX7', checkIn: add(D, 20), checkOut: add(D, 21), adults: 2, children: 0, roomCount: rooms } });
      quotes.push(q.body.total);
    }
    const perRows = await sql('SELECT price_per_night FROM booking_rooms WHERE booking_id = $1', [book.MR.id]);
    if (BigInt(book.MR.total) !== expectedTotal)
      finding(
        'F7-QA-03',
        'Booking nhiều phòng bị tính giá bằng MỘT phòng: `totalAmount` không nhân với `roomCount`, giá một đêm bị chia đều cho các `BookingRoom`.',
        `Walk-in DLX 2 phòng 1 đêm → total ${money(book.MR.total)} (kỳ vọng ${money(expectedTotal)}); price_per_night mỗi BookingRoom = ${perRows.map((x) => x.price_per_night).join(' + ')}; POST /quotes cùng kỳ roomCount 1/2/3 → total ${quotes.join(' / ')} (bằng nhau). Nguồn: bookings/snapshot.ts planSnapshot phân bổ quote.total (giá 1 phòng) cho roomCount × đêm; packages/domain pricing không nhận roomCount. Hệ quả: thu cọc, số dư, phạt no-show, hoàn tiền, báo cáo doanh thu đều thấp hơn thực tế khi đặt ≥2 phòng.`,
      );
  }
  await payBalance('MR');
  {
    const ordered = (await sql('SELECT a.room_id FROM room_assignments a JOIN booking_rooms br ON br.id = a.booking_room_id WHERE br.booking_id = $1 AND a.released_at IS NULL ORDER BY br.id', [book.MR.id])).map((x) => x.room_id);
    const reversed = [...ordered].reverse();
    r = await api('/front-office/check-in', { token: await login('frontdesk'), method: 'POST', body: { bookingId: book.MR.id, actualRoomIds: reversed, earlyCheckIn: false } });
    check('F7-QA-04: check-in booking 2 phòng với actualRoomIds KHÁC thứ tự booking_rooms.id ⇒ 201 (ghép lại đúng đơn vị, HB-206 — hết E_INV_ROOM_TAKEN)', r.status === 201 && eq([...r.body.roomIds].sort(), [...reversed].sort()), `${r.status} ${JSON.stringify(r.body)}`);
    const live = (await sql('SELECT a.room_id FROM room_assignments a JOIN booking_rooms br ON br.id = a.booking_room_id WHERE br.booking_id = $1 AND a.released_at IS NULL ORDER BY br.id', [book.MR.id])).map((x) => x.room_id);
    check('F7-QA-04: mỗi phòng gán đúng một đơn vị bán (không phòng nào bị chiếm hai lần)', new Set(live).size === 2 && eq([...live].sort(), [...reversed].sort()), JSON.stringify(live));
  }

  // L1–L3 nhận phòng cho TC-FO-03 (đã thu đủ)
  for (const label of ['L1', 'L2', 'L3']) {
    r = await postCheckIn('frontdesk', label);
    check(`${label}: check-in 201 (NONREF thu đủ cọc 100%)`, r.status === 201, `${r.status} ${JSON.stringify(r.body)}`);
  }

  // --- RBAC / bảo mật lệnh FO ---
  console.log('\n## 3b. AC3 RBAC + PIN của lệnh FO');
  for (const role of ['housekeeping', 'reservation', 'accountant', 'sysadmin']) {
    const t = await login(role);
    const a = await api('/front-office/check-in', { token: t, method: 'POST', body: checkInBody('E2') });
    const b = await api('/front-office/check-out', { token: t, method: 'POST', body: { bookingId: book.M1.id, lateCheckOut: false, earlyCheckOut: false } });
    const c = await api('/front-office/no-show', { token: t, method: 'POST', body: { bookingId: book.E2.id, reason: 'thử' } });
    check(`RBAC: ${role} gọi check-in/check-out/no-show ⇒ 403 cả ba`, [a, b, c].every((x) => x.status === 403), `${a.status}/${b.status}/${c.status}`);
  }
  r = await api('/front-office/check-in', { method: 'POST', body: checkInBody('E2') });
  check('RBAC: không token ⇒ 401', r.status === 401, `${r.status}`);
  r = await api('/front-office/check-in', { token: await login('frontdesk'), method: 'POST', body: { ...checkInBody('E2'), extra: 1 } });
  check('Hợp đồng strict: trường lạ trong thân check-in ⇒ 400', r.status === 400, `${r.status} ${JSON.stringify(r.body)}`);
  r = await api('/front-office/check-in', { token: await login('frontdesk'), method: 'POST', body: { bookingId: book.X1.id, actualRoomIds: book.X1.roomIds, earlyCheckIn: false } });
  check('Phạm vi cơ sở: FRONT_DESK (CS-01) check-in booking của CS-02 ⇒ 403/404', r.status === 403 || r.status === 404, `${r.status} ${JSON.stringify(r.body)}`);
  r = await api('/front-office/check-in', { token: await login('frontdesk'), method: 'POST', body: checkInBody('E2'), key: null });
  check('Idempotency: thiếu Idempotency-Key ⇒ lỗi 4xx (không chạy lệnh)', r.status >= 400 && r.status < 500 && (await statusOf(book.E2.id)) === 'CONFIRMED', `${r.status} ${JSON.stringify(r.body)}`);

  // PIN của check-out
  r = await postCheckOut('M1', { pin: false });
  check('PIN: check-out không pinToken ⇒ 401/403, không đổi trạng thái', (r.status === 401 || r.status === 403) && (await statusOf(book.M1.id)) === 'CHECKED_IN', `${r.status} ${JSON.stringify(r.body)}`);
  const wrongBooking = await mintPin('frontdesk', book.T1.id);
  r = await api('/front-office/check-out', { token: await login('frontdesk'), method: 'POST', body: { bookingId: book.M1.id, lateCheckOut: false, earlyCheckOut: false, pinToken: wrongBooking } });
  check('PIN: pinToken của booking khác ⇒ từ chối (BR-RBAC-05 gắn booking)', r.status === 401 || r.status === 403, `${r.status} ${JSON.stringify(r.body)}`);

  // ---------- Era 4: 13:00 ----------
  console.log('\n## 4. TC-FO-04 check-in sớm: 13:00 → phụ thu 30% giá đêm đầu');
  await setClock(D, '13:00:00');
  r = await postCheckIn('frontdesk', 'E2', { earlyCheckIn: true });
  const first = await firstNightCharge(book.E2.id);
  const expectedEarly = ceilPct(BigInt(first), 30n);
  check(`TC-FO-04 13:00: earlyCheckInFee = ⌈30% × đêm đầu ${money(first)}⌉1.000 = ${money(expectedEarly)}`, r.status === 201 && BigInt(r.body.earlyCheckInFee) === expectedEarly, `${r.status} ${JSON.stringify(r.body)}`);
  const e2Charge = await sql("SELECT amount FROM booking_charges WHERE booking_id = $1 AND kind = 'EXTRA_SERVICE'", [book.E2.id]);
  check('TC-FO-04 13:00: phụ thu được ghi thành nghĩa vụ EXTRA_SERVICE và số dư = phụ thu', e2Charge.length === 1 && BigInt(e2Charge[0].amount) === expectedEarly && BigInt(await dbBalance(book.E2.id)) === expectedEarly, JSON.stringify(e2Charge));
  r = await postCheckIn('frontdesk', 'V1');
  check('V1: nợ + giờ 13:00 — FRONT_DESK vẫn bị chặn nợ trước khi tính phụ thu', r.status === 409, `${r.status}`);

  // ---------- Era 5: 23:58 / 23:59 ----------
  console.log('\n## 5. TC-FO-02 / BR-FO-02 mốc 23:59 và TC-FO-07 no-show (API)');
  await setClock(D, '14:30:00');
  r = await api('/front-office/no-show', { token: await login('frontdesk'), method: 'POST', body: { bookingId: book.V1.id, reason: 'Khách không liên lạc được' } });
  check('TC-FO-07: ghi no-show trước 23:59 ngày nhận phòng ⇒ 409 (máy chủ giữ mốc 23:59, BR-CANCEL-10)', r.status === 409 && /23:59/.test(r.body?.message ?? ''), `${r.status} ${JSON.stringify(r.body)}`);
  await setClock(D, '23:58:50');
  r = await postCheckIn('frontdesk', 'U2');
  check('BR-FO-02: 23:58:50 check-in vẫn được (trước mốc 23:59:00)', r.status === 201, `${r.status} ${JSON.stringify(r.body)}`);
  await setClock(D, '23:59:00');
  r = await postCheckIn('frontdesk', 'U1');
  check('BR-FO-02: đúng 23:59:00 (bao gồm mốc) check-in bị từ chối, yêu cầu xử lý no-show trước', r.status === 409 && /no-show/.test(r.body?.message ?? ''), `${r.status} ${JSON.stringify(r.body)}`);

  await setClock(D, '23:59:30');
  const v1Paid = book.V1.deposit;
  const v1First = await firstNightCharge(book.V1.id);
  const expectedPenalty = Math.max(0, v1First - v1Paid); // BR-CANCEL-06
  r = await api('/front-office/no-show', { token: await login('frontdesk'), method: 'POST', body: { bookingId: book.V1.id, reason: 'Khách không đến' } });
  check(`TC-FO-07: no-show lúc 23:59:30 ⇒ 200 NO_SHOW, phạt = max(0, đêm đầu ${money(v1First)} − đã thu ${money(v1Paid)}) = ${money(expectedPenalty)} (BR-CANCEL-06)`, r.status === 200 && r.body.status === 'NO_SHOW' && r.body.penaltyAmount === expectedPenalty, `${r.status} ${JSON.stringify(r.body)}`);
  const v1 = await sql("SELECT status, paid_amount FROM bookings WHERE id = $1", [book.V1.id]);
  const v1Rooms = await sql('SELECT count(*)::int AS n FROM room_assignments a JOIN booking_rooms br ON br.id = a.booking_room_id WHERE br.booking_id = $1 AND a.released_at IS NULL', [book.V1.id]);
  const v1Pen = await sql("SELECT count(*)::int AS n, coalesce(sum(amount - voided_amount),0)::bigint AS s FROM booking_charges WHERE booking_id = $1 AND kind <> 'ROOM'", [book.V1.id]);
  check('TC-FO-07: trạng thái NO_SHOW, phòng được giải phóng, không hoàn cọc (0%), nghĩa vụ phạt = phạt', v1[0].status === 'NO_SHOW' && v1Rooms[0].n === 0 && Number(v1[0].paid_amount) === v1Paid && Number(v1Pen[0].s) === expectedPenalty && r.body.refundRequestId === null, JSON.stringify({ v1, v1Rooms, v1Pen, body: r.body }));
  r = await postCheckIn('frontdesk', 'V1');
  check('TC-FO-07: booking NO_SHOW không check-in được', r.status === 409, `${r.status}`);

  // ---------- Era 6: 00:30 ngày sau ----------
  await setClock(add(D, 1), '00:30:00');
  r = await postCheckIn('frontdesk', 'U1');
  check('TC-FO-02: 00:30 ngày hôm sau, booking còn CONFIRMED ⇒ check-in bị từ chối, yêu cầu xử lý no-show trước', r.status === 409 && /no-show/.test(r.body?.message ?? ''), `${r.status} ${JSON.stringify(r.body)}`);
  check('TC-FO-02: U1 vẫn CONFIRMED, chưa có lịch sử CHECKED_IN', (await statusOf(book.U1.id)) === 'CONFIRMED');

  // ---------- Era 7: trả phòng M1 (D+2 15:00) + buồng phòng + giao phòng khách kế tiếp ----------
  console.log('\n## 7. AC1 trả phòng muộn → việc dọn phòng → giao phòng cho khách kế tiếp (TC-FO-05, BR-FO-05/06/07)');
  await setClock(add(D, 2), '15:00:00');
  const last = await lastNightCharge(book.M1.id);
  const expected50 = ceilPct(BigInt(last), 50n);
  r = await postCheckOut('M1', { late: true });
  check('TC-FO-05: trả phòng muộn còn nợ phụ thu ⇒ 422 "Còn số dư phải thu trước khi trả phòng", trạng thái giữ CHECKED_IN (BR-FO-05)', r.status === 422 && (await statusOf(book.M1.id)) === 'CHECKED_IN', `${r.status} ${JSON.stringify(r.body)}`);
  const fee1 = await sql("SELECT amount FROM booking_charges WHERE booking_id = $1 AND kind = 'EXTRA_SERVICE'", [book.M1.id]);
  check(`TC-FO-03 15:00: phụ thu muộn 50% đêm cuối ${money(last)} = ${money(expected50)} được chốt thành nghĩa vụ ngay lần gọi đầu`, fee1.length === 1 && BigInt(fee1[0].amount) === expected50, JSON.stringify(fee1));
  const lateDue = await payBalance('M1');
  check(`TC-FO-05: thu đúng số dư phụ thu ${money(lateDue.due)} (PIN, BALANCE)`, BigInt(lateDue.due) === expected50 && lateDue.res?.status === 201, `${lateDue.due} ${lateDue.res?.status}`);
  const nextBook = book.N1;
  r = await postCheckOut('M1', { late: true });
  check('TC-FO-05: sau khi thu đủ trả phòng 200 CHECKED_OUT, feeAmount = phụ thu, balanceDue = 0, sinh việc dọn phòng', r.status === 200 && r.body.status === 'CHECKED_OUT' && BigInt(r.body.feeAmount) === expected50 && r.body.balanceDue === 0 && r.body.housekeepingTaskIds.length === 1, `${r.status} ${JSON.stringify(r.body)}`);
  const feeRows = await sql("SELECT count(*)::int AS n FROM booking_charges WHERE booking_id = $1 AND kind = 'EXTRA_SERVICE'", [book.M1.id]);
  check('TC-FO-05: gọi trả phòng hai lần (trước và sau khi thu) không nhân đôi phụ thu (1 nghĩa vụ EXTRA_SERVICE)', feeRows[0].n === 1);
  const tasks = await sql('SELECT id, status, business_date::text AS d, room_id FROM housekeeping_tasks WHERE room_id = $1 ORDER BY created_at DESC', [roomOf('M1')]);
  check('BR-FO-06: việc dọn phòng PENDING với businessDate = ngày trả phòng cho đúng phòng', tasks[0].status === 'PENDING' && tasks[0].d === add(D, 2) && tasks[0].room_id === roomOf('M1'), JSON.stringify(tasks));
  const inv = await sql("SELECT released_at IS NOT NULL AS released FROM room_assignments a JOIN booking_rooms br ON br.id = a.booking_room_id WHERE br.booking_id = $1", [book.M1.id]);
  check('BR-FO-05: phòng được giải phóng (assignment released_at) sau khi chốt số dư', inv.every((x) => x.released));

  // Khách kế tiếp N1 nhận cùng phòng trong ngày: phòng chưa DONE ⇒ không giao (BR-FO-07)
  const sameRoom = roomOf('M1');
  const n1RoomIsSame = book.N1.roomIds[0] === sameRoom;
  const n1Pay = await payBalance('N1');
  void n1Pay;
  r = await api('/front-office/check-in', { token: await login('manager'), method: 'POST', body: { bookingId: nextBook.id, actualRoomIds: [sameRoom], earlyCheckIn: false, note: 'cho nợ' } });
  check(`BR-FO-07: khách kế tiếp (cùng phòng ${n1RoomIsSame ? 'đã được gán' : 'chọn tay'}) ⇒ KHÔNG giao khi việc dọn còn PENDING`, r.status === 409 && /chưa sẵn sàng/.test(r.body?.message ?? ''), `${r.status} ${JSON.stringify(r.body)}`);

  // HOUSEKEEPING — dữ liệu tối thiểu, chỉ thấy việc của mình
  const hkToken = await login('housekeeping');
  const fdToken = await login('frontdesk');
  let list = await api(`/housekeeping/tasks?propertyId=${ids.property}&businessDate=${add(D, 2)}`, { token: hkToken });
  check('AC3: HOUSEKEEPING chưa được giao thì không thấy việc nào', list.status === 200 && list.body.data.length === 0, JSON.stringify(list.body));
  list = await api(`/housekeeping/tasks?propertyId=${ids.property}&businessDate=${add(D, 2)}`, { token: fdToken });
  const task = list.body.data.find((t) => t.roomId === sameRoom);
  r = await api(`/housekeeping/tasks/${task.id}`, { token: fdToken, method: 'PATCH', body: { assignedTo: hkId }, headers: { 'If-Match': `"${task.version}"` } });
  check('FRONT_DESK phân công việc dọn cho HOUSEKEEPING cùng cơ sở ⇒ 200, version tăng', r.status === 200 && r.body.assignedTo === hkId && r.body.version === task.version + 1, `${r.status} ${JSON.stringify(r.body)}`);
  list = await api(`/housekeeping/tasks?propertyId=${ids.property}&businessDate=${add(D, 2)}`, { token: hkToken });
  const dtoKeys = Object.keys(list.body.data[0] ?? {}).sort();
  const allowedKeys = ['assignedTo', 'businessDate', 'completedAt', 'id', 'note', 'roomCode', 'roomId', 'status', 'version'];
  check('AC3: DTO việc dọn phòng chỉ gồm các trường tối thiểu (không có booking/khách/tiền)', eq(dtoKeys, allowedKeys), JSON.stringify(dtoKeys));
  for (const [path, label] of [['/bookings', 'GET /bookings'], [`/bookings/${book.M1.id}`, 'GET /bookings/{id}'], [`/bookings/${book.M1.id}/balance`, 'GET /bookings/{id}/balance'], ['/guests?q=Kh', 'GET /guests']]) {
    const x = await api(path, { token: hkToken });
    check(`AC3: HOUSEKEEPING ${label} ⇒ 403 (BR-RBAC-03)`, x.status === 403, `${x.status}`);
  }
  const hkPay = await api('/payments', { token: hkToken, method: 'POST', body: { bookingId: book.M1.id, type: 'BALANCE', method: 'CASH', amount: 1000 } });
  check('AC3: HOUSEKEEPING POST /payments ⇒ 403', hkPay.status === 403, `${hkPay.status}`);
  r = await api(`/housekeeping/tasks/${task.id}`, { token: hkToken, method: 'PATCH', body: { status: 'DONE' }, headers: { 'If-Match': `"${list.body.data[0].version}"` } });
  check('BR-FO-07: PENDING → DONE trực tiếp bị chặn (phải qua IN_PROGRESS)', r.status >= 400 && r.status < 500, `${r.status} ${JSON.stringify(r.body)}`);
  r = await api(`/housekeeping/tasks/${task.id}`, { token: hkToken, method: 'PATCH', body: { status: 'IN_PROGRESS' }, headers: { 'If-Match': `"${list.body.data[0].version}"` } });
  check('HOUSEKEEPING PENDING → IN_PROGRESS ⇒ 200', r.status === 200 && r.body.status === 'IN_PROGRESS', `${r.status} ${JSON.stringify(r.body)}`);
  r = await api(`/front-office/check-in`, { token: await login('manager'), method: 'POST', body: { bookingId: nextBook.id, actualRoomIds: [sameRoom], earlyCheckIn: false, note: 'cho nợ' } });
  check('BR-FO-07: việc dọn IN_PROGRESS vẫn chưa giao phòng', r.status === 409 && /chưa sẵn sàng/.test(r.body?.message ?? ''), `${r.status}`);
  r = await api(`/housekeeping/tasks/${task.id}`, { token: hkToken, method: 'PATCH', body: { status: 'DONE' }, headers: { 'If-Match': `"${r.body?.version ?? 3}"` } });
  if (r.status === 412 || r.status === 428) {
    const refreshed = await api(`/housekeeping/tasks?propertyId=${ids.property}&businessDate=${add(D, 2)}`, { token: hkToken });
    r = await api(`/housekeeping/tasks/${task.id}`, { token: hkToken, method: 'PATCH', body: { status: 'DONE' }, headers: { 'If-Match': `"${refreshed.body.data[0].version}"` } });
  }
  check('HOUSEKEEPING IN_PROGRESS → DONE ⇒ 200 có completedAt', r.status === 200 && r.body.status === 'DONE' && r.body.completedAt, `${r.status} ${JSON.stringify(r.body)}`);
  r = await api(`/front-office/check-in`, { token: await login('manager'), method: 'POST', body: { bookingId: nextBook.id, actualRoomIds: [sameRoom], earlyCheckIn: false, note: 'cho nợ' } });
  check('AC1 cuối: việc dọn DONE ⇒ giao phòng cho khách kế tiếp 201 (cùng phòng, cùng ngày)', r.status === 201 && eq(r.body.roomIds, [sameRoom]), `${r.status} ${JSON.stringify(r.body)}`);

  // ---------- Khách ở cùng phòng đến sau một ngày ----------
  console.log('\n## 7b. N1 trả phòng đúng hạn (11:00, trước 12:00)');
  await setClock(add(D, 3), '11:00:00');
  r = await postCheckOut('N1', { late: false });
  check('N1 trả phòng đúng hạn (11:00 < 12:00) ⇒ 200, không phụ thu, số dư 0', r.status === 200 && r.body.feeAmount === 0 && r.body.balanceDue === 0, `${r.status} ${JSON.stringify(r.body)}`);

  // ---------- Era 8: TC-FO-03 trả phòng muộn ba mốc ----------
  console.log('\n## 8. TC-FO-03 phụ thu trả phòng muộn theo ba mốc (đêm cuối của L1–L3)');
  const timeline = [['L1', '11:30:00', 0n, false], ['L2', '15:00:00', 50n, true], ['L3', '19:00:00', 100n, true]];
  for (const [label, time, pct, late] of timeline) {
    await setClock(add(D, 4), time);
    const lastNight = BigInt(await lastNightCharge(book[label].id));
    const expected = ceilPct(lastNight, pct);
    let res = await postCheckOut(label, { late });
    if (expected > 0n) {
      check(`TC-FO-03 ${time.slice(0, 5)}: lần gọi đầu còn nợ phụ thu ⇒ 422`, res.status === 422, `${res.status} ${JSON.stringify(res.body)}`);
      const pay = await payBalance(label);
      check(`TC-FO-03 ${time.slice(0, 5)}: phụ thu ghi nghĩa vụ = ${pct}% đêm cuối ${money(lastNight)} = ${money(expected)}`, BigInt(pay.due) === expected, `${pay.due}`);
      res = await postCheckOut(label, { late });
    }
    check(`TC-FO-03 ${time.slice(0, 5)}: trả phòng 200, feeAmount = ${money(expected)}`, res.status === 200 && BigInt(res.body.feeAmount) === expected && res.body.balanceDue === 0, `${res.status} ${JSON.stringify(res.body)}`);
  }
  // ---------- Era 9/10: phòng dọn xong hôm trước, khách nhận hôm sau ----------
  console.log('\n## 9. F7-QA-05 phòng trả D+4 (dọn xong ngày D+4) — khách kế tiếp nhận ngày D+5 (BR-FO-07 "lượt giải phóng gần nhất", HB-206 đã sửa)');
  await setClock(add(D, 4), '20:00:00');
  const l1Room = roomOf('L1');
  const l1Tasks = await api(`/housekeeping/tasks?propertyId=${ids.property}&businessDate=${add(D, 4)}`, { token: await login('frontdesk') });
  const l1Task = l1Tasks.body.data.find((t) => t.roomId === l1Room);
  r = await api(`/housekeeping/tasks/${l1Task.id}`, { token: await login('frontdesk'), method: 'PATCH', body: { assignedTo: hkId }, headers: { 'If-Match': `"${l1Task.version}"` } });
  let ver = r.body.version;
  for (const status of ['IN_PROGRESS', 'DONE']) {
    r = await api(`/housekeeping/tasks/${l1Task.id}`, { token: await login('housekeeping'), method: 'PATCH', body: { status }, headers: { 'If-Match': `"${ver}"` } });
    ver = r.body.version;
  }
  check('Việc dọn phòng L1 (ngày D+4) hoàn tất qua API: DONE', r.status === 200 && r.body.status === 'DONE', `${r.status} ${JSON.stringify(r.body)}`);
  await setClock(add(D, 5), '10:00:00');
  r = await api('/front-office/check-in', { token: await login('frontdesk'), method: 'POST', body: { bookingId: book.W2.id, actualRoomIds: [l1Room], earlyCheckIn: false } });
  check('F7-QA-05: phòng dọn DONE hôm D+4, khách nhận D+5 ⇒ giao được 201 (bằng chứng của LƯỢT GIẢI PHÓNG GẦN NHẤT, HB-206 — hết 409 sai)', r.status === 201 && eq(r.body.roomIds, [l1Room]), `${r.status} ${JSON.stringify(r.body)}`);
  const l1Dated = (await sql('SELECT count(*)::int AS n FROM housekeeping_tasks WHERE room_id = $1 AND business_date = $2::date', [l1Room, add(D, 5)]))[0].n;
  check('F7-QA-05: KHÔNG cần việc dọn mang đúng ngày nhận phòng (D+5) — bằng chứng lấy từ lượt giải phóng D+4', l1Dated === 0, `task D+5 = ${l1Dated}`);

  // cờ lateCheckOut do client gửi nhưng giờ do máy chủ quyết: kiểm L2-like cờ sai ở booking khác không còn rảnh ⇒ ghi chú giới hạn.

  // ---------- Kết ----------
  const failed = results.filter((x) => !x.pass).length;
  console.log(`\n# TỔNG: ${results.length - failed}/${results.length} PASS · ${findings.length} phát hiện (FINDING) · CSDL ${dbInfo.name}`);
  console.log('\n## Phát hiện');
  for (const f of findings) console.log(`- ${f.id}: ${f.summary}\n  Bằng chứng: ${f.evidence}`);
}

try {
  await main();
} catch (error) {
  console.error('LỖI SCRIPT:', error);
  process.exitCode = 1;
} finally {
  await teardown();
}
