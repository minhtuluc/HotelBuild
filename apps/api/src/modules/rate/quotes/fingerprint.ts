/**
 * Fingerprint báo giá (HB-074 AC1; api.md §3.1): băm **đầu vào chuẩn hoá + principal + engineVersion**.
 *
 * Vì sao băm cả ba: cùng một kỳ lưu trú có thể được báo giá cho nhiều người/kênh khác nhau với cùng
 * con số; fingerprint phải phân biệt được chúng để `E_RATE_QUOTE_MISMATCH` bắt đúng ca "đổi bất cứ
 * trường nào" **và** ca "dùng quote của người khác". `engineVersion` vào hash để bản engine mới làm
 * quote cũ không còn khớp (BR-RATE-17: cùng đầu vào + cùng engine ⇒ cùng kết quả).
 *
 * Chuẩn hoá (thứ tự tất định, không phụ thuộc thứ tự client gửi):
 * - `childAges[]` sắp **tăng dần** (tập tuổi, không mang thứ tự nghiệp vụ);
 * - `promotionCodes[]` sắp theo từ điển và bỏ trùng (BR-RATE-13 đã cố định thứ tự áp mã);
 * - UUID hạ chữ thường, ngày `YYYY-MM-DD` — do `validation.quoteInput` làm trước đó.
 */
import { createHash } from 'node:crypto';
import type { QuoteInput } from './validation.js';

/** Cùng thứ tự trường cho mọi lần băm: đổi thứ tự = đổi hợp đồng fingerprint. */
export function quoteFingerprint(
  input: QuoteInput,
  principal: string,
  engineVersion: string,
): string {
  const canonical = JSON.stringify([
    principal,
    engineVersion,
    input.propertyId,
    input.roomTypeId,
    input.ratePlanCode,
    input.channelCode,
    input.checkIn,
    input.checkOut,
    input.adults,
    input.children,
    input.roomCount,
    [...input.childAges].sort((a, b) => a - b),
    [...new Set(input.promotionCodes)].sort(),
  ]);
  return createHash('sha256').update(canonical).digest('hex');
}
