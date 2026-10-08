/**
 * Refresh token (ADR-010): 32 byte ngẫu nhiên mã hex; CSDL **chỉ** lưu SHA-256 của token (HB-010).
 */
import { createHash, randomBytes } from 'node:crypto';

const REFRESH_TOKEN_BYTES = 32;
export const REFRESH_TOKEN_TTL_SECONDS = 604_800;

export function createRefreshToken(): string {
  return randomBytes(REFRESH_TOKEN_BYTES).toString('hex');
}

export function hashRefreshToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}
