/**
 * HB-117 §3 — hoàn tiền trên API thật + worker thật: maker–checker (BR-CANCEL-15), ngưỡng 5.000.000 trên netRefund, từ chối/rút
 * giải phóng hạn mức (BR-CANCEL-17/18), yêu cầu cạnh tranh, chi hoàn qua `POST /refund-requests/{id}/pay` (HB-100/HB-110):
 * PAID chỉ khi có bằng chứng PSP, không chi lần hai, hoàn về phương thức gốc (BR-PAY-08/09), tổng hoàn ≤ đã thu (BR-PAY-07).
 */
import { randomUUID } from 'node:crypto';
import {
  addDays, bookingRow, call, check, clockAt, errCode, finding, login, makeBooking, mintPin, money, num, realClock, refundRows, sql, vn,
} from './qa-f5-ctx.mjs';
import { approvedByPsp } from './sc-psp.mjs';

const D0 = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Ho_Chi_Minh' }).format(new Date());
let k = 0;
const far = () => addDays(D0, 100 + (k += 4));

/** Huỷ booking (xem trước lấy ETag rồi xác nhận). Trả `{ res, refund }` với `refund` = bản ghi `refund_requests` mới nhất. */
export async function cancelAs(role, b, { reason = 'GUEST_REQUEST', force = false, note, evidenceRefs, at } = {}) {
  if (at === undefined) await realClock();
  else await clockAt(at);
  const token = await login(role);
  const body = { reason, isForceMajeure: force, ...(note ? { note } : {}), ...(evidenceRefs ? { evidenceRefs } : {}) };
  const preview = await call(`/bookings/${b.id}/cancel-preview`, { token, method: 'POST', body: { reason, isForceMajeure: force } });
  const res = await call(`/bookings/${b.id}/cancel`, { token, method: 'POST', body, headers: { 'If-Match': preview.headers.get('etag') ?? '' } });
  const refunds = await refundRows(b.id);
  return { res, refund: refunds[refunds.length - 1] ?? null, refunds };
}

export async function decide(role, kind, refundId, bookingId, extra = {}) {
  const token = await login(role);
  const pinToken = await mintPin(role, bookingId);
  const requested = num((await sql('SELECT requested_amount FROM refund_requests WHERE id = $1::uuid', [refundId]))[0]?.requested_amount);
  const body = kind === 'approve' ? { approvedAmount: extra.approvedAmount ?? requested, note: extra.note ?? 'QA F5', pinToken } : { note: extra.note ?? 'QA F5 từ chối', pinToken };
  return call(`/refund-requests/${refundId}/${kind}`, { token, method: 'POST', body });
}

export async function payout(role, refundId, bookingId, { method, bankNote, withPin = true, key, pinToken: given } = {}) {
  const token = await login(role);
  const pinToken = given ?? (withPin ? await mintPin(role, bookingId) : undefined);
  return call(`/refund-requests/${refundId}/pay`, { token, method: 'POST', body: { method, ...(bankNote ? { bankNote } : {}), ...(pinToken ? { pinToken } : {}) }, ...(key ? { key } : {}) });
}

const refundPayments = (bookingId) => sql(`SELECT id, status, method, amount, provider_txn_id FROM payments WHERE booking_id = $1::uuid AND type = 'REFUND' ORDER BY created_at`, [bookingId]);
const reserved = async (bookingId) => num((await call(`/bookings/${bookingId}/balance`, { token: await login('owner') })).body?.reservedRefundAmount);

async function until(fn, ms = 20_000) {
  const end = Date.now() + ms;
  for (;;) {
    const value = await fn();
    if (value || Date.now() > end) return value;
    await new Promise((r) => setTimeout(r, 700));
  }
}

