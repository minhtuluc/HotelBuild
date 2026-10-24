/**
 * HB-117 §1 — huỷ theo bậc chính sách trên API thật: bậc/hoàn/phạt/phí, ca biên ±1 phút quanh mốc, bất khả kháng,
 * trạng thái sau huỷ (BR-CANCEL-01…06, 11, 13; BR-PAY-02; BR-BOOK-11, BR-BOOK-14). Số kỳ vọng tính bằng biểu thức độc lập
 * từ bảng tài liệu (`POLICY` trong `qa-f5-ctx.mjs`), không từ engine.
 */
import {
  addDays, bookingRow, call, check, clockAt, ctx, errCode, finding, floor1000, login, makeBooking, mintPin, money, num, refundRows, sql, tierFor, vn,
} from './qa-f5-ctx.mjs';

const MIN = 60_000;
const D0 = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Ho_Chi_Minh' }).format(new Date());

/** [nhãn, gói, số phút trước giờ nhận phòng danh nghĩa 14:00 VN]. ±1 phút quanh từng mốc của bảng tài liệu. */
const CASES = [
  ['F7-100 (168h+1p)', 'FLEX7', 168 * 60 + 1],
  ['F7-50  (168h-1p)', 'FLEX7', 168 * 60 - 1],
  ['F7-50b (72h+1p)', 'FLEX7', 72 * 60 + 1],
  ['F7-0   (72h-1p)', 'FLEX7', 72 * 60 - 1],
  ['F7-0b  (24h+1p)', 'FLEX7', 24 * 60 + 1],
  ['F7-pen (24h-1p)', 'FLEX7', 24 * 60 - 1],
  ['S3-100 (72h+1p)', 'SAVER3', 72 * 60 + 1],
  ['S3-50  (72h-1p)', 'SAVER3', 72 * 60 - 1],
  ['S3-50b (24h+1p)', 'SAVER3', 24 * 60 + 1],
  ['S3-pen (24h-1p)', 'SAVER3', 24 * 60 - 1],
  ['NR-far (200h)', 'NONREF', 200 * 60],
  ['NR-near (10h)', 'NONREF', 10 * 60],
];

let day = 0;
/** Kỳ ở: nhận phòng ngày X (14:00 VN), 3 đêm (SAVER3 tối thiểu 3 đêm); đồng hồ API đặt cách X-14:00 đúng `minutesBefore` phút. */
function window(minutesBefore) {
  day += 1;
  const from = addDays(D0, 25 + day);
  const nominal = vn(from, '14:00:00');
  return { from, to: addDays(from, 3), at: nominal - minutesBefore * MIN, nominal };
}

