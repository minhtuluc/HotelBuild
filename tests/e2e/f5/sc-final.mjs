/**
 * HB-117 §7/§8 — hoàn nhiều phương thức (TC-PAY-23, BR-PAY-08) và bất biến sổ tiền sau cả lượt chạy (BB-02, BB-10; TC-PAY-21; BR-PAY-04):
 * mọi số dư đối chiếu độc lập bằng SQL trên CSDL của lượt chạy, quét dữ liệu thẻ trên mọi phản hồi API đã thấy và trên lược đồ CSDL.
 */
import { randomUUID } from 'node:crypto';
import { addDays, bookingRow, call, check, ctx, errCode, finding, login, makeBooking, mintPin, money, num, refundRows, sql } from './qa-f5-ctx.mjs';
import { momoIpn, onlinePay } from './psp-qa.mjs';
import { cancelAs, decide, payout } from './sc-refund.mjs';
import { confirmBooking } from './sc-psp.mjs';

const D0 = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Ho_Chi_Minh' }).format(new Date());
const until = async (fn, ms = 20_000) => {
  const end = Date.now() + ms;
  for (;;) {
    const v = await fn();
    if (v || Date.now() > end) return v;
    await new Promise((r) => setTimeout(r, 700));
  }
};

export async function scenarioMultiMethod() {
  const from = addDays(D0, 260);
  const b = await makeBooking('MM-MOMO-CASH', { plan: 'FLEX7', type: 'STD', from, to: addDays(from, 3), pay: 'none' });
  const fd = await login('frontdesk');
  const init = await onlinePay(fd, { bookingId: b.id, method: 'MOMO', amount: b.deposit });
  const ipn = await momoIpn({ orderRef: init.orderRef, amount: b.deposit, txnId: `MM-${Date.now().toString(36)}` });
  const conf = await confirmBooking(fd, b, init.paymentId);
  const rest = b.total - b.deposit;
  const pin = await mintPin('frontdesk', b.id);
  const bal = await call('/payments', { token: fd, method: 'POST', body: { bookingId: b.id, type: 'BALANCE', method: 'CASH', amount: rest, pinToken: pin } });
  check(`MM: thu hai phương thức — cọc MoMo ${money(b.deposit)} (IPN 204, xác nhận 200) + số dư tiền mặt ${money(rest)} (201 SUCCEEDED)`, ipn.status === 204 && conf.status === 200 && bal.status === 201 && bal.body.status === 'SUCCEEDED', `ipn=${ipn.status} confirm=${conf.status} balance=${bal.status} ${JSON.stringify(bal.body)?.slice(0, 160)}`);
  const c = await cancelAs('frontdesk', b);
  const r = c.refund;
  check(`MM: huỷ ≥168h ⇒ hoàn 100% đã thu ${money(b.total)}`, c.res.status === 200 && num(r?.requested_amount) === b.total, `HTTP ${c.res.status} ${JSON.stringify(r)?.slice(0, 160)}`);
  const allocs = await sql(`SELECT a.amount, p.method FROM refund_allocations a JOIN payments p ON p.id = a.original_payment_id WHERE a.refund_request_id = $1::uuid ORDER BY a.amount`, [r.id]);
  check('MM: hoàn phân bổ về TỪNG khoản thu gốc (MoMo = cọc, tiền mặt = số dư), không dồn về một phương thức (BR-PAY-08)', allocs.length === 2 && allocs.some((a) => a.method === 'MOMO' && num(a.amount) === b.deposit) && allocs.some((a) => a.method === 'CASH' && num(a.amount) === rest), JSON.stringify(allocs));
  const ap = await decide('manager', 'approve', r.id, b.id);
  check('MM: duyệt theo TỔNG sự kiện (MANAGER khác người lập)', ap.status === 200, `HTTP ${ap.status} ${errCode(ap)}`);
  const noNote = await payout('accountant', r.id, b.id, { method: 'MOMO' });
  check('MM: có leg chuyển khoản mà thiếu ghi chú tài khoản ⇒ 400, không tạo chứng từ (BR-PAY-08)', noNote.status === 400 && num((await sql(`SELECT count(*)::int AS n FROM payments WHERE booking_id = $1::uuid AND type = 'REFUND'`, [b.id]))[0].n) === 0, `HTTP ${noNote.status} ${errCode(noNote)}`);
  const wrong = await payout('accountant', r.id, b.id, { method: 'VNPAY', bankNote: 'QA' });
  check('MM: khai phương thức không thuộc nguồn hoàn (VNPAY) ⇒ 400', wrong.status === 400, `HTTP ${wrong.status} ${errCode(wrong)}`);
  const ok = await payout('accountant', r.id, b.id, { method: 'MOMO', bankNote: 'TK QA 0123456789 — chủ TK Khách QA' });
  const ops = ok.body?.operations ?? [];
  check('MM: chi hợp lệ ⇒ 202, 2 operation đúng phương thức gốc (MOMO + BANK_TRANSFER), tổng = số hoàn', ok.status === 202 && ops.length === 2 && ops.some((o) => o.method === 'MOMO' && o.amount === b.deposit) && ops.some((o) => o.method === 'BANK_TRANSFER' && o.amount === rest), `HTTP ${ok.status} ${JSON.stringify(ok.body)?.slice(0, 280)}`);
  const momoDone = await until(async () => (await sql(`SELECT status FROM refund_payout_operations WHERE refund_request_id = $1::uuid AND method = 'MOMO'`, [r.id]))[0]?.status === 'SUCCEEDED');
  await new Promise((res) => setTimeout(res, 5000));
  const state = (await refundRows(b.id))[0];
  const row = await bookingRow(b.id);
  const rpay = await sql(`SELECT method, status, amount FROM payments WHERE booking_id = $1::uuid AND type = 'REFUND' ORDER BY method`, [b.id]);
  check('MM: leg MoMo chốt SUCCEEDED qua cổng mô phỏng; leg chuyển khoản tay chưa có bằng chứng ⇒ hồ sơ CHƯA PAID, refunded_amount = riêng phần MoMo (PAID chỉ khi mọi leg SUCCEEDED, BR-PAY-11)', momoDone && state.status === 'APPROVED' && num(row.refunded_amount) === b.deposit && rpay.find((p) => p.method === 'MOMO')?.status === 'SUCCEEDED' && rpay.find((p) => p.method === 'BANK_TRANSFER')?.status !== 'SUCCEEDED', JSON.stringify({ momoDone, state: state.status, refunded: row.refunded_amount, rpay }));
}

