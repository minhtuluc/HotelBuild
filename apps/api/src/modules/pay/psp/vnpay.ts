/**
 * Adapter VNPay (HB-094; api.md §3.5, §5.2; VNPay Payment 2.1.0).
 *
 * Chuỗi ký: **sắp xếp** tham số `vnp_*`, bỏ `vnp_SecureHash`/`vnp_SecureHashType`, nối `k=v` bằng `&`
 * trên giá trị đã giải mã, HMAC-SHA512 với `vnp_HashSecret` (§5.2: "VNPay ký tham số sắp xếp và
 * URL-encode đúng quy tắc, loại trường chữ ký"). VNPAY chuyển đơn vị ×100 **đúng một lần** ở biên
 * (`vnp_Amount = VND × 100`), nên cả `init` lẫn `verify` đều quy đổi tại đây (BR-PAY-01, §5.2).
 *
 * `verify` chỉ xác minh chữ ký, `vnp_TmnCode` và định dạng số tiền — đối chiếu `vnp_TxnRef`/`amount`
 * với `Payment` đã lưu là việc của người gọi (HB-095), đúng BR-PAY-03.
 */
import type {
  PaymentGatewayAdapter,
  PspInit,
  PspInitRequest,
  PspMethod,
  PspMode,
  PspResult,
} from './port.js';
import {
  asciiText,
  equalsHex,
  hmacHex,
  parseVnTimestamp,
  signatureString,
  vnTimestamp,
} from './signing.js';
import type { ProviderSettings } from './settings.js';

const HASH_FIELD = 'vnp_SecureHash';
const HASH_TYPE_FIELD = 'vnp_SecureHashType';
const TMN_FIELD = 'vnp_TmnCode';
const VERSION = '2.1.0';
/** BR-PAY-05: cửa sổ 15 phút cho một lần thanh toán; hết hạn là FAILED cục bộ, không chứng minh PSP chưa thu. */
const WINDOW_SECONDS = 900;

/** Bỏ hai trường chữ ký (bản sao, không sửa tham số nhận vào) rồi ký phần còn lại. */
export function vnpaySignableParams(
  params: Readonly<Record<string, string>>,
): Record<string, string> {
  const signable: Record<string, string> = {};
  for (const [key, value] of Object.entries(params))
    if (key !== HASH_FIELD && key !== HASH_TYPE_FIELD) signable[key] = value;
  return signable;
}

export function vnpaySignature(params: Readonly<Record<string, string>>, secret: string): string {
  return hmacHex('sha512', secret, signatureString(vnpaySignableParams(params)));
}

/** Đọc `vnp_Amount` (đơn vị ×100) → VND nguyên; `null` khi sai định dạng hoặc lẻ đồng. */
function vnpayAmount(value: string | undefined): bigint | null {
  if (value === undefined || !/^\d+$/.test(value)) return null;
  const hundredths = BigInt(value);
  return hundredths % 100n === 0n ? hundredths / 100n : null;
}

/** Kết quả thành công theo giao thức: `00` ở `vnp_ResponseCode` **và** ở `vnp_TransactionStatus` (nếu có). */
function vnpaySucceeded(params: Readonly<Record<string, string>>): boolean {
  const transactionStatus = params['vnp_TransactionStatus'];
  return (
    params['vnp_ResponseCode'] === '00' &&
    (transactionStatus === undefined || transactionStatus === '00')
  );
}

export class VnpayAdapter implements PaymentGatewayAdapter {
  constructor(readonly settings: ProviderSettings) {}

  get method(): PspMethod {
    return 'VNPAY';
  }

  get mode(): PspMode {
    return this.settings.mode;
  }

  init(request: PspInitRequest): PspInit {
    const params: Record<string, string> = {
      vnp_Version: VERSION,
      vnp_Command: 'pay',
      vnp_TmnCode: this.settings.merchantCode,
      vnp_Amount: (request.amount * 100n).toString(),
      vnp_CurrCode: 'VND',
      vnp_TxnRef: request.orderRef,
      vnp_OrderInfo: asciiText(`Thanh toan ${request.type} ${request.orderRef}`),
      vnp_OrderType: 'other',
      vnp_Locale: 'vn',
      vnp_ReturnUrl: request.returnUrl,
      vnp_CreateDate: vnTimestamp(request.now),
      vnp_ExpireDate: vnTimestamp(new Date(request.now.getTime() + WINDOW_SECONDS * 1000)),
      vnp_IpAddr: request.ip ?? '127.0.0.1',
    };
    const signature = vnpaySignature(params, this.settings.secret);
    // `new URL` cũng là chỗ kiểm URL cổng đã cấu hình; hỏng ⇒ 502 ở tầng use case (không lộ chi tiết).
    const url = new URL(this.settings.paymentUrl);
    for (const key of Object.keys(params).sort()) url.searchParams.set(key, params[key] ?? '');
    url.searchParams.set(HASH_TYPE_FIELD, 'HmacSHA512');
    url.searchParams.set(HASH_FIELD, signature);
    return { paymentUrl: url.toString(), token: signature, providerRef: request.orderRef };
  }

  verify(raw: string): PspResult | null {
    // Hàng rào F1: khoá mô phỏng là công khai ⇒ chế độ `mock` KHÔNG xác nhận sự kiện nào, trừ khi kiểm
    // thử bật `PSP_ALLOW_MOCK=true`. Không có đường nào để tiền được ghi bằng khoá giả.
    if (this.settings.mode === 'mock' && !this.settings.allowMockEvents) return null;
    const params = Object.fromEntries(new URLSearchParams(raw));
    const orderRef = params['vnp_TxnRef'];
    const amount = vnpayAmount(params['vnp_Amount']);
    if (orderRef === undefined || amount === null || !this.authentic(params)) return null;
    return {
      orderRef,
      providerTxnId: params['vnp_TransactionNo'] ?? null,
      amount,
      outcome: vnpaySucceeded(params) ? 'SUCCEEDED' : 'FAILED',
      paidAt: parseVnTimestamp(params['vnp_PayDate'] ?? ''),
    };
  }

  /** Chữ ký hợp lệ **và** đúng merchant đang cấu hình — cổng khác không được ghi tiền (§5.2). */
  private authentic(params: Readonly<Record<string, string>>): boolean {
    const provided = params[HASH_FIELD];
    return (
      provided !== undefined &&
      params[TMN_FIELD] === this.settings.merchantCode &&
      equalsHex(vnpaySignature(params, this.settings.secret), provided)
    );
  }
}
