/**
 * HB-117 §2 — callback PSP trên API thật (TC-PAY-22; BR-PAY-03, BR-PAY-04, BR-PAY-05, BR-PAY-11; api.md §5.2): chữ ký/merchant/số tiền,
 * trùng lặp, thành công sau thất bại, thành công muộn sau khi huỷ/hết hạn. IPN do QA ký bằng bộ ký tự dựng (`psp-qa.mjs`).
 */
import {
  addDays, bookingRow, call, check, ctx, errCode, finding, login, makeBooking, money, num, refundRows, sql, realClock,
} from './qa-f5-ctx.mjs';
import { momoIpn, onlinePay, vnpayIpn } from './psp-qa.mjs';

const D0 = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Ho_Chi_Minh' }).format(new Date());
let n = 0;
const txn = (p) => `${p}${Date.now().toString(36)}${(n += 1)}`;
const paymentsOf = (bookingId) =>
  sql('SELECT id, type, method, amount, status, provider_txn_id FROM payments WHERE booking_id = $1::uuid ORDER BY created_at', [bookingId]);

/** Booking chưa thu đồng nào (HELD/PENDING_PAYMENT), kỳ ở xa để không đụng các ca khác. */
async function unpaid(label, { plan = 'FLEX7', type = 'STD', offset = 0 } = {}) {
  const from = addDays(D0, 80 + (n += 1) + offset);
  return makeBooking(label, { plan, type, from, to: addDays(from, 3), pay: 'none' });
}

/** Xác nhận booking bằng khoản thu đã ghi (BR-BOOK-09) — use case riêng, webhook KHÔNG tự xác nhận (apply.ts). */
export async function confirmBooking(token, b, paymentId) {
  return call(`/bookings/${b.id}/confirm`, { token, method: 'POST', body: { paymentId } });
}

export async function approvedByPsp(label, method = 'VNPAY', { type = 'STD', offset = 0 } = {}) {
  const b = await unpaid(label, { type, offset });
  const token = await login('frontdesk');
  const { res, orderRef } = await onlinePay(token, { bookingId: b.id, method, amount: b.deposit });
  if (res.status !== 201 || !orderRef) throw new Error(`khởi tạo ${method} ${label} → ${res.status} ${JSON.stringify(res.body)}`);
  const ipn = method === 'VNPAY' ? vnpayIpn : momoIpn;
  const out = await ipn({ orderRef, amount: b.deposit, txnId: txn(`${method}-`) });
  if (method === 'VNPAY' ? out.body?.RspCode !== '00' : out.status !== 204) throw new Error(`IPN ${method} ${label} → ${out.status} ${JSON.stringify(out.body)}`);
  b.paid = b.deposit;
  b.paymentId = res.body.paymentId;
  b.orderRef = orderRef;
  const confirmed = await confirmBooking(token, b, b.paymentId);
  if (confirmed.status !== 200 || confirmed.body.status !== 'CONFIRMED') throw new Error(`xác nhận ${label} → ${confirmed.status} ${JSON.stringify(confirmed.body)}`);
  return b;
}

