/**
 * Adapter MoMo (HB-094; api.md §3.5, §5.2; MoMo Payment Notification v3 + IPN v2).
 *
 * Chuỗi ký của MoMo **không** theo thứ tự alphabet và **không** nối giá trị bằng dấu `|` (§5.2 nêu rõ
 * cạm bẫy này): mỗi thông điệp có một danh sách trường cố định, nối `k=v` bằng `&` theo đúng danh sách
 * đó, HMAC-SHA256 với `secretKey`. Hai danh sách dưới đây là hai thông điệp adapter dùng: `create`
 * (khởi tạo) và `ipn` (cổng báo kết quả).
 *
 * Số tiền MoMo theo **VND nguyên** (khác VNPay ×100) — `amount` không đi qua quy đổi nào (§5.2).
 */
import { z } from 'zod';
import type {
  PaymentGatewayAdapter,
  PspInit,
  PspInitRequest,
  PspMethod,
  PspMode,
  PspResult,
} from './port.js';
import { equalsHex, hmacHex, asciiText } from './signing.js';
import type { ProviderSettings } from './settings.js';

/** Thứ tự trường của `rawSignature` khi tạo giao dịch (MoMo `/v3/payment/create`, `requestType=captureWallet`). */
const CREATE_FIELDS = [
  'accessKey',
  'amount',
  'extraData',
  'ipnUrl',
  'orderId',
  'orderInfo',
  'partnerCode',
  'redirectUrl',
  'requestId',
  'requestType',
] as const;

/** Thứ tự trường của `rawSignature` ở IPN (MoMo Payment Notification). */
const IPN_FIELDS = [
  'accessKey',
  'amount',
  'extraData',
  'message',
  'orderId',
  'orderInfo',
  'orderType',
  'partnerCode',
  'payType',
  'requestId',
  'responseTime',
  'resultCode',
  'transId',
] as const;

/** `accessKey` là khoá công khai của đối tác nên có trong rawSignature nhưng không nằm trong thân IPN. */
function momoSignatureString(
  fields: readonly string[],
  values: Readonly<Record<string, string>>,
): string {
  return fields.map((field) => `${field}=${values[field] ?? ''}`).join('&');
}

export function momoCreateSignature(
  values: Readonly<Record<string, string>>,
  secret: string,
): string {
  return hmacHex('sha256', secret, momoSignatureString(CREATE_FIELDS, values));
}

export function momoIpnSignature(values: Readonly<Record<string, string>>, secret: string): string {
  return hmacHex('sha256', secret, momoSignatureString(IPN_FIELDS, values));
}

const ipnSchema = z
  .object({
    partnerCode: z.string().min(1),
    orderId: z.string().min(1),
    requestId: z.string().min(1),
    amount: z.union([z.number(), z.string()]),
    resultCode: z.union([z.number(), z.string()]),
    signature: z.string().min(1),
    transId: z.union([z.string(), z.number()]).optional(),
    responseTime: z.union([z.string(), z.number()]).optional(),
    orderInfo: z.string().optional(),
    orderType: z.string().optional(),
    payType: z.string().optional(),
    extraData: z.string().optional(),
    message: z.string().optional(),
  })
  .passthrough();

/** VND nguyên không âm; `null` khi không phải số nguyên hợp lệ (không đoán giá trị). */
function wholeVnd(value: string | number | undefined): bigint | null {
  if (value === undefined || (typeof value === 'string' && !/^\d+$/.test(value))) return null;
  if (typeof value === 'number' && !Number.isSafeInteger(value)) return null;
  return BigInt(value);
}

function epochMillis(value: string | number | undefined): Date | null {
  if (value === undefined) return null;
  const millis = typeof value === 'number' ? value : /^\d+$/.test(value) ? Number(value) : -1;
  const at = new Date(millis);
  return millis < 0 || Number.isNaN(at.getTime()) ? null : at;
}

type MomoIpn = z.infer<typeof ipnSchema>;

/** Bản ghi theo **đúng thứ tự** IPN của MoMo để ký lại; `accessKey` là khoá công khai phía đối tác. */
function ipnSignatureValues(
  ipn: MomoIpn,
  amount: bigint,
  resultCode: string,
  accessKey: string,
): Record<string, string> {
  return {
    accessKey,
    amount: amount.toString(),
    extraData: ipn.extraData ?? '',
    message: ipn.message ?? '',
    orderId: ipn.orderId,
    orderInfo: ipn.orderInfo ?? '',
    orderType: ipn.orderType ?? '',
    partnerCode: ipn.partnerCode,
    payType: ipn.payType ?? '',
    requestId: ipn.requestId,
    responseTime: ipn.responseTime === undefined ? '' : String(ipn.responseTime),
    resultCode,
    transId: ipn.transId === undefined ? '' : String(ipn.transId),
  };
}

export class MomoAdapter implements PaymentGatewayAdapter {
  constructor(readonly settings: ProviderSettings) {}

  get method(): PspMethod {
    return 'MOMO';
  }

  get mode(): PspMode {
    return this.settings.mode;
  }

  init(request: PspInitRequest): PspInit {
    const params: Record<string, string> = {
      partnerCode: this.settings.merchantCode,
      requestId: request.orderRef,
      orderId: request.orderRef,
      amount: request.amount.toString(),
      orderInfo: asciiText(`Thanh toan ${request.type} ${request.orderRef}`),
      redirectUrl: request.returnUrl,
      ipnUrl: request.ipnUrl,
      requestType: 'captureWallet',
      extraData: '',
      lang: 'vi',
    };
    const signature = momoCreateSignature(
      { ...params, accessKey: this.settings.accessKey },
      this.settings.secret,
    );
    // `new URL` cũng là chỗ kiểm URL cổng đã cấu hình; hỏng ⇒ 502 ở tầng use case.
    const url = new URL(this.settings.paymentUrl);
    for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
    url.searchParams.set('signature', signature);
    return { paymentUrl: url.toString(), token: signature, providerRef: request.orderRef };
  }

  verify(raw: string): PspResult | null {
    // Hàng rào F1: chế độ `mock` từ chối mọi sự kiện trừ khi kiểm thử bật `PSP_ALLOW_MOCK=true`.
    if (this.settings.mode === 'mock' && !this.settings.allowMockEvents) return null;
    const parsed = ipnSchema.safeParse(parseJson(raw));
    if (!parsed.success) return null;
    const ipn = parsed.data;
    const amount = wholeVnd(ipn.amount);
    const resultCode = String(ipn.resultCode);
    if (
      ipn.partnerCode !== this.settings.merchantCode ||
      amount === null ||
      !/^\d+$/.test(resultCode)
    )
      return null;
    const values = ipnSignatureValues(ipn, amount, resultCode, this.settings.accessKey);
    if (!equalsHex(momoIpnSignature(values, this.settings.secret), ipn.signature)) return null;
    return {
      orderRef: ipn.orderId,
      providerTxnId: ipn.transId === undefined ? null : String(ipn.transId),
      amount,
      outcome: resultCode === '0' ? 'SUCCEEDED' : 'FAILED',
      paidAt: epochMillis(ipn.responseTime),
    };
  }
}

/** IPN là JSON (`application/json`, §5.2); thân không parse được coi như chữ ký sai. */
function parseJson(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}
