/**
 * Cấu hình cổng thanh toán (HB-094 AC4) — **một chỗ duy nhất** đọc `ApiConfig` rồi quyết định chế độ.
 *
 * `mode` suy từ dữ liệu cấu hình, không có cờ riêng: đủ bộ khoá của một cổng ⇒ `live`, thiếu ⇒ `mock`.
 * Nhờ vậy "đổi sang thật chỉ bằng cấu hình": điền `VNPAY_TMN_CODE`/`VNPAY_HASH_SECRET` (hoặc
 * `MOMO_PARTNER_CODE`/`MOMO_ACCESS_KEY`/`MOMO_SECRET_KEY`) cùng URL cổng khi có sandbox, không sửa mã.
 *
 * **Hai hàng rào an toàn (F1):**
 * 1. `pspSettings` **dừng tiến trình** khi `NODE_ENV = production` mà còn cổng ở chế độ `mock` — khoá mô
 *    phỏng là hằng công khai trong mã, chạy production với nó nghĩa là ai cũng giả được giao dịch;
 *    đồng thời production bắt buộc có `PAYMENT_PSP_CALLBACK_BASE_URL` (gốc callback, không suy từ khách).
 * 2. `verify` của adapter `mock` **từ chối mọi sự kiện**, trừ khi `PSP_ALLOW_MOCK=true` (chỉ dùng trong
 *    kiểm thử) — hàng rào thứ hai tại thời điểm ghi tiền, không chỉ lúc khởi động.
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
  /** Bí mật ký (`vnp_HashSecret`/MoMo `secretKey`) — chỉ tồn tại trong bộ nhớ tiến trình. */
  readonly secret: string;
  readonly accessKey: string;
  readonly paymentUrl: string;
  /** `true` ⇒ `verify` được xác minh sự kiện dù đang `mock` (kiểm thử; xem đầu tệp). */
  readonly allowMockEvents: boolean;
}

export interface PspSettings {
  readonly VNPAY: ProviderSettings;
  readonly MOMO: ProviderSettings;
  /** Gốc URL công khai cho callback PSP; `null` ⇒ dev dùng gốc loopback từ `HOST`/`PORT`. */
  readonly callbackBaseUrl: string | null;
  /** Gốc loopback cố định của tiến trình (`HOST`/`PORT`) — dùng khi chưa khai gốc callback công khai. */
  readonly loopbackBaseUrl: string;
  /** Danh sách trắng origin cho `returnUrl`; rỗng ⇒ dev/test cho qua mọi origin (production đã dừng). */
  readonly returnUrlOrigins: readonly string[];
}

/** VNPay: `vnp_TmnCode` + chuỗi bí mật là đủ (giao thức không có `accessKey` riêng). */
function vnpaySettings(config: ApiConfig, allowMockEvents: boolean): ProviderSettings {
  const code = config.VNPAY_TMN_CODE;
  const secret = config.VNPAY_HASH_SECRET;
  return Object.freeze({
    method: 'VNPAY' as const,
    mode: code !== undefined && secret !== undefined ? ('live' as const) : ('mock' as const),
    merchantCode: code ?? MOCK_MERCHANT.VNPAY,
    secret: secret ?? MOCK_SECRET.VNPAY,
    accessKey: secret ?? MOCK_SECRET.VNPAY,
    paymentUrl: config.VNPAY_PAYMENT_URL ?? VNPAY_SANDBOX_URL,
    allowMockEvents,
  });
}

/** MoMo: cần đủ `partnerCode`, `accessKey` và `secretKey` theo giao thức tạo giao dịch. */
function momoSettings(config: ApiConfig, allowMockEvents: boolean): ProviderSettings {
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
    allowMockEvents,
  });
}

/** Bỏ dấu `/` cuối và chuẩn hoá danh sách origin (bỏ mục rỗng) — dùng cho cả callback và `returnUrl`. */
function origins(value: string | undefined): string[] {
  if (value === undefined) return [];
  return value
    .split(',')
    .map((item) => item.trim())
    .filter((item) => item.length > 0)
    .map((item) => (item.endsWith('/') ? item.slice(0, -1) : item));
}

export function pspSettings(config: ApiConfig): PspSettings {
  const allowMockEvents = config.PSP_ALLOW_MOCK === 'true';
  const base = config.PAYMENT_PSP_CALLBACK_BASE_URL;
  const callbackBaseUrl = base === undefined ? null : base.endsWith('/') ? base.slice(0, -1) : base;
  const vnpay = vnpaySettings(config, allowMockEvents);
  const momo = momoSettings(config, allowMockEvents);
  const configured = origins(config.PAYMENT_RETURN_URL_ORIGINS);
  const production = config.NODE_ENV === 'production';
  const mocks = [vnpay, momo].filter((provider) => provider.mode === 'mock').length > 0;
  if (production && (mocks || callbackBaseUrl === null))
    throw new Error(
      'Cấu hình PSP production không hợp lệ: thiếu bộ khoá cổng (không dùng adapter mô phỏng) hoặc thiếu PAYMENT_PSP_CALLBACK_BASE_URL',
    );
  return Object.freeze({
    VNPAY: vnpay,
    MOMO: momo,
    callbackBaseUrl,
    loopbackBaseUrl: `http://${config.HOST}:${config.PORT}`,
    // Ưu tiên danh sách khai tường minh; chưa khai ⇒ nhận origin của callback (cùng miền hệ thống).
    returnUrlOrigins: Object.freeze(
      configured.length > 0 ? configured : callbackBaseUrl === null ? [] : [callbackBaseUrl],
    ),
  });
}

/**
 * `ipnUrl` theo giao thức MoMo: URL công khai PSP gọi về. Lấy **gốc cố định từ cấu hình** — chưa khai
 * thì dùng loopback của chính tiến trình (`HOST`/`PORT`), **không** lấy từ `returnUrl` của khách (F4).
 */
export function ipnUrl(settings: PspSettings, method: PspMethod): string {
  const base = settings.callbackBaseUrl ?? settings.loopbackBaseUrl;
  return `${base}/api/v1/integrations/psp/${method.toLowerCase()}/callback`;
}

/** Origin của `returnUrl` phải nằm trong danh sách trắng; rỗng ⇒ dev/test cho qua (production đã chặn). */
export function allowedReturnUrl(settings: PspSettings, returnUrl: string): boolean {
  if (settings.returnUrlOrigins.length === 0) return true;
  return settings.returnUrlOrigins.includes(new URL(returnUrl).origin);
}
