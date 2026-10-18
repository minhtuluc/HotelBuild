/**
 * `pinToken` dùng một lần (HB-015; api.md §1.2, BR-RBAC-05).
 *
 * Token 32 byte ngẫu nhiên in hex (64 ký tự) — cùng khuôn mẫu refresh token HB-013.
 * CSDL **chỉ** lưu SHA-256 (`pin_grants.token_hash`, UNIQUE); token thô chỉ nằm trong bộ nhớ
 * client cho tới khi tiêu thụ. TTL 5 phút khớp CHECK `ck_pin_grants_expiry` của HB-010.
 */
import { createHash, randomBytes } from 'node:crypto';

export const PIN_TOKEN_BYTES = 32;
/** Hiệu lực `pinToken` 5 phút (api.md §1.2; HB-010 CHECK trần 5 phút). */
export const PIN_TOKEN_TTL_MS = 5 * 60_000;

export function createPinToken(): string {
  return randomBytes(PIN_TOKEN_BYTES).toString('hex');
}

export function hashPinToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}
