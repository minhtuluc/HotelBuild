/**
 * HB-117 — ngữ cảnh dùng chung của các kịch bản QA F5: dữ liệu tham chiếu từ CSDL seed, dựng booking qua API thật,
 * hàm tiền độc lập (BR-GEN-03) và bảng chính sách huỷ **chép từ tài liệu** (`chinh-sach-huy-hoan-coc.md` §3.3), không từ mã.
 */
import { api, check, finding, login, mintPin, setClock, sql, vn } from './qa-f5-lib.mjs';

export const floor1000 = (n) => (BigInt(n) / 1000n) * 1000n;
export const ceil1000 = (n) => {
  const v = BigInt(n);
  return v % 1000n === 0n ? v : (v / 1000n + 1n) * 1000n;
};
export const num = (v) => Number(v);
export const errCode = (res) => (res.body && typeof res.body === 'object' ? res.body.code : undefined);
export const addDays = (date, n) => new Date(Date.parse(`${date}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
/** Ngày VN (yyyy-mm-dd) của một thời điểm tuyệt đối. */
export const vnDate = (ms) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Ho_Chi_Minh' }).format(new Date(ms));
export const vnTime = (ms) =>
  new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Ho_Chi_Minh', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).format(new Date(ms));
/** Đặt giờ VN của API theo thời điểm tuyệt đối `ms`. */
export const clockAt = (ms) => setClock(vnDate(ms), vnTime(ms));
/** Trả đồng hồ API về giờ thật: hold/PSP/ghi tiền tính hạn theo giờ CSDL thật nên mọi booking phải được dựng ở giờ thật. */
export const realClock = () => clockAt(Date.now());
export const money = (n) => `${Number(n).toLocaleString('vi-VN')} ₫`;

/**
 * Bảng bậc chính sách huỷ — NGUỒN: docs/02-nghiep-vu/chinh-sach-huy-hoan-coc.md §3.3 (không đọc từ CSDL/mã).
 * Mỗi bậc: `[offsetHours, refundPercent, chargeFirstNight]` theo thứ tự `offsetHours` giảm dần; bậc −1 là bắt tất.
 */
export const POLICY = {
  FLEX7: { deposit: 30, tiers: [[168, 100, false], [72, 50, false], [24, 0, false], [-1, 0, true]] },
  SAVER3: { deposit: 50, tiers: [[72, 100, false], [24, 50, false], [-1, 0, true]] },
  NONREF: { deposit: 100, tiers: [[-1, 0, false]] },
  LONGSTAY14: { deposit: 30, tiers: [[336, 100, false], [168, 50, false], [-1, 0, true]] },
};
/** BR-CANCEL-01: bậc có `offsetHours` không âm lớn nhất ≤ số giờ; không có ⇒ bậc −1. */
export function tierFor(plan, hours) {
  const tiers = POLICY[plan].tiers;
  const hit = tiers.find(([offset]) => offset >= 0 && hours >= offset);
  return hit ?? tiers[tiers.length - 1];
}

export const ctx = {
  ids: {},
  book: {},
  seq: 0,
  /** Mọi phản hồi API đã thấy — quét dữ liệu thẻ ở cuối lượt (BR-PAY-04). */
  seen: [],
  async load() {
    const [p] = await sql("SELECT id FROM properties WHERE code = 'CS-01'");
    const [p2] = await sql("SELECT id FROM properties WHERE code = 'CS-02'");
    this.ids.property = p.id;
    this.ids.property2 = p2.id;
    const types = await sql('SELECT id, code, base_price, min_price, max_price, property_id FROM room_types');
    this.ids.type = Object.fromEntries(types.filter((t) => t.property_id === p.id).map((t) => [t.code, t]));
    this.ids.type2 = Object.fromEntries(types.filter((t) => t.property_id === p2.id).map((t) => [t.code, t]));
    const [{ value }] = await sql("SELECT value FROM system_settings WHERE key = 'refund.feeAmount'");
    this.ids.feeSetting = value;
    // Đối chiếu bậc trong CSDL seed với bảng tài liệu (nếu lệch ⇒ phát hiện, không sửa bảng tài liệu để cho khớp).
    const tiers = await sql(
      `SELECT cp.code, t.offset_hours, t.refund_percent, t.charge_first_night
         FROM cancellation_tiers t JOIN cancellation_policies cp ON cp.id = t.policy_id
        ORDER BY cp.code, t.offset_hours DESC`,
    );
    const fromDb = {};
    for (const t of tiers) (fromDb[t.code] ??= []).push([Number(t.offset_hours), Number(t.refund_percent), t.charge_first_night]);
    for (const [plan, def] of Object.entries(POLICY)) {
      const code = plan.replace('LONGSTAY14', 'LONGSTAY14');
      const db = fromDb[`CP-${plan}`] ?? fromDb[plan] ?? fromDb[code];
      const same = JSON.stringify(db) === JSON.stringify(def.tiers.map((t) => [...t]));
      check(`Bậc chính sách ${plan} trong CSDL seed khớp bảng tài liệu §3.3`, same, `CSDL=${JSON.stringify(db)} · tài liệu=${JSON.stringify(def.tiers)}`);
    }
  },
};

/** Gọi API và ghi lại phản hồi để quét dữ liệu thẻ. */
export async function call(path, opts) {
  const res = await api(path, opts);
  ctx.seen.push({ path, method: opts?.method ?? 'GET', status: res.status, body: res.body });
  return res;
}

/**
 * Walk-in (kênh WALKIN cấu hình) + tuỳ chọn thu cọc/toàn bộ bằng tiền mặt có PIN. Trả mô tả booking từ **phản hồi API** và
 * `room_assignments` thật. `at` (ms) đặt giờ API trước khi tạo; thiếu ⇒ giữ giờ hiện hành.
 */
export async function makeBooking(label, { role = 'frontdesk', property = 'p1', type = 'DLX', plan = 'FLEX7', from, to, rooms = 1, pay = 'deposit' } = {}) {
  await realClock();
  const token = await login(role);
  const propId = property === 'p1' ? ctx.ids.property : ctx.ids.property2;
  const types = property === 'p1' ? ctx.ids.type : ctx.ids.type2;
  ctx.seq += 1;
  const res = await call('/walk-in', {
    token,
    method: 'POST',
    body: {
      propertyId: propId,
      roomTypeId: types[type].id,
      ratePlanCode: plan,
      checkIn: from,
      checkOut: to,
      adults: 2,
      children: 0,
      roomCount: rooms,
      guest: { fullName: `Khách QA F5 ${label}`, phone: `09${String(20_000_000 + ctx.seq * 211).slice(0, 8)}` },
    },
  });
  if (res.status !== 201) throw new Error(`walk-in ${label} → ${res.status} ${JSON.stringify(res.body)}`);
  const b = res.body.booking;
  const nights = (Date.parse(to) - Date.parse(from)) / 86_400_000;
  const out = { label, id: b.id, code: b.code, total: b.totalAmount, deposit: b.depositAmount, from, to, nights, plan, type, rooms, quote: res.body.quote, paid: 0, role };
  ctx.book[label] = out;
  if (pay !== 'none') {
    const amount = pay === 'full' ? b.totalAmount : b.depositAmount;
    const kind = pay === 'full' ? 'DEPOSIT' : 'DEPOSIT';
    const pin = await mintPin(role, b.id);
    const paid = await call('/payments', { token, method: 'POST', body: { bookingId: b.id, type: kind, method: 'CASH', amount: b.depositAmount, pinToken: pin } });
    if (paid.status !== 201 || paid.body.status !== 'SUCCEEDED') throw new Error(`cọc ${label} → ${paid.status} ${JSON.stringify(paid.body)}`);
    out.paid = b.depositAmount;
    if (pay === 'full' && b.totalAmount > b.depositAmount) {
      const rest = b.totalAmount - b.depositAmount;
      const pin2 = await mintPin(role, b.id);
      const bal = await call('/payments', { token, method: 'POST', body: { bookingId: b.id, type: 'BALANCE', method: 'CASH', amount: rest, pinToken: pin2 } });
      if (bal.status !== 201 || bal.body.status !== 'SUCCEEDED') throw new Error(`số dư ${label} → ${bal.status} ${JSON.stringify(bal.body)}`);
      out.paid = b.totalAmount;
    }
  }
  return out;
}

export async function bookingRow(id) {
  const [row] = await sql(
    'SELECT status, total_amount, paid_amount, refunded_amount, penalty_amount, balance_due, reschedule_count, check_in, check_out FROM bookings WHERE id = $1::uuid',
    [id],
  );
  return row;
}
export async function refundRows(bookingId) {
  return sql('SELECT * FROM refund_requests WHERE booking_id = $1::uuid ORDER BY created_at', [bookingId]);
}
export { api, check, finding, login, mintPin, sql, vn };
