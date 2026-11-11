import { Prisma } from '@prisma/client';

/**
 * HB-231 (TD-81): lỗi **hết năng lực tạm thời** của CSDL, không phải lỗi lập trình.
 * - `P2024`: chờ connection từ pool quá `pool_timeout`;
 * - `P2028`: lỗi API transaction, gồm "không mở được transaction trong `maxWait`" và transaction
 *   quá `timeout`.
 * api.md §4.2 xếp loại này vào `503 E_GEN_SERVICE_UNAVAILABLE` (phụ thuộc lỗi, client thử lại), khác
 * `500` của lỗi lập trình. k6 HB-184 (đột biến 600 VU) cho ~20% lệnh `POST /quotes` nhận 500 vì loại lỗi này.
 */
const CAPACITY_CODES = new Set(['P2024', 'P2028']);

/** Số giây gợi ý thử lại khi CSDL quá tải: ngắn, vì hàng đợi pool thường rút trong vài giây. */
export const CAPACITY_RETRY_AFTER_SECONDS = 1;

export function capacityExhausted(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && CAPACITY_CODES.has(error.code);
}