export async function scenarioCancelTiers(section) {
  // Pha 1 — dựng mọi booking ở giờ THẬT (hold/ghi tiền tính hạn theo giờ CSDL thật); pha 2 — dịch đồng hồ API rồi huỷ.
  const planned = [];
  for (const [label, plan, minutes] of CASES) {
    const w = window(minutes);
    const b = await makeBooking(label, { plan, from: w.from, to: w.to, type: plan === 'NONREF' ? 'SUP' : 'DLX' });
    planned.push({ label, plan, b, w });
  }
  planned.sort((x, y) => x.w.at - y.w.at);
  for (const { label, plan, b, w } of planned) {
    await clockAt(w.at);
    const hours = (w.nominal - w.at) / 3_600_000;
    const [offset, pct, charge] = tierFor(plan, hours);
    const base = BigInt(b.paid);
    const refundAmount = Number(floor1000((base * BigInt(pct)) / 100n));
    const firstNight = b.quote.nights[0].nightlyPrice;
    const penalty = charge ? Math.max(0, firstNight - b.paid) : 0;
    const token = await login('frontdesk');
    const cancelBody = { reason: 'GUEST_REQUEST', isForceMajeure: false };
    const preview = await call(`/bookings/${b.id}/cancel-preview`, { token, method: 'POST', body: cancelBody });
    const pv = preview.body?.cancellation;
    check(`${label}: xem trước = bậc ${offset}h, hoàn ${pct}%, hoàn ${money(refundAmount)}, phạt ${money(penalty)}`,
      preview.status === 200 && pv?.refundPercent === pct && pv?.requestedAmount === refundAmount && pv?.penaltyAmount === penalty && pv?.paidAmount === b.paid,
      `HTTP ${preview.status} ${JSON.stringify(preview.body).slice(0, 220)}`);
    check(`${label}: hoursBeforeCheckIn = ${hours.toFixed(4)} (BR-CANCEL-03, từ 14:00 danh nghĩa)`,
      pv !== undefined && Math.abs(pv.hoursBeforeCheckIn - hours) < 0.02, `API=${pv?.hoursBeforeCheckIn}`);
    const etag = preview.headers.get('etag');
    check(`${label}: cancel-preview trả ETag neo xác nhận (api.md §3.3, HB-097)`, Boolean(etag), 'thiếu ETag');
    const res = await call(`/bookings/${b.id}/cancel`, { token, method: 'POST', body: cancelBody, headers: { 'If-Match': etag ?? '' } });
    check(`${label}: huỷ 200 CANCELLED, khớp xem trước`, res.status === 200 && res.body.status === 'CANCELLED' && res.body.cancellation?.requestedAmount === refundAmount && res.body.cancellation?.penaltyAmount === penalty, `HTTP ${res.status} ${JSON.stringify(res.body).slice(0, 220)}`);
    const row = await bookingRow(b.id);
    check(`${label}: paid_amount giữ nguyên ${money(b.paid)}, balance_due = phạt ${money(penalty)} (BR-PAY-02, không công nợ phần chưa thu)`,
      row.status === 'CANCELLED' && num(row.paid_amount) === b.paid && num(row.balance_due) === penalty, JSON.stringify(row));
    const active = await sql(`SELECT count(*)::int AS n FROM room_assignments a JOIN booking_rooms br ON br.id = a.booking_room_id WHERE br.booking_id = $1::uuid AND a.released_at IS NULL`, [b.id]);
    check(`${label}: mọi RoomAssignment đã nhả cùng giao dịch huỷ (BR-BOOK-11)`, active[0].n === 0, `còn ${active[0].n}`);
    const refunds = await refundRows(b.id);
    if (refundAmount > 0) {
      check(`${label}: có đúng 1 RefundRequest PENDING requested=${money(refundAmount)}, fee=0, net=${money(refundAmount)}`,
        refunds.length === 1 && refunds[0].status === 'PENDING' && num(refunds[0].requested_amount) === refundAmount && num(refunds[0].refund_fee) === 0 && num(refunds[0].net_refund) === refundAmount,
        JSON.stringify(refunds.map((r) => [r.status, r.requested_amount, r.refund_fee, r.net_refund])));
    } else {
      check(`${label}: netRefund = 0 ⇒ KHÔNG lập RefundRequest (BR-BOOK-14)`, refunds.length === 0 && res.body.refundRequest === null, `refunds=${refunds.length} body=${JSON.stringify(res.body.refundRequest)}`);
    }
    const pen = await sql(`SELECT type, status, amount FROM payments WHERE booking_id = $1::uuid AND type = 'PENALTY'`, [b.id]);
    if (penalty > 0) check(`${label}: Payment PENALTY PENDING = ${money(penalty)}, không tự thu (BR-CANCEL-06)`, pen.length === 1 && pen[0].status === 'PENDING' && num(pen[0].amount) === penalty, JSON.stringify(pen));
    else check(`${label}: không có PENALTY`, pen.length === 0, JSON.stringify(pen));
    const again = await call(`/bookings/${b.id}/cancel`, { token, method: 'POST', body: cancelBody, headers: { 'If-Match': etag ?? '' } });
    check(`${label}: huỷ lần hai bị chặn, không lập hoàn thứ hai`, again.status >= 400 && (await refundRows(b.id)).length === refunds.length, `HTTP ${again.status} ${errCode(again)}`);
  }
}
