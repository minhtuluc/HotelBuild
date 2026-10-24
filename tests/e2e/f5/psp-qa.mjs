/**
 * HB-117 — phía **cổng thanh toán** do QA tự dựng từ tài liệu giao thức (api.md §5.2; VNPay Payment 2.1.0 IPN; MoMo
 * Payment Notification v3): ký IPN và gọi callback. KHÔNG import `apps/api/src/modules/pay/psp/*`, nên bộ ký của sản phẩm và
 * bộ ký của QA là hai bản độc lập — lệch chữ ký sẽ lộ ra thành `RspCode 97`/lỗi, không bị che.
 */
import { createHmac } from 'node:crypto';
import { API_BASE, PSP } from './qa-f5-lib.mjs';
import { call, ctx } from './qa-f5-ctx.mjs';

const hmac = (algo, secret, data) => createHmac(algo, secret).update(data, 'utf8').digest('hex');
/** Mã hoá giá trị như `application/x-www-form-urlencoded` (khoảng trắng → `+`), đúng cách VNPay ký dữ liệu đã encode. */
const enc = (value) => new URLSearchParams({ v: String(value) }).toString().slice(2);
const pad = (n) => String(n).padStart(2, '0');
/** `yyyyMMddHHmmss` theo GMT+7 (VNPay). */
export function vnpTime(ms) {
  const d = new Date(ms + 7 * 3_600_000);
  return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}`;
}

/** Truy vấn IPN VNPay đã ký. `overrides` ghi đè tham số TRƯỚC khi ký (ca sai số tiền/merchant hợp lệ về chữ ký). */
export function vnpayQuery({ orderRef, amount, txnId, outcome = 'SUCCEEDED', tmn = PSP.vnpay.tmn, secret = PSP.vnpay.secret, at = Date.now(), overrides = {}, tamper = {} }) {
  const params = {
    vnp_TmnCode: tmn,
    vnp_TxnRef: orderRef,
    vnp_Amount: String(BigInt(amount) * 100n),
    vnp_ResponseCode: outcome === 'SUCCEEDED' ? '00' : '24',
    vnp_TransactionStatus: outcome === 'SUCCEEDED' ? '00' : '02',
    vnp_TransactionNo: txnId,
    vnp_PayDate: vnpTime(at),
    vnp_OrderInfo: `Thanh toan ${orderRef}`,
    vnp_BankCode: 'NCB',
    ...overrides,
  };
  const signable = Object.keys(params).filter((k) => params[k] !== '').sort().map((k) => `${k}=${enc(params[k])}`).join('&');
  const sig = hmac('sha512', secret, signable);
  // `tamper` đổi tham số SAU khi ký ⇒ chữ ký sai.
  const final = { ...params, ...tamper };
  const query = new URLSearchParams(final);
  query.set('vnp_SecureHashType', 'HmacSHA512');
  query.set('vnp_SecureHash', sig);
  return query.toString();
}

export async function vnpayIpn(opts) {
  const res = await fetch(`${API_BASE}/integrations/psp/vnpay/callback?${vnpayQuery(opts)}`);
  const text = await res.text();
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    body = text;
  }
  ctx.seen.push({ path: 'IPN vnpay', method: 'GET', status: res.status, body });
  return { status: res.status, body };
}

const MOMO_FIELDS = ['accessKey', 'amount', 'extraData', 'message', 'orderId', 'orderInfo', 'orderType', 'partnerCode', 'payType', 'requestId', 'responseTime', 'resultCode', 'transId'];
export async function momoIpn({ orderRef, amount, txnId, outcome = 'SUCCEEDED', partner = PSP.momo.partner, secret = PSP.momo.secret, at = Date.now(), tamper = {} }) {
  const values = {
    accessKey: PSP.momo.accessKey,
    amount: String(amount),
    extraData: '',
    message: outcome === 'SUCCEEDED' ? 'Successful.' : 'Failed.',
    orderId: orderRef,
    orderInfo: `Thanh toan ${orderRef}`,
    orderType: 'momo_wallet',
    partnerCode: partner,
    payType: 'qr',
    requestId: orderRef,
    responseTime: String(at),
    resultCode: outcome === 'SUCCEEDED' ? '0' : '1006',
    transId: txnId,
  };
  const signature = hmac('sha256', secret, MOMO_FIELDS.map((f) => `${f}=${values[f]}`).join('&'));
  const body = { ...values, ...tamper, signature };
  delete body.accessKey;
  const res = await fetch(`${API_BASE}/integrations/psp/momo/callback`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const text = await res.text();
  ctx.seen.push({ path: 'IPN momo', method: 'POST', status: res.status, body: text });
  return { status: res.status, body: text };
}

/**
 * Khởi tạo thanh toán trực tuyến bằng API thật (nhân viên được phép — `payments.online`), trả mã đơn PSP lấy từ `paymentUrl`
 * của phản hồi (không đoán định dạng). Booking phải đang HELD/PENDING_PAYMENT hoặc có nghĩa vụ phải thu.
 */
export async function onlinePay(token, { bookingId, type = 'DEPOSIT', method = 'VNPAY', amount }) {
  const res = await call('/payments/online', {
    token,
    method: 'POST',
    body: { bookingId, type, method, amount, returnUrl: 'https://example.test/ket-qua' },
  });
  if (res.status !== 201) return { res, orderRef: null };
  const url = new URL(res.body.paymentUrl);
  const orderRef = url.searchParams.get('vnp_TxnRef') ?? url.searchParams.get('orderId') ?? url.searchParams.get('requestId');
  return { res, orderRef, paymentId: res.body.paymentId };
}
