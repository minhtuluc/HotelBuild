/**
 * Go-live (máy chủ tự host sau `localhost`): VNPay không gọi IPN vào được, nên khi khách quay về với chuỗi
 * return **đã ký**, web chuyển nguyên bản chuỗi đó tới endpoint IPN của API. API kiểm chữ ký bằng secret của
 * merchant (không giả được) và xử lý idempotent, nên khi IPN thật tới sau cũng không ghi trùng.
 */
const SIGNED = /[?&]vnp_SecureHash=/;

/** Đường BFF relay; `null` khi chuỗi không có chữ ký VNPay. */
export function vnpayRelayPath(search: string): string | null {
  return SIGNED.test(search) ? `/api/psp/vnpay-return${search}` : null;
}

/** URL IPN của API cho chuỗi truy vấn nguyên bản (giữ đúng byte VNPay đã ký). */
export function vnpayIpnUrl(apiBase: string, search: string): string {
  return `${apiBase.replace(/\/+$/, '')}/integrations/psp/vnpay/callback${search}`;
}