const luhn = (digits) => {
  let sum = 0;
  let flip = false;
  for (let i = digits.length - 1; i >= 0; i -= 1) {
    let d = Number(digits[i]);
    if (flip) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
    flip = !flip;
  }
  return sum % 10 === 0;
};
export async function scenarioInvariants() {
  // ---- I1…I5: sổ tiền khớp độc lập ----
  const bad = await sql(`
    SELECT b.id, b.code, b.paid_amount, b.refunded_amount, b.balance_due,
           coalesce(sum(p.amount) FILTER (WHERE p.status = 'SUCCEEDED' AND p.type NOT IN ('REFUND', 'COMPENSATION')), 0) AS collected,
           coalesce(-sum(p.amount) FILTER (WHERE p.status = 'SUCCEEDED' AND p.type = 'REFUND'), 0) AS refunded
      FROM bookings b LEFT JOIN payments p ON p.booking_id = b.id
     GROUP BY b.id`);
  const total = bad.length;
  const paidMismatch = bad.filter((r) => num(r.paid_amount) !== num(r.collected));
  const refundMismatch = bad.filter((r) => num(r.refunded_amount) !== num(r.refunded));
  const overRefund = bad.filter((r) => num(r.refunded_amount) > num(r.paid_amount));
  const negative = bad.filter((r) => num(r.balance_due) < 0);
  check(`INV-1: paid_amount = Σ thu SUCCEEDED (BR-PAY-02) trên cả ${total} booking của lượt chạy`, paidMismatch.length === 0, JSON.stringify(paidMismatch.slice(0, 3)));
  check('INV-2: refunded_amount = Σ |REFUND| SUCCEEDED và ≤ paid_amount (BR-PAY-07, BB-02)', refundMismatch.length === 0 && overRefund.length === 0, JSON.stringify([...refundMismatch, ...overRefund].slice(0, 3)));
  check('INV-3: balance_due không âm', negative.length === 0, JSON.stringify(negative.slice(0, 3)));
  const held = await sql(`
    SELECT b.id, b.code, b.paid_amount, coalesce(sum(r.net_refund) FILTER (WHERE r.status IN ('PENDING', 'APPROVED', 'PAID')), 0) AS held
      FROM bookings b LEFT JOIN refund_requests r ON r.booking_id = b.id GROUP BY b.id HAVING coalesce(sum(r.net_refund) FILTER (WHERE r.status IN ('PENDING', 'APPROVED', 'PAID')), 0) > b.paid_amount`);
  check('INV-4: tổng net_refund của hồ sơ còn hiệu lực (PENDING/APPROVED/PAID) ≤ tiền đã thu của booking (BR-CANCEL-17, BB-10)', held.length === 0, JSON.stringify(held.slice(0, 3)));
  const dupTxn = await sql(`SELECT method, provider_txn_id, count(*)::int AS n FROM payments WHERE provider_txn_id IS NOT NULL GROUP BY 1, 2 HAVING count(*) > 1`);
  check('INV-5: một providerTxnId PSP chỉ gắn một Payment (BR-PAY-03, BB-10)', dupTxn.length === 0, JSON.stringify(dupTxn));
  const reversed = await sql(`SELECT count(*)::int AS n FROM payments WHERE type = 'REFUND' AND amount >= 0`);
  const nonRefundNeg = await sql(`SELECT count(*)::int AS n FROM payments WHERE type <> 'REFUND' AND amount <= 0`);
  check('INV-6: Payment REFUND luôn là bút toán đảo (amount < 0), khoản thu luôn dương (BR-PAY-09)', reversed[0].n === 0 && nonRefundNeg[0].n === 0, JSON.stringify({ reversed, nonRefundNeg }));
  const unsettled = await sql(`SELECT r.id FROM refund_requests r WHERE r.status = 'PAID' AND EXISTS (SELECT 1 FROM refund_allocations a LEFT JOIN payments p ON p.id = a.refund_payment_id WHERE a.refund_request_id = r.id AND (p.id IS NULL OR p.status <> 'SUCCEEDED'))`);
  check('INV-7: hồ sơ PAID thì MỌI phân bổ có Payment REFUND SUCCEEDED (PAID chỉ khi có bằng chứng PSP)', unsettled.length === 0, JSON.stringify(unsettled));
  const noAudit = await sql(`SELECT r.id FROM refund_requests r WHERE r.status <> 'PENDING' AND NOT EXISTS (SELECT 1 FROM audit_logs a WHERE a.entity_id = r.id)`);
  check('INV-8: mọi hồ sơ hoàn đã đổi trạng thái đều có AuditLog (BR-CANCEL-16)', noAudit.length === 0, JSON.stringify(noAudit.slice(0, 3)));

  // ---- TC-PAY-21: trần hoàn luỹ kế ép ở tầng CSDL ----
  const full = await sql(`SELECT p.id, p.booking_id FROM payments p JOIN bookings b ON b.id = p.booking_id WHERE p.type = 'REFUND' AND p.status = 'SUCCEEDED' AND b.refunded_amount = b.paid_amount LIMIT 1`);
  if (full.length === 0) check('TC-PAY-21: có booking đã hoàn đủ để thử trần ở CSDL', false, 'không có booking hoàn đủ trong lượt chạy');
  else {
    const before = (await sql(`SELECT count(*)::int AS n FROM payments WHERE booking_id = $1::uuid AND type = 'REFUND'`, [full[0].booking_id]))[0].n;
    let rejected = null;
    try {
      await sql(`INSERT INTO payments (id, booking_id, type, method, amount, status, provider_txn_id, idempotency_key, paid_at, created_by, note, created_at, updated_at)
                 SELECT gen_random_uuid(), booking_id, type, method, -1000, 'SUCCEEDED', NULL, 'qa-tc-pay-21-' || gen_random_uuid()::text, paid_at, created_by, 'QA TC-PAY-21', now(), now()
                   FROM payments WHERE id = $1::uuid`, [full[0].id]);
    } catch (error) {
      rejected = error instanceof Error ? error.message : String(error);
    }
    const after = (await sql(`SELECT count(*)::int AS n FROM payments WHERE booking_id = $1::uuid AND type = 'REFUND'`, [full[0].booking_id]))[0].n;
    check('TC-PAY-21: chèn thẳng bằng SQL một Payment REFUND vượt tiền đã thu của booking đã hoàn đủ ⇒ CSDL từ chối (BR-CANCEL-17, BR-PAY-07)', rejected !== null && after === before, `rejected=${rejected} refunds trước/sau=${before}/${after}`);
    if (rejected === null) {
      const triggers = await sql(`SELECT tgname FROM pg_trigger WHERE tgrelid = 'payments'::regclass AND NOT tgisinternal ORDER BY 1`);
      const [totals] = await sql(`SELECT b.paid_amount, coalesce(-sum(p.amount) FILTER (WHERE p.type = 'REFUND'), 0) AS refund_sum FROM bookings b JOIN payments p ON p.booking_id = b.id WHERE b.id = $1::uuid GROUP BY b.id`, [full[0].booking_id]);
      finding('F5-QA-05', 'Trần hoàn luỹ kế KHÔNG được ép ở tầng CSDL cho bảng `payments`: INSERT thẳng một Payment REFUND vượt `paid_amount` được chấp nhận (TC-PAY-21 yêu cầu CSDL từ chối). Chỉ có hàng rào ở `refund_allocations` (không vượt khoản thu gốc/net_refund) và ở ứng dụng.',
        `Booking đã hoàn đủ (refunded=paid): INSERT Payment REFUND −1.000 SUCCEEDED → thành công; tổng REFUND ${totals?.refund_sum} > paid_amount ${totals?.paid_amount}. Trigger trên payments: ${triggers.map((t) => t.tgname).join(', ')} (ck_payments_sign chỉ kiểm dấu; fn_guard_payment_identity chỉ chặn sửa). Kiểm cuối ở INV-2 đã chạy TRƯỚC bước chèn này.`);
    }
  }

  // ---- BR-PAY-04: không dữ liệu thẻ ----
  const cols = await sql(`SELECT table_name, column_name FROM information_schema.columns WHERE table_schema = 'public' AND column_name ~* '(card|cvv|cvc|pan_|_pan|^pan$|expiry|exp_date|cardholder)'`);
  check('PAN-1: lược đồ CSDL không có cột thẻ/CVV/hết hạn thẻ (BR-PAY-04, NFR-SEC-02)', cols.length === 0, JSON.stringify(cols));
  let keyHits = [];
  let panHits = [];
  let scanned = 0;
  for (const item of ctx.seen) {
    scanned += 1;
    let body = item.body;
    if (typeof body === 'string') {
      try {
        body = JSON.parse(body);
      } catch {
        /* thân không phải JSON */
      }
    }
    // Bỏ tham số thời gian VNPay (yyyyMMddHHmmss, 14 chữ số) — dễ trùng Luhn ngẫu nhiên nhưng không phải số thẻ.
    const text = (typeof item.body === 'string' ? item.body : JSON.stringify(item.body ?? '')).replace(/vnp_(?:Create|Expire|Pay)Date=\d+/g, '');
    for (const m of text.matchAll(/\b\d{13,19}\b/g)) if (luhn(m[0])) panHits.push(`${item.path}: ${m[0].slice(0, 4)}…`);
    const stack = [body];
    while (stack.length) {
      const cur = stack.pop();
      if (cur && typeof cur === 'object')
        for (const [k, v] of Object.entries(cur)) {
          if (/(card|cvv|cvc|^pan$|expir(y|ation)Date|cardholder)/i.test(k)) keyHits.push(`${item.path}: ${k}`);
          stack.push(v);
        }
    }
  }
  check(`PAN-2: ${scanned} phản hồi API (kể cả IPN/payments/refunds) không có khoá thẻ/CVV/hết hạn thẻ`, keyHits.length === 0, JSON.stringify(keyHits.slice(0, 5)));
  check('PAN-3: không có chuỗi 13–19 chữ số hợp lệ Luhn (số thẻ) trong phản hồi API', panHits.length === 0, JSON.stringify(panHits.slice(0, 5)));
}
