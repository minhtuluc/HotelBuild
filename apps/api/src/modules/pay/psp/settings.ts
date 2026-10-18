/**
 * Cấu hình cổng thanh toán (HB-094 AC4) — **một chỗ duy nhất** đọc `ApiConfig` rồi quyết định chế độ.
 *
 * `mode` suy từ dữ liệu cấu hình, không có cờ riêng: đủ bộ khoá của một cổng ⇒ `live` (gọi đúng máy
 * chủ thật/sandbox của cổng đó), thiếu ⇒ `mock`. Nhờ vậy "đổi sang thật chỉ bằng cấu hình": điền
 * `VNPAY_TMN_CODE`/`VNPAY_HASH_SECRET` (hoặc `MOMO_PARTNER_CODE`/`MOMO_ACCESS_KEY`/`MOMO_SECRET_KEY`)
 * cùng URL cổng khi có sandbox, không sửa một dòng mã.
 *
 * Khoá mô phỏng dưới đây **không phải bí mật** và chỉ dùng khi chưa cấu hình: thuật toán ký/đối chiếu
 * vẫn là thuật toán của tài liệu PSP, nên đường mã (và test) giống hệt chế độ thật.
 * URL mặc định là sandbox đã nêu trong api.md §5.2; bí mật KHÔNG bao giờ được ghi log (NFR-SEC-02).
 */
import type { ApiConfig } from '../../../config/env.js';
import type { PspMethod, PspMode } from './port.js';

/** Máy chủ sandbox của tài liệu PSP (api.md §5.2) — dùng khi chưa khai URL riêng. */
export const VNPAY_SANDBOX_URL = 'https://sandbox.vnpayment.vn/paymentv2/vpcpay.html';
export const MOMO_SANDBOX_URL = 'https://test-payment.momo.vn/v2/gateway/pay';

const MOCK_MERCHANT: Readonly<Record<PspMethod, string>> = {
  VNPAY: 'PINEMOCK01',
  MOMO: 'PINEMOCK',
};
const MOCK_SECRET: Readonly<Record<PspMethod, string>> = {
  VNPAY: 'pinehill-mock-vnpay-hmac-sha512-key',
  MOMO: 'pinehill-mock-momo-hmac-sha256-key',
};

/** Cấu hình đã chuẩn hoá cho một cổng. */
export interface ProviderSettings {
  readonly method: PspMethod;
  readonly mode: PspMode;
  readonly merchantCode: string;
  /** Bí mật ký (`vnp_HashSecret`/MoMo `secretKey` + `accessKey`) — chỉ tồn tại trong bộ nhớ tiến trình. */
  readonly secret: string;
  readonly accessKey: string;
  readonly paymentUrl: string;
}

export interface PspSettings {
  readonly VNPAY: ProviderSettings;
  readonly MOMO: ProviderSettings;
  /** Gốc URL công khai cho callback PSP; `null` ⇒ suy từ `returnUrl` của từng lệnh. */
  readonly callbackBaseUrl: string | null;
}

/** VNPay: `vnp_TmnCode` + chuỗi bí mật là đủ (giao thức không có `accessKey` riêng). */
function vnpaySettings(config: ApiConfig): ProviderSettings {
  const code = config.VNPAY_TMN_CODE;
  const secret = config.VNPAY_HASH_SECRET;
  return Object.freeze({
    method: 'VNPAY' as const,
    mode: code !== undefined && secret !== undefined ? ('live' as const) : ('mock' as const),
    merchantCode: code ?? MOCK_MERCHANT.VNPAY,
    secret: secret ?? MOCK_SECRET.VNPAY,
    accessKey: secret ?? MOCK_SECRET.VNPAY,
    paymentUrl: config.VNPAY_PAYMENT_URL ?? VNPAY_SANDBOX_URL,
  });
}

/** MoMo: cần đủ `partnerCode`, `accessKey` và `secretKey` theo giao thức tạo giao dịch. */
function momoSettings(config: ApiConfig): ProviderSettings {
  const code = config.MOMO_PARTNER_CODE;
  const accessKey = config.MOMO_ACCESS_KEY;
  const secret = config.MOMO_SECRET_KEY;
  return Object.freeze({
    method: 'MOMO' as const,
    mode:
      code !== undefined && accessKey !== undefined && secret !== undefined
        ? ('live' as const)
        : ('mock' as const),
    merchantCode: code ?? MOCK_MERCHANT.MOMO,
    secret: secret ?? MOCK_SECRET.MOMO,
    accessKey: accessKey ?? MOCK_MERCHANT.MOMO,
    paymentUrl: config.MOMO_PAYMENT_URL ?? MOMO_SANDBOX_URL,
  });
}

export function pspSettings(config: ApiConfig): PspSettings {
  const rawCallbackBase = config.PAYMENT_PSP_CALLBACK_BASE_URL;
  return Object.freeze({
    VNPAY: vnpaySettings(config),
    MOMO: momoSettings(config),
    callbackBaseUrl:
      rawCallbackBase === undefined || !rawCallbackBase.endsWith('/')
        ? (rawCallbackBase ?? null)
        : rawCallbackBase.slice(0, -1),
  });
}

/**
 * `ipnUrl` theo giao thức MoMo: cần URL công khai. Chưa khai `PAYMENT_PSP_CALLBACK_BASE_URL` ⇒ suy từ
 * `returnUrl` (đủ cho local); lệnh vẫn chạy được vì đây là tham số **khách** mở, không phải gọi mạng.
 */
export function ipnUrl(settings: PspSettings, method: PspMethod, returnUrl: string): string {
  const base = settings.callbackBaseUrl ?? new URL(returnUrl).origin;
  return `${base}/api/v1/integrations/psp/${method.toLowerCase()}/callback`;
}
