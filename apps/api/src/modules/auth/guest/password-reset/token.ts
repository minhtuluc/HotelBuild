/**
 * Token đặt lại mật khẩu (QĐ-03 T7): 32 byte ngẫu nhiên an toàn mật mã, hiển thị dạng hex 64 ký tự; CSDL chỉ
 * lưu SHA-256 (hex) của chuỗi đó. Token đủ entropy để băm nhanh là đủ (không cần Argon2) và tra cứu bằng
 * chỉ mục duy nhất `token_hash`.
 */
import { createHash, randomBytes } from 'node:crypto';

/** Hiệu lực 30 phút kể từ lúc cấp (QĐ-03 T7). */
export const RESET_TOKEN_TTL_MS = 30 * 60_000;
/** Dáng token hợp lệ — sai dáng bị coi là token sai ngay, không cần chạm CSDL. */
const TOKEN_SHAPE = /^[A-Za-z0-9_-]{16,256}$/;

export function newResetToken(): string {
  return randomBytes(32).toString('hex');
}

export function hashResetToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export function plausibleResetToken(token: string): boolean {
  return TOKEN_SHAPE.test(token);
}