export async function scenarioPsp(section) {
  // ---- VNPay: đường đúng + mọi nhánh xác thực ----
  const v = await unpaid('PSP-VNPAY');
  const token = await login('frontdesk');
  const init = await onlinePay(token, { bookingId: v.id, method: 'VNPAY', amount: v.deposit });
  check('PSP-VNPAY: khởi tạo thanh toán trực tuyến 201 PENDING có paymentUrl, chưa có providerTxnId', init.res.status === 201 && init.res.body.status === 'PENDING' && init.res.body.providerTxnId === null && Boolean(init.orderRef), `HTTP ${init.res.status} ${JSON.stringify(init.res.body).slice(0, 200)}`);
  const wrongAmount = await call('/payments/online', { token, method: 'POST', body: { bookingId: v.id, type: 'DEPOSIT', method: 'VNPAY', amount: v.deposit + 1000, returnUrl: 'https://example.test/x' } });
  check('PSP-VNPAY: khởi tạo sai số tiền ⇒ 422 E_PAY_AMOUNT_MISMATCH (BR-PAY-01)', wrongAmount.status === 422 && errCode(wrongAmount) === 'E_PAY_AMOUNT_MISMATCH', `HTTP ${wrongAmount.status} ${errCode(wrongAmount)}`);
  const ref = init.orderRef;
  const unchanged = async (what) => {
    const [pay] = await paymentsOf(v.id);
    const row = await bookingRow(v.id);
    check(`PSP-VNPAY: ${what} ⇒ Payment vẫn PENDING, paid_amount = 0, booking chưa CONFIRMED`, pay?.status === 'PENDING' && num(row.paid_amount) === 0 && row.status !== 'CONFIRMED', JSON.stringify({ pay, row }));
  };
  const badSig = await vnpayIpn({ orderRef: ref, amount: v.deposit, txnId: txn('V-'), tamper: { vnp_Amount: String(BigInt(v.deposit + 1000) * 100n) } });
  check('PSP-VNPAY: chữ ký sai (đổi số tiền sau khi ký) ⇒ RspCode 97', badSig.body?.RspCode === '97', JSON.stringify(badSig));
  await unchanged('chữ ký sai');
  const badMerchant = await vnpayIpn({ orderRef: ref, amount: v.deposit, txnId: txn('V-'), tmn: 'OTHERMERCHANT' });
  check('PSP-VNPAY: sai merchant (chữ ký hợp lệ với khoá đúng) ⇒ không ghi tiền (RspCode ≠ 00)', badMerchant.body?.RspCode !== '00' && badMerchant.body?.RspCode !== '02', JSON.stringify(badMerchant));
  await unchanged('sai merchant');
  const badSecret = await vnpayIpn({ orderRef: ref, amount: v.deposit, txnId: txn('V-'), secret: 'khoa-gia-mao' });
  check('PSP-VNPAY: ký bằng khoá giả ⇒ RspCode 97', badSecret.body?.RspCode === '97', JSON.stringify(badSecret));
  const mismatch = await vnpayIpn({ orderRef: ref, amount: v.deposit + 1000, txnId: txn('V-') });
  check('PSP-VNPAY: chữ ký đúng nhưng số tiền lệch payment ⇒ RspCode 04, không ghi thu (BR-PAY-01/02)', mismatch.body?.RspCode === '04', JSON.stringify(mismatch));
  await unchanged('sai số tiền');
  const unknown = await vnpayIpn({ orderRef: 'KHONG-TON-TAI-1', amount: v.deposit, txnId: txn('V-') });
  check('PSP-VNPAY: mã đơn không tồn tại ⇒ RspCode 01', unknown.body?.RspCode === '01', JSON.stringify(unknown));
  const t1 = txn('V-OK-');
  const ok = await vnpayIpn({ orderRef: ref, amount: v.deposit, txnId: t1 });
  check('PSP-VNPAY: callback hợp lệ ⇒ RspCode 00', ok.body?.RspCode === '00', JSON.stringify(ok));
  let pays = await paymentsOf(v.id);
  let row = await bookingRow(v.id);
  check(`PSP-VNPAY: Payment SUCCEEDED ${money(v.deposit)} có providerTxnId, paid_amount = cọc; booking vẫn PENDING_PAYMENT (webhook chỉ ghi tiền, không xác nhận — apply.ts)`, pays.length === 1 && pays[0].status === 'SUCCEEDED' && num(pays[0].amount) === v.deposit && pays[0].provider_txn_id === t1 && row.status === 'PENDING_PAYMENT' && num(row.paid_amount) === v.deposit, JSON.stringify({ pays, row }));
  const conf = await confirmBooking(token, v, pays[0].id);
  check('PSP-VNPAY: POST /bookings/{id}/confirm bằng paymentId đã SUCCEEDED ⇒ 200 CONFIRMED (BR-BOOK-09)', conf.status === 200 && conf.body.status === 'CONFIRMED', `HTTP ${conf.status} ${JSON.stringify(conf.body).slice(0, 200)}`);
  const replay = await vnpayIpn({ orderRef: ref, amount: v.deposit, txnId: t1 });
  check('PSP-VNPAY: callback lặp cùng providerTxnId ⇒ ACK (RspCode 02 đã xử lý), không 409 (api.md §5.2)', replay.status === 200 && replay.body?.RspCode === '02', JSON.stringify(replay));
  const replay2 = await vnpayIpn({ orderRef: ref, amount: v.deposit, txnId: t1, overrides: { vnp_BankCode: 'VCB' }, at: Date.now() + 5000 });
  pays = await paymentsOf(v.id);
  row = await bookingRow(v.id);
  check('PSP-VNPAY: phát lại cùng providerTxnId khác payload (BankCode/PayDate) vẫn không tạo Payment thứ hai và không cộng dồn paid_amount (BR-PAY-03)', pays.length === 1 && num(row.paid_amount) === v.deposit, `${JSON.stringify(replay2)} payments=${pays.length} paid=${row.paid_amount}`);
  const lateFail = await vnpayIpn({ orderRef: ref, amount: v.deposit, txnId: txn('V-F-'), outcome: 'FAILED' });
  pays = await paymentsOf(v.id);
  check('PSP-VNPAY: callback FAILED đến sau SUCCEEDED không làm lùi trạng thái (BR-PAY-09, api.md §5.2 "SUCCEEDED không lùi")', pays[0].status === 'SUCCEEDED' && num((await bookingRow(v.id)).paid_amount) === v.deposit, JSON.stringify({ lateFail, pays }));
  const status = await call(`/payments/${pays[0].id}/status`, { token });
  check('PSP-VNPAY: GET /payments/{id}/status đọc lại SUCCEEDED từ server (client không tự đánh dấu đã trả)', status.status === 200 && status.body.status === 'SUCCEEDED', `HTTP ${status.status} ${JSON.stringify(status.body)}`);

  // ---- MoMo ----
  const m = await unpaid('PSP-MOMO', { offset: 3 });
  const mi = await onlinePay(token, { bookingId: m.id, method: 'MOMO', amount: m.deposit });
  check('PSP-MOMO: khởi tạo 201 PENDING', mi.res.status === 201 && mi.res.body.status === 'PENDING' && Boolean(mi.orderRef), `HTTP ${mi.res.status} ${JSON.stringify(mi.res.body).slice(0, 200)}`);
  const mBad = await momoIpn({ orderRef: mi.orderRef, amount: m.deposit, txnId: txn('M-'), tamper: { amount: String(m.deposit + 1000) } });
  check('PSP-MOMO: chữ ký sai ⇒ từ chối (không 2xx) và không ghi thu', mBad.status >= 400 && num((await bookingRow(m.id)).paid_amount) === 0, JSON.stringify(mBad));
  const mWrongPartner = await momoIpn({ orderRef: mi.orderRef, amount: m.deposit, txnId: txn('M-'), partner: 'OTHERPARTNER' });
  check('PSP-MOMO: sai partnerCode ⇒ không ghi thu', mWrongPartner.status !== 204 && num((await bookingRow(m.id)).paid_amount) === 0, JSON.stringify(mWrongPartner));
  const mMismatch = await momoIpn({ orderRef: mi.orderRef, amount: m.deposit + 1000, txnId: txn('M-') });
  check('PSP-MOMO: chữ ký đúng nhưng lệch số tiền ⇒ không ghi thu', mMismatch.status !== 204 && num((await bookingRow(m.id)).paid_amount) === 0, JSON.stringify(mMismatch));
  const mt = txn('M-OK-');
  const mOk = await momoIpn({ orderRef: mi.orderRef, amount: m.deposit, txnId: mt });
  check('PSP-MOMO: IPN hợp lệ ⇒ HTTP 204 thân rỗng (api.md §5.2)', mOk.status === 204 && mOk.body === '', JSON.stringify(mOk));
  const mRe = await momoIpn({ orderRef: mi.orderRef, amount: m.deposit, txnId: mt });
  const mp = await paymentsOf(m.id);
  const mr = await bookingRow(m.id);
  check('PSP-MOMO: IPN lặp ⇒ 204, đúng 1 Payment SUCCEEDED, paid_amount = cọc (booking chờ xác nhận)', mRe.status === 204 && mp.length === 1 && mp[0].status === 'SUCCEEDED' && num(mr.paid_amount) === m.deposit && mr.status === 'PENDING_PAYMENT', JSON.stringify({ mRe, mp, mr }));

  // ---- thành công sau thất bại (BR-PAY-11) ----
  const f = await unpaid('PSP-FAIL-THEN-OK', { offset: 6 });
  const fi = await onlinePay(token, { bookingId: f.id, method: 'VNPAY', amount: f.deposit });
  await vnpayIpn({ orderRef: fi.orderRef, amount: f.deposit, txnId: txn('V-X-'), outcome: 'FAILED' });
  let fp = await paymentsOf(f.id);
  check('PSP-FAIL-THEN-OK: callback thất bại ⇒ Payment FAILED, booking chưa CONFIRMED', fp.length === 1 && fp[0].status === 'FAILED' && (await bookingRow(f.id)).status !== 'CONFIRMED', JSON.stringify(fp));
  const t2 = txn('V-Y-');
  const second = await vnpayIpn({ orderRef: fi.orderRef, amount: f.deposit, txnId: t2 });
  fp = await paymentsOf(f.id);
  const fr = await bookingRow(f.id);
  check('PSP-FAIL-THEN-OK: thành công đến sau thất bại (hold còn hạn) ⇒ cùng Payment chuyển SUCCEEDED, tiền cộng đúng một lần, booking còn chờ xác nhận (BR-PAY-11)', second.body?.RspCode === '00' && fp.length === 1 && fp[0].status === 'SUCCEEDED' && num(fr.paid_amount) === f.deposit && fr.status === 'PENDING_PAYMENT', JSON.stringify({ second, fp, fr }));

  // ---- thành công muộn sau khi booking đã huỷ ----
  const c = await unpaid('PSP-LATE-CANCELLED', { offset: 9 });
  const ci = await onlinePay(token, { bookingId: c.id, method: 'VNPAY', amount: c.deposit });
  const pv = await call(`/bookings/${c.id}/cancel-preview`, { token, method: 'POST', body: { reason: 'GUEST_REQUEST', isForceMajeure: false } });
  const cx = await call(`/bookings/${c.id}/cancel`, { token, method: 'POST', body: { reason: 'GUEST_REQUEST', isForceMajeure: false }, headers: { 'If-Match': pv.headers.get('etag') ?? '' } });
  check('PSP-LATE-CANCELLED: huỷ booking chưa thu tiền ⇒ CANCELLED, không lập hoàn (BR-BOOK-18)', cx.status === 200 && cx.body.status === 'CANCELLED' && (await refundRows(c.id)).length === 0, `HTTP ${cx.status} ${JSON.stringify(cx.body).slice(0, 200)}`);
  const lt = txn('V-LATE-');
  const late = await vnpayIpn({ orderRef: ci.orderRef, amount: c.deposit, txnId: lt });
  const cp = await paymentsOf(c.id);
  const cr = await bookingRow(c.id);
  const crefs = await refundRows(c.id);
  check('PSP-LATE-CANCELLED: tiền đến muộn được ACK (RspCode 00/02) và ghi đúng một lần', ['00', '02'].includes(late.body?.RspCode) && cp.length === 1 && cp[0].status === 'SUCCEEDED' && num(cp[0].amount) === c.deposit, JSON.stringify({ late, cp }));
  check('PSP-LATE-CANCELLED: booking KHÔNG hồi sinh (vẫn CANCELLED), không tái chiếm phòng (BR-PAY-11)', cr.status === 'CANCELLED' && num((await sql(`SELECT count(*)::int AS n FROM room_assignments a JOIN booking_rooms br ON br.id = a.booking_room_id WHERE br.booking_id = $1::uuid AND a.released_at IS NULL`, [c.id]))[0].n) === 0, JSON.stringify(cr));
  check(`PSP-LATE-CANCELLED: lập hoàn 100% riêng khoản muộn ${money(c.deposit)}, phí 0, lý do PAYMENT_TIMEOUT/SYSTEM (BR-PAY-11)`,
    crefs.length === 1 && num(crefs[0].requested_amount) === c.deposit && num(crefs[0].refund_fee) === 0 && num(crefs[0].refund_percent) === 100 && ['PAYMENT_TIMEOUT', 'SYSTEM'].includes(crefs[0].reason) && crefs[0].status === 'PENDING',
    JSON.stringify(crefs.map((r) => [r.status, r.requested_amount, r.refund_fee, r.refund_percent, r.reason, r.requested_by])));
  await vnpayIpn({ orderRef: ci.orderRef, amount: c.deposit, txnId: lt });
  check('PSP-LATE-CANCELLED: phát lại callback muộn không lập hoàn thứ hai, không cộng thêm tiền', (await refundRows(c.id)).length === 1 && (await paymentsOf(c.id)).length === 1, `refunds=${(await refundRows(c.id)).length}`);
}