export async function scenarioRefundControls() {
  // ---- maker–checker ----
  const from = far();
  const b1 = await makeBooking('RF-MAKER', { plan: 'FLEX7', type: 'STD', from, to: addDays(from, 3) });
  const c1 = await cancelAs('frontdesk', b1);
  const r1 = c1.refund;
  check(`RF-MAKER: huỷ ≥168h ⇒ RefundRequest PENDING ${money(b1.paid)} do FRONT_DESK lập`, c1.res.status === 200 && r1?.status === 'PENDING' && num(r1.requested_amount) === b1.paid, `HTTP ${c1.res.status} ${JSON.stringify(r1)?.slice(0, 200)}`);
  const list = await call(`/refund-requests?bookingId=${b1.id}`, { token: await login('manager') });
  if (list.status === 404 || list.status === 405)
    finding('F5-QA-03', '`GET /api/v1/refund-requests` (api.md §2.6: danh sách hồ sơ, số đã giữ/chi, tuổi, version — nguồn dữ liệu của SCR-38) KHÔNG tồn tại trên API thật ⇒ màn duyệt/chi hoàn (HB-110) không thể liệt kê hồ sơ hay hiện cờ kiểm soát ngưỡng; chỉ chạy được trên API giả E2E.',
      `GET /refund-requests?bookingId=… → HTTP ${list.status} ${errCode(list) ?? ''}; refunds/controller.ts và payouts/controller.ts chỉ có POST (tạo, approve, reject, cancel, pay); contracts có refundListQuerySchema nhưng không có route.`);
  else check('RF-MAKER: GET /refund-requests liệt kê hồ sơ có netRefund và cờ ngưỡng', list.status === 200 && list.body?.data?.[0]?.netRefund === b1.paid, `HTTP ${list.status}`);
  check('RF-MAKER: net_refund trong CSDL = requested − phí (phí 0) và dưới ngưỡng 5.000.000 (deal.threshold.minor)', num(r1.net_refund) === b1.paid && b1.paid < 5_000_000, JSON.stringify(r1));
  const oosPin = await call('/auth/pin/verify', { token: await login('accountant'), method: 'POST', body: { pin: '123456', bookingId: b1.id }, key: null });
  check('RF-SCOPE: ACCOUNTANT (phạm vi CS-03) thao tác booking của CS-01 ⇒ 403 E_AUTH_OUT_OF_SCOPE (BR-RBAC-02)', oosPin.status === 403 && errCode(oosPin) === 'E_AUTH_OUT_OF_SCOPE', `HTTP ${oosPin.status} ${errCode(oosPin)}`);
  // Điều kiện đầu có ghi chú: cấp thêm CS-01 cho kế toán dev (vận hành thật dùng PUT /users/{id}/access — HB-016 chưa có).
  await sql(`INSERT INTO user_property_scopes (user_id, property_id) SELECT u.id, p.id FROM users u, properties p WHERE u.username = 'accountant' AND p.code = 'CS-01' ON CONFLICT DO NOTHING`);
  await login('accountant');
  const fd = await decide('frontdesk', 'approve', r1.id, b1.id);
  check('RF-MAKER: FRONT_DESK (người lập) tự duyệt ⇒ 403, hồ sơ vẫn PENDING', fd.status === 403 && (await refundRows(b1.id))[0].status === 'PENDING', `HTTP ${fd.status} ${errCode(fd)}`);
  const ac = await decide('accountant', 'approve', r1.id, b1.id);
  check('RF-MAKER: ACCOUNTANT không có quyền duyệt (BR-CANCEL-15) ⇒ 403', ac.status === 403 && (await refundRows(b1.id))[0].status === 'PENDING', `HTTP ${ac.status} ${errCode(ac)}`);
  const over = await decide('manager', 'approve', r1.id, b1.id, { approvedAmount: b1.paid + 1000 });
  check('RF-MAKER: duyệt vượt số yêu cầu ⇒ bị từ chối (0 ≤ approved ≤ requested, BR-CANCEL-05), hồ sơ vẫn PENDING', over.status >= 400 && (await refundRows(b1.id))[0].status === 'PENDING', `HTTP ${over.status} ${errCode(over)}`);
  const noPin = await call(`/refund-requests/${r1.id}/approve`, { token: await login('manager'), method: 'POST', body: { approvedAmount: b1.paid, note: 'không PIN' } });
  check('RF-MAKER: duyệt thiếu pinToken ⇒ 401 E_AUTH_PIN_REQUIRED (BR-RBAC-05)', noPin.status === 401 && errCode(noPin) === 'E_AUTH_PIN_REQUIRED', `HTTP ${noPin.status} ${errCode(noPin)}`);
  const ok = await decide('manager', 'approve', r1.id, b1.id);
  const row1 = (await refundRows(b1.id))[0];
  check('RF-MAKER: MANAGER khác người lập duyệt ⇒ 200 APPROVED, approved_by ≠ requested_by, có decided_at', ok.status === 200 && row1.status === 'APPROVED' && row1.approved_by && row1.approved_by !== row1.requested_by && row1.decided_at, `HTTP ${ok.status} ${JSON.stringify(ok.body)?.slice(0, 200)}`);
  const audit = await sql(`SELECT action FROM audit_logs WHERE entity_id = $1::uuid ORDER BY created_at`, [r1.id]);
  check('RF-MAKER: nhật ký có bước duyệt (BR-CANCEL-16)', audit.some((a) => /APPROV/i.test(a.action)), JSON.stringify(audit));
  const again = await decide('owner', 'approve', r1.id, b1.id);
  check('RF-MAKER: duyệt lần hai ⇒ 409 E_PAY_REFUND_NOT_PENDING', again.status === 409 && errCode(again) === 'E_PAY_REFUND_NOT_PENDING', `HTTP ${again.status} ${errCode(again)}`);

  // ---- tự duyệt bởi người lập là MANAGER/OWNER ----
  const s = far();
  const b2 = await makeBooking('RF-SELF-MGR', { plan: 'FLEX7', type: 'STD', from: s, to: addDays(s, 3) });
  const c2 = await cancelAs('manager', b2);
  const self = await decide('manager', 'approve', c2.refund.id, b2.id);
  check('RF-SELF: MANAGER lập rồi tự duyệt ⇒ bị chặn, hồ sơ vẫn PENDING (mọi mức tiền)', self.status >= 400 && (await refundRows(b2.id))[0].status === 'PENDING', `HTTP ${self.status} ${errCode(self)}`);
  const byOwner = await decide('owner', 'approve', c2.refund.id, b2.id);
  check('RF-SELF: OWNER (khác người lập) duyệt được ⇒ 200 APPROVED', byOwner.status === 200 && (await refundRows(b2.id))[0].status === 'APPROVED', `HTTP ${byOwner.status} ${errCode(byOwner)}`);
  const s3 = far();
  const b3 = await makeBooking('RF-SELF-OWNER', { plan: 'FLEX7', type: 'STD', from: s3, to: addDays(s3, 3) });
  const c3 = await cancelAs('owner', b3);
  const ownerSelf = await decide('owner', 'approve', c3.refund.id, b3.id);
  check('RF-SELF: OWNER lập rồi tự duyệt ⇒ bị chặn (OWNER cũng không vượt maker–checker, BR-CANCEL-15)', ownerSelf.status >= 400 && (await refundRows(b3.id))[0].status === 'PENDING', `HTTP ${ownerSelf.status} ${errCode(ownerSelf)}`);

  // ---- ngưỡng > 5.000.000 trên netRefund ----
  const t = far();
  const big = await makeBooking('RF-BIG', { plan: 'FLEX7', type: 'FAM', from: t, to: addDays(t, 5), pay: 'full' });
  const cb = await cancelAs('frontdesk', big);
  check(`RF-BIG: hoàn ${money(big.paid)} > 5.000.000 ⇒ net_refund = ${money(big.paid)} vượt deal.threshold.minor (ngưỡng kiểm soát BR-CANCEL-15)`, big.paid > 5_000_000 && num(cb.refund?.net_refund) === big.paid, `paid=${big.paid} ${JSON.stringify(cb.refund)?.slice(0, 220)}`);
  const bigFd = await decide('frontdesk', 'approve', cb.refund.id, big.id);
  const bigMgr = await decide('manager', 'approve', cb.refund.id, big.id);
  check('RF-BIG: FRONT_DESK không duyệt được; MANAGER khác người lập duyệt được (người duyệt MANAGER+)', bigFd.status === 403 && bigMgr.status === 200, `fd=${bigFd.status} mgr=${bigMgr.status} ${errCode(bigMgr)}`);

  // ---- từ chối / rút giải phóng hạn mức (BR-CANCEL-17/18) ----
  const u = far();
  const b5 = await makeBooking('RF-REJECT', { plan: 'FLEX7', type: 'STD', from: u, to: addDays(u, 3) });
  const c5 = await cancelAs('frontdesk', b5);
  check('RF-REJECT: hồ sơ PENDING đang giữ hạn mức hoàn = số yêu cầu (reservedRefundAmount)', (await reserved(b5.id)) === b5.paid, `reserved=${await reserved(b5.id)}`);
  const rej = await decide('manager', 'reject', c5.refund.id, b5.id, { note: 'Không đủ điều kiện (QA)' });
  check('RF-REJECT: MANAGER từ chối ⇒ REJECTED và nhả hạn mức (reserved = 0)', rej.status === 200 && (await refundRows(b5.id))[0].status === 'REJECTED' && (await reserved(b5.id)) === 0, `HTTP ${rej.status} ${errCode(rej)} reserved=${await reserved(b5.id)}`);
  const afterRej = await decide('manager', 'approve', c5.refund.id, b5.id);
  check('RF-REJECT: duyệt hồ sơ đã REJECTED ⇒ 409 E_PAY_REFUND_NOT_PENDING', afterRej.status === 409 && errCode(afterRej) === 'E_PAY_REFUND_NOT_PENDING', `HTTP ${afterRej.status} ${errCode(afterRej)}`);
  const w = far();
  const b6 = await makeBooking('RF-WITHDRAW', { plan: 'FLEX7', type: 'STD', from: w, to: addDays(w, 3) });
  const c6 = await cancelAs('frontdesk', b6);
  const wd = await call(`/refund-requests/${c6.refund.id}/cancel`, { token: await login('frontdesk'), method: 'POST', body: { reason: 'Khách đổi ý rút yêu cầu (QA F5)' } });
  check('RF-WITHDRAW: người lập rút yêu cầu PENDING ⇒ CANCELLED, nhả hạn mức; booking KHÔNG được khôi phục (BR-CANCEL-18)', wd.status === 200 && (await refundRows(b6.id))[0].status === 'CANCELLED' && (await reserved(b6.id)) === 0 && (await bookingRow(b6.id)).status === 'CANCELLED', `HTTP ${wd.status} ${errCode(wd)}`);

  // ---- yêu cầu cạnh tranh trên cùng khoản thu (TC-PAY-23) ----
  const pay1 = (await sql(`SELECT id FROM payments WHERE booking_id = $1::uuid AND type = 'DEPOSIT'`, [b1.id]))[0].id;
  const dup = await call('/refund-requests', { token: await login('frontdesk'), method: 'POST', body: { bookingId: b1.id, paymentId: pay1, reason: 'GUEST_REQUEST', isForceMajeure: false } });
  check('RF-RACE: tạo thêm yêu cầu hoàn cho booking đã huỷ và đã có hồ sơ APPROVED ⇒ bị từ chối, không lập hồ sơ mới (BR-CANCEL-17)', dup.status >= 400 && (await refundRows(b1.id)).length === 1, `HTTP ${dup.status} ${errCode(dup)} refunds=${(await refundRows(b1.id)).length}`);
  // TC-PAY-20: bất khả kháng thiếu điều kiện bị chặn (qua lệnh huỷ); TC-PAY-23: hai yêu cầu bất khả kháng cạnh tranh một khoản thu.
  const y = far();
  const nominal = vn(y, '14:00:00');
  const b8 = await makeBooking('RF-FM', { plan: 'FLEX7', type: 'STD', from: y, to: addDays(y, 3) });
  const near = nominal - 48 * 3_600_000; // 48h trước nhận phòng ⇒ bậc 24h, hoàn 0% ⇒ huỷ thường không lập hoàn
  const fmNote = 'Bão lớn làm đóng cửa cơ sở theo thông báo của UBND';
  const fm1 = await cancelAs('frontdesk', b8, { reason: 'FORCE_MAJEURE', force: true, note: fmNote, evidenceRefs: ['qa/bao-cao.pdf'], at: near });
  check('RF-FM: FRONT_DESK huỷ bất khả kháng ⇒ 403 E_PAY_REFUND_FORCE_MAJEURE_FORBIDDEN (BR-CANCEL-13, TC-PAY-20)', fm1.res.status === 403 && errCode(fm1.res) === 'E_PAY_REFUND_FORCE_MAJEURE_FORBIDDEN', `HTTP ${fm1.res.status} ${errCode(fm1.res)}`);
  const fm2 = await cancelAs('manager', b8, { reason: 'FORCE_MAJEURE', force: true, note: 'ngắn 12 ký', evidenceRefs: ['qa/bao-cao.pdf'], at: near });
  check('RF-FM: MANAGER nhưng lý do < 20 ký tự ⇒ 400 E_PAY_REASON_TOO_SHORT', fm2.res.status === 400 && errCode(fm2.res) === 'E_PAY_REASON_TOO_SHORT', `HTTP ${fm2.res.status} ${errCode(fm2.res)}`);
  const fm3 = await cancelAs('manager', b8, { reason: 'FORCE_MAJEURE', force: true, note: fmNote, evidenceRefs: ['qa/bao-cao-thien-tai.pdf'], at: near });
  const fmRow = fm3.refund;
  check(`RF-FM: MANAGER huỷ bất khả kháng hợp lệ ở bậc 0% ⇒ hoàn 100% đã thu ${money(b8.paid)}, phạt 0, phí 0 (BR-CANCEL-13 ghi đè bậc)`, fm3.res.status === 200 && fm3.res.body.cancellation?.refundPercent === 100 && fm3.res.body.cancellation?.requestedAmount === b8.paid && fm3.res.body.cancellation?.penaltyAmount === 0 && fm3.res.body.cancellation?.refundFee === 0, `HTTP ${fm3.res.status} ${JSON.stringify(fm3.res.body)?.slice(0, 260)}`);
  check('RF-FM: RefundRequest lưu is_force_majeure, minh chứng và người lập là MANAGER', fmRow?.is_force_majeure === true && num(fmRow.refund_percent) === 100 && JSON.stringify(fmRow.evidence_refs).includes('bao-cao') && fmRow.status === 'PENDING', JSON.stringify(fmRow));
  const x = far();
  const b7 = await makeBooking('RF-PARALLEL-APPROVE', { plan: 'FLEX7', type: 'STD', from: x, to: addDays(x, 3) });
  const c7 = await cancelAs('frontdesk', b7);
  const [pa, pb] = await Promise.all([decide('manager', 'approve', c7.refund.id, b7.id), decide('owner', 'approve', c7.refund.id, b7.id)]);
  const codes = [pa.status, pb.status].sort();
  check('RF-RACE: hai người duyệt song song cùng hồ sơ ⇒ đúng một 200, một 409', codes[0] === 200 && codes[1] === 409, `manager=${pa.status}/${errCode(pa)} owner=${pb.status}/${errCode(pb)}`);
  return { approvedCash: { booking: b1, refund: r1 } };
}

