/**
 * Hợp đồng ACK + danh tính sự kiện của callback PSP (api.md §5.2; ADR-017 §3, §5).
 *
 * ACK theo **từng cổng**, không có `200 JSON` chung (api.md §5.3): VNPay trả `RspCode` trong thân JSON
 * ở HTTP 200 cho mọi mã nghiệp vụ (`00` đã ghi nhận, `02` đã xử lý, `01` không có đơn, `04` sai tiền,
 * `97` sai chữ ký, `99` chưa lưu được); MoMo trả HTTP 204, thân rỗng khi đã ghi nhận. Không success-ACK
 * khi chưa ghi bền sự kiện. Danh tính sự kiện suy từ **dữ liệu đã xác minh** (không tin payload thô):
 * `providerTxnId` khi cổng cấp, ngược lại băm của bộ trường canonical — nên hai bản phát lại của cùng
 * sự kiện luôn trùng khoá, còn hai sự kiện khác nhau thì không trùng.
 */
import { createHash } from 'node:crypto';
import type { Prisma } from '@prisma/client';
import type { PspMethod, PspResult } from '../psp/port.js';

/** Kết cục xử lý một sự kiện đã xác minh. */
export type CallbackDecision =
  | 'APPLIED' // đã ghi nhận (kể cả ghi nhận **từ chối** — không di chuyển tiền lần hai)
  | 'DUPLICATE' // sự kiện/giao dịch đã ở đúng trạng thái trước đó
  | 'ORDER_UNKNOWN' // không có Payment theo `orderRef`
  | 'AMOUNT_MISMATCH' // số tiền khác Payment đã lưu lúc khởi tạo
  | 'RECONCILE'; // đã lưu bền nhưng phải đối soát tay (khác payload, mã giao dịch trùng)

/** `BAD_SIGNATURE` — verify sai: từ chối, **không** ghi gì; `UNSTORED` — chưa ghi bền được. */
export type CallbackOutcome = CallbackDecision | 'BAD_SIGNATURE' | 'UNSTORED' | 'NOT_PRODUCTION';

/** Kết cục không dùng mã theo giao thức cổng (`NOT_PRODUCTION` có thân lỗi riêng, xem `ackFor`). */
type ProviderOutcome = Exclude<CallbackOutcome, 'NOT_PRODUCTION'>;

export interface CallbackAck {
  readonly httpStatus: number;
  readonly body: unknown;
}

/** Chưa cấu hình khoá thật (bộ mô phỏng công khai): **503** cho cả hai cổng, không success-ACK. */
const NOT_PRODUCTION: CallbackAck = {
  httpStatus: 503,
  body: {
    code: 'E_PSP_NOT_PRODUCTION',
    message: 'PSP simulation keys must not record payments.',
  },
};

const VNPAY_CODES: Readonly<Record<ProviderOutcome, readonly [string, string]>> = {
  APPLIED: ['00', 'Confirm Success'],
  DUPLICATE: ['02', 'Order already confirmed'],
  RECONCILE: ['02', 'Order already confirmed'],
  ORDER_UNKNOWN: ['01', 'Order not found'],
  AMOUNT_MISMATCH: ['04', 'Invalid amount'],
  BAD_SIGNATURE: ['97', 'Invalid signature'],
  UNSTORED: ['99', 'Unknown error'],
};

/** MoMo chỉ quy định 204 = đã ghi nhận; mã lỗi còn lại dùng HTTP status + mã lỗi của mình. */
const MOMO_STATUS: Readonly<Record<ProviderOutcome, number>> = {
  APPLIED: 204,
  DUPLICATE: 204,
  RECONCILE: 204,
  ORDER_UNKNOWN: 404,
  AMOUNT_MISMATCH: 422,
  BAD_SIGNATURE: 400,
  UNSTORED: 500,
};

const MOMO_CODE: Readonly<Partial<Record<ProviderOutcome, string>>> = {
  ORDER_UNKNOWN: 'E_PAY_ORDER_NOT_FOUND',
  AMOUNT_MISMATCH: 'E_PAY_AMOUNT_MISMATCH',
  BAD_SIGNATURE: 'E_PAY_SIGNATURE_INVALID',
  UNSTORED: 'E_PAY_INBOX_UNAVAILABLE',
};

/** Đường callback của api.md §5.2 dùng tham số thường; ánh xạ tường minh, không suy từ chuỗi. */
export const PSP_METHODS: Readonly<Record<string, PspMethod>> = { vnpay: 'VNPAY', momo: 'MOMO' };

export function ackFor(method: PspMethod, outcome: CallbackOutcome): CallbackAck {
  if (outcome === 'NOT_PRODUCTION') return NOT_PRODUCTION;
  if (method === 'VNPAY') {
    const pair = VNPAY_CODES[outcome];
    return { httpStatus: 200, body: { RspCode: pair?.[0], Message: pair?.[1] } };
  }
  const status = MOMO_STATUS[outcome];
  const code = MOMO_CODE[outcome];
  return { httpStatus: status ?? 500, body: code === undefined ? null : { code } };
}

/** Bộ trường canonical **đã xác minh** — cũng là `payload_json` của inbox (BR-PAY-04: không thẻ/PII). */
export function canonicalPayload(method: PspMethod, result: PspResult): Prisma.InputJsonValue {
  const payload: Prisma.InputJsonValue = {
    method,
    orderRef: result.orderRef,
    providerTxnId: result.providerTxnId,
    amount: result.amount.toString(),
    outcome: result.outcome,
    paidAt: result.paidAt === null ? null : result.paidAt.toISOString(),
  };
  return payload;
}

export interface EventIdentity {
  readonly eventId: string;
  readonly payloadHash: string;
}

export function eventIdentity(method: PspMethod, result: PspResult): EventIdentity {
  const payloadHash = createHash('sha256')
    .update(JSON.stringify(canonicalPayload(method, result)), 'utf8')
    .digest('hex');
  return { eventId: result.providerTxnId ?? payloadHash, payloadHash };
}

/** Bối cảnh request cần cho audit/metric: mã tương quan của interceptor + IP cổng. */
export interface WebhookContext {
  readonly correlationId: string;
  readonly ip: string | null;
}