/**
 * Tiền PSP đã ghi nhưng booking chưa được xác nhận rồi hold hết hạn (BR-BOOK-09 ↔ BR-PAY-11): webhook không xác nhận, job
 * `q.hold-expiry` không xét `paid_amount`. Điều kiện đầu (SQL, ghi rõ trong bằng chứng): lùi `hold_expires_at` về quá khứ giờ CSDL.
 */
export async function scenarioPaidThenExpires() {
  const b = await unpaid('PSP-PAID-THEN-EXPIRES', { offset: 12 });
  const token = await login('frontdesk');
  const init = await onlinePay(token, { bookingId: b.id, method: 'VNPAY', amount: b.deposit });
  const ok = await vnpayIpn({ orderRef: init.orderRef, amount: b.deposit, txnId: txn('V-EXP-') });
  check('PSP-PAID-THEN-EXPIRES: tiền cọc đã ghi (RspCode 00) khi booking còn chờ', ok.body?.RspCode === '00' && num((await bookingRow(b.id)).paid_amount) === b.deposit, JSON.stringify(ok));
  await sql(`UPDATE bookings SET hold_expires_at = clock_timestamp() - interval '1 minute' WHERE id = $1::uuid`, [b.id]);
  let row = await bookingRow(b.id);
  for (let i = 0; i < 12 && row.status !== 'EXPIRED'; i += 1) {
    await new Promise((r) => setTimeout(r, 1500));
    row = await bookingRow(b.id);
  }
  const refunds = await refundRows(b.id);
  const bad = row.status === 'EXPIRED' && num(row.paid_amount) > 0 && refunds.length === 0;
  if (bad)
    finding('F5-QA-01', 'Booking PENDING_PAYMENT đã nhận đủ cọc qua PSP nhưng chưa được xác nhận, khi hold hết hạn job `q.hold-expiry` chuyển EXPIRED mà KHÔNG lập yêu cầu hoàn: khoản cọc đã thu nằm lại sổ không có nghĩa vụ hoàn hay booking.',
      `Sau callback VNPay 00 (paid_amount=${b.deposit}) rồi hold_expires_at lùi quá khứ: bookings.status=${row.status}, paid_amount=${row.paid_amount}, refund_requests=${refunds.length}. Webhook chỉ ghi tiền (apply.ts); xác nhận phụ thuộc client gọi POST /bookings/{id}/confirm.`);
  else check('PSP-PAID-THEN-EXPIRES: booking có tiền khi hết hạn không bị bỏ rơi (xác nhận hoặc lập hoàn)', row.status === 'CONFIRMED' || refunds.length > 0, JSON.stringify({ row, refunds: refunds.length }));
}