export async function scenarioPayout(ctxIn) {
  const { booking: b1, refund: r1 } = ctxIn.approvedCash;
  // ---- gốc tiền mặt: chuyển khoản (BR-PAY-08) ----
  const noRole = await payout('manager', r1.id, b1.id, { method: 'BANK_TRANSFER', bankNote: 'QA' });
  check('PAYOUT-CASH: MANAGER không chi được (chỉ ACCOUNTANT) ⇒ 403', noRole.status === 403, `HTTP ${noRole.status} ${errCode(noRole)}`);
  const noPin = await payout('accountant', r1.id, b1.id, { method: 'BANK_TRANSFER', bankNote: 'QA', withPin: false });
  check('PAYOUT-CASH: chi thiếu pinToken ⇒ 401 E_AUTH_PIN_REQUIRED', noPin.status === 401 && errCode(noPin) === 'E_AUTH_PIN_REQUIRED', `HTTP ${noPin.status} ${errCode(noPin)}`);
  const wrong = await payout('accountant', r1.id, b1.id, { method: 'VNPAY' });
  check('PAYOUT-CASH: khoản gốc là tiền mặt mà chi về VNPAY ⇒ bị từ chối, không tạo chứng từ chi (BR-PAY-08)', wrong.status >= 400 && (await refundPayments(b1.id)).length === 0, `HTTP ${wrong.status} ${errCode(wrong)} payments=${(await refundPayments(b1.id)).length}`);
  const key = randomUUID();
  const pin1 = await mintPin('accountant', b1.id);
  const p1 = await payout('accountant', r1.id, b1.id, { method: 'BANK_TRANSFER', bankNote: 'Số TK QA 0123456789 — chủ TK Khách QA', key, pinToken: pin1 });
  const op = p1.body?.operations?.[0];
  check('PAYOUT-CASH: kế toán chi về BANK_TRANSFER ⇒ 202 (tác vụ bất đồng bộ), 1 operation READY, hồ sơ còn APPROVED (chưa PAID khi chưa có bằng chứng)', p1.status === 202 && p1.body?.operations?.length === 1 && p1.body.operations[0].status === 'READY' && p1.body?.status === 'APPROVED' && op?.amount === b1.paid, `HTTP ${p1.status} ${JSON.stringify(p1.body)?.slice(0, 260)}`);
  const replay = await payout('accountant', r1.id, b1.id, { method: 'BANK_TRANSFER', bankNote: 'Số TK QA 0123456789 — chủ TK Khách QA', key, pinToken: pin1 });
  check('PAYOUT-CASH: replay đúng cùng Idempotency-Key + cùng thân (pinToken đã tiêu thụ) ⇒ trả lại cùng phản hồi, không đòi PIN mới', replay.status === p1.status && replay.body?.operations?.[0]?.id === op?.id, `HTTP ${replay.status}`);
  const p2 = await payout('accountant', r1.id, b1.id, { method: 'BANK_TRANSFER', bankNote: 'Số TK QA 0123456789 — chủ TK Khách QA' });
  const pays = await refundPayments(b1.id);
  check('PAYOUT-CASH: gọi chi lần hai bằng khoá mới ⇒ KHÔNG thêm Payment REFUND hay operation (một khoá chi ổn định, BR-PAY-11)', pays.length === 1 && (await sql('SELECT count(*)::int AS n FROM refund_payout_operations WHERE refund_request_id = $1::uuid', [r1.id]))[0].n === 1, `HTTP ${p2.status} payments=${pays.length}`);
  await new Promise((r) => setTimeout(r, 8000));
  const after = (await refundRows(b1.id))[0];
  const pays2 = await refundPayments(b1.id);
  const bk = await bookingRow(b1.id);
  const opRow = (await sql('SELECT status, last_error, attempts FROM refund_payout_operations WHERE refund_request_id = $1::uuid', [r1.id]))[0];
  check('PAYOUT-CASH: worker thật chạy ≥ 4 chu kỳ: chuyển khoản tay KHÔNG tự thành PAID; REFUND không SUCCEEDED; refunded_amount = 0', after.status === 'APPROVED' && pays2[0].status !== 'SUCCEEDED' && num(bk.refunded_amount) === 0, JSON.stringify({ after: after.status, pays2, refunded: bk.refunded_amount, opRow }));
  if (after.status === 'APPROVED' && pays2.length === 1) finding('F5-QA-02', 'Hoàn tiền cho khoản gốc tiền mặt (BANK_TRANSFER) không có đường API nào để kế toán ghi nhận "đã chuyển khoản" ⇒ hồ sơ không thể tới PAID: operation dừng UNKNOWN (`MANUAL_TRANSFER_AWAITING_CONFIRMATION`) và không có endpoint xác nhận/đối soát.',
    `Sau /pay BANK_TRANSFER và ≥ 4 chu kỳ worker: refund_requests.status=${after.status}, payments(REFUND).status=${pays2[0]?.status}, operation.status=${opRow?.status}/${opRow?.last_error}. Routes chi hoàn chỉ có approve/reject/cancel/pay (refunds/controller.ts, payouts/controller.ts). Liên quan TD-25.`);

  // ---- gốc VNPAY: chi qua cổng mô phỏng, PAID chỉ sau bằng chứng ----
  const vp = await approvedByPsp('PAYOUT-VNPAY', 'VNPAY', { type: 'SUP', offset: 20 });
  const cv = await cancelAs('frontdesk', vp);
  const rv = cv.refund;
  check(`PAYOUT-VNPAY: huỷ ≥168h booking cọc VNPay ⇒ RefundRequest ${money(vp.paid)} phân bổ về khoản thu VNPAY gốc`, cv.res.status === 200 && num(rv?.requested_amount) === vp.paid, `HTTP ${cv.res.status} ${JSON.stringify(rv)?.slice(0, 200)}`);
  const ap = await decide('manager', 'approve', rv.id, vp.id);
  check('PAYOUT-VNPAY: duyệt (MANAGER khác người lập) ⇒ APPROVED', ap.status === 200, `HTTP ${ap.status} ${errCode(ap)}`);
  const [d1, d2] = await Promise.all([
    payout('accountant', rv.id, vp.id, { method: 'VNPAY' }),
    payout('accountant', rv.id, vp.id, { method: 'VNPAY' }),
  ]);
  const ops = await sql('SELECT id, status, method, amount, psp_key FROM refund_payout_operations WHERE refund_request_id = $1::uuid', [rv.id]);
  check('PAYOUT-VNPAY: hai lệnh chi song song (khoá khác nhau) ⇒ đúng 1 operation + 1 Payment REFUND PENDING cùng 1 psp_key ổn định', ops.length === 1 && (await refundPayments(vp.id)).length === 1, `d1=${d1.status} d2=${d2.status} ops=${ops.length} payments=${(await refundPayments(vp.id)).length}`);
  const done = await until(async () => (await refundRows(vp.id))[0].status === 'PAID');
  const rpay = await refundPayments(vp.id);
  const vb = await bookingRow(vp.id);
  const sim = await sql('SELECT count(*)::int AS n, max(provider_txn_id) AS txn FROM refund_payout_simulator_transfers WHERE psp_key = $1', [ops[0].psp_key]);
  check('PAYOUT-VNPAY: worker thật chi qua cổng mô phỏng ⇒ hồ sơ PAID, Payment REFUND SUCCEEDED có providerTxnId, đúng 1 giao dịch ở cổng PSP', done && rpay.length === 1 && rpay[0].status === 'SUCCEEDED' && Boolean(rpay[0].provider_txn_id) && sim[0].n === 1, JSON.stringify({ done, rpay, sim }));
  check('PAYOUT-VNPAY: refunded_amount = số hoàn, paid_amount không đổi (không sửa Payment gốc, BR-PAY-02/09)', num(vb.refunded_amount) === vp.paid && num(vb.paid_amount) === vp.paid, JSON.stringify(vb));
  const orig = await sql(`SELECT status, amount FROM payments WHERE booking_id = $1::uuid AND type = 'DEPOSIT'`, [vp.id]);
  check('PAYOUT-VNPAY: Payment thu gốc nguyên vẹn SUCCEEDED (BR-PAY-09)', orig.length === 1 && orig[0].status === 'SUCCEEDED' && num(orig[0].amount) === vp.paid, JSON.stringify(orig));
  const afterPaid = await payout('accountant', rv.id, vp.id, { method: 'VNPAY' });
  const opsAfter = (await sql('SELECT count(*)::int AS n FROM refund_payout_operations WHERE refund_request_id = $1::uuid', [rv.id]))[0].n;
  const simAfter = (await sql('SELECT count(*)::int AS n FROM refund_payout_simulator_transfers WHERE psp_key = $1', [ops[0].psp_key]))[0].n;
  check('PAYOUT-VNPAY: gọi chi lần nữa sau PAID ⇒ không thêm Payment REFUND, operation hay giao dịch ở cổng PSP (không "chi lại")', (await refundPayments(vp.id)).length === 1 && opsAfter === 1 && simAfter === 1, `HTTP ${afterPaid.status} payments=${(await refundPayments(vp.id)).length} ops=${opsAfter} sim=${simAfter}`);
  return { vnpayPaid: vp };
}
