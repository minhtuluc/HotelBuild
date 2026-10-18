/**
 * Tiện ích ký/đối chiếu dùng chung cho hai adapter (HB-094 AC4).
 *
 * - `signatureString`: chuỗi canonical `k=v` nối `&` sau khi sắp xếp khoá, bỏ giá trị rỗng — đúng
 *   "ký tham số sắp xếp" của api.md §5.2 và thuật toán VNPay v2.1.0.
 * - `hmacHex`: HMAC-SHA512 (VNPay) / HMAC-SHA256 (MoMo) trên chuỗi canonical.
 * - `equalsHex`: so sánh **hằng thời gian** trên hai chuỗi hex (NFR-SEC-05); khác độ dài là khác chữ ký.
 * - `asciiText`/`vnTimestamp`/`parseVnTimestamp`: chuẩn hoá văn bản không dấu cho `vnp_OrderInfo` (tài liệu
 *   VNPay cấm ký tự đặc biệt/dấu) và định dạng giờ `yyyyMMddHHmmss` theo **GMT+7** mà giao thức quy định.
 */
import { createHmac, timingSafeEqual } from 'node:crypto';

/** Múi giờ Việt Nam (UTC+7, không có DST). Giao thức VNPay quy định giờ theo GMT+7. */
const VN_OFFSET_MINUTES = 420;
const VN_OFFSET_MS = VN_OFFSET_MINUTES * 60_000;

export function hmacHex(algorithm: 'sha256' | 'sha512', secret: string, data: string): string {
  return createHmac(algorithm, secret).update(data, 'utf8').digest('hex');
}

/** `null` khi chuỗi không phải hex hợp lệ hoặc hai chuỗi khác độ dài (so sánh hằng thời gian). */
export function equalsHex(expected: string, actual: string): boolean {
  if (!/^[0-9a-f]+$/i.test(expected) || !/^[0-9a-f]+$/i.test(actual)) return false;
  const left = Buffer.from(expected, 'hex');
  const right = Buffer.from(actual, 'hex');
  return left.length === right.length && timingSafeEqual(left, right);
}

/**
 * Cặp `k=v` sau sắp xếp khoá, bỏ giá trị rỗng — dạng canonical để ký.
 * Giá trị được **URL-encode** đúng như khi truyền trên query (VNPay ký dữ liệu đã encode; dùng cùng
 * phép encode của `URLSearchParams` nên chuỗi ký luôn khớp URL phát ra — review vòng hai P1/F2).
 */
export function signaturePairs(params: Readonly<Record<string, string>>): string[] {
  return Object.keys(params)
    .filter((key) => params[key] !== '')
    .sort()
    .map((key) => `${key}=${encodeQueryValue(params[key] ?? '')}`);
}

/** Cùng quy tắc mã hoá với `URLSearchParams` khi dựng URL cổng (khoảng trắng thành `+`). */
export function encodeQueryValue(value: string): string {
  return new URLSearchParams({ v: value }).toString().slice(2);
}

export function signatureString(params: Readonly<Record<string, string>>): string {
  return signaturePairs(params).join('&');
}

/** Giữ chữ/số/khoảng trắng, bỏ dấu tiếng Việt và ký tự đặc biệt (yêu cầu `vnp_OrderInfo`). */
export function asciiText(value: string): string {
  return value
    .normalize('NFD')
    .replaceAll(/[\u0300-\u036f]/g, '')
    .replaceAll('đ', 'd')
    .replaceAll('Đ', 'D')
    .replaceAll(/[^A-Za-z0-9 ]+/g, ' ')
    .replaceAll(/\s+/g, ' ')
    .trim();
}

function pad(value: number, size = 2): string {
  return String(value).padStart(size, '0');
}

/** `Date` (thời điểm tuyệt đối) → `yyyyMMddHHmmss` theo GMT+7. */
export function vnTimestamp(at: Date): string {
  const shifted = new Date(at.getTime() + VN_OFFSET_MS);
  return [
    pad(shifted.getUTCFullYear(), 4),
    pad(shifted.getUTCMonth() + 1),
    pad(shifted.getUTCDate()),
    pad(shifted.getUTCHours()),
    pad(shifted.getUTCMinutes()),
    pad(shifted.getUTCSeconds()),
  ].join('');
}

/** `yyyyMMddHHmmss` theo GMT+7 → `Date`; `null` khi sai định dạng (không đoán giá trị). */
export function parseVnTimestamp(value: string): Date | null {
  if (!/^\d{14}$/.test(value)) return null;
  const parts = [
    Number(value.slice(0, 4)),
    Number(value.slice(4, 6)),
    Number(value.slice(6, 8)),
    Number(value.slice(8, 10)),
    Number(value.slice(10, 12)),
    Number(value.slice(12, 14)),
  ];
  const at = new Date(
    Date.UTC(parts[0]!, parts[1]! - 1, parts[2]!, parts[3]!, parts[4]!, parts[5]!) - VN_OFFSET_MS,
  );
  return Number.isNaN(at.getTime()) ? null : at;
}
