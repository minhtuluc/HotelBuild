/**
 * Tiêu thụ `pinToken` dùng một lần cho endpoint 🔒 (HB-015, api.md §1.2, BR-RBAC-05).
 *
 * Hàm dùng chung cho mọi lệnh tài chính (HB-096, HB-099, HB-124…): truyền cùng
 * `Prisma.TransactionClient` của nghiệp vụ để token bị tiêu thụ **trong cùng transaction**;
 * rollback nghiệp vụ cũng trả lại token. Tiêu thụ bằng **một** câu `UPDATE … WHERE consumed_at
 * IS NULL AND expires_at > now` nên hai request đồng thời chỉ một thắng (không đọc-rồi-ghi đua).
 *
 * Gắn chặt `user_id` (token cấp cho ai), `purpose` (loại thao tác) và `booking_id`
 * (`IS NOT DISTINCT FROM` nên `NULL` cũng là một ràng buộc — token cấp cho booking A không dùng
 * được cho booking B).
 */
import type { Prisma } from '@prisma/client';
import { AppError } from '../../../common/app-error.js';
import { hashPinToken } from './token.js';

/** Mục đích hiện hành của `pinToken`: mọi endpoint 🔒 đều là thao tác tài chính (BR-RBAC-05). */
export const PIN_PURPOSE_FINANCIAL = 'FINANCIAL';
export type PinPurpose = typeof PIN_PURPOSE_FINANCIAL;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Lỗi thiếu/hết hạn/đã dùng/sai đối tượng của `pinToken` (api.md §4.2 — 401). */
export function pinRequired(): AppError {
  return new AppError(401, 'E_AUTH_PIN_REQUIRED', 'Cần xác thực PIN cho thao tác tài chính.');
}

export interface PinTokenCheck {
  /** Người dùng đang thao tác; `pinToken` chỉ dùng cho chính chủ. */
  readonly userId: string;
  /** Giá trị `pinToken` thô lấy từ thân yêu cầu (không tin kiểu của client). */
  readonly token: unknown;
  /** Loại thao tác yêu cầu; phải trùng `pin_grants.purpose`. */
  readonly purpose: PinPurpose;
  /** Booking bị ràng buộc, hoặc `null` khi thao tác không gắn booking. */
  readonly bookingId?: string | null;
  readonly now: Date;
}

/**
 * Tiêu thụ `pinToken` trong transaction của caller. Ném `E_AUTH_PIN_REQUIRED` khi token
 * thiếu/sai/hết hạn/đã dùng/không đúng người, đúng purpose, đúng booking.
 */
export async function requirePinToken(
  tx: Prisma.TransactionClient,
  check: PinTokenCheck,
): Promise<void> {
  const bookingId = check.bookingId ?? null;
  if (typeof check.token !== 'string' || check.token.length < 16) throw pinRequired();
  if (bookingId !== null && !UUID.test(bookingId)) throw pinRequired();
  const consumed = await tx.$executeRaw`
    UPDATE pin_grants
    SET consumed_at = ${check.now}, updated_at = ${check.now}
    WHERE token_hash = ${hashPinToken(check.token)}
      AND consumed_at IS NULL
      AND expires_at > ${check.now}
      AND user_id = CAST(${check.userId} AS uuid)
      AND purpose = ${check.purpose}
      AND booking_id IS NOT DISTINCT FROM CAST(${bookingId} AS uuid)`;
  if (consumed !== 1) throw pinRequired();
}
