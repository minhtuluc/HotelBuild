/**
 * Chủ thể của một báo giá (api.md §3.1: "`quoteId` phải gắn principal/phiên báo giá").
 *
 * `POST /quotes` là route **công khai** (api.md §2.4, §6.3) nên `AuthGuard` bỏ qua và `request.actor`
 * không được gắn; lớp này tự suy principal theo đúng thứ tự mà journey khách cần:
 * - không có `Authorization` ⇒ `ANONYMOUS:<ip>` — khách xem giá trước khi đăng nhập;
 * - có `Bearer` **hợp lệ** với vai trò nhân viên (BR-RBAC-01) ⇒ `USER:<userId>`;
 * - có `Bearer` hợp lệ với vai trò **không** phải nhân viên (phiên khách `/guest-auth`, HB-017) ⇒
 *   `GUEST:<id>` — tách khỏi `USER` để chính sách kênh không nhầm khách thành nhân viên (api.md §1.4).
 *
 * Token **sai/hết hạn** trả `401 E_AUTH_INVALID_CREDENTIALS` như guard toàn cục: không âm thầm hạ
 * cấp một phiên hỏng thành khách ẩn danh (cùng hành vi với journey giả `tests/e2e/fake-api`).
 * HB-076/HB-077 dùng lại `principalKey` để tiêu thụ quote **cùng một cách** — quote của người khác
 * không dùng được (AC2).
 */
import type { FastifyRequest } from 'fastify';
import type { Clock } from '@pinehill/domain';
import { AppError } from '../../../common/app-error.js';
import type { Principal } from '../../../common/idempotency/request.js';
import type { ApiConfig } from '../../../config/env.js';
import { verifyAccessToken } from '../../../infrastructure/crypto/access-tokens.js';

/** Vai trò phiên nhân viên (BR-RBAC-01). Vai trò khác (vd. `GUEST` của phiên khách) là khách. */
const STAFF_ROLES: Readonly<Record<string, true>> = {
  OWNER: true,
  MANAGER: true,
  FRONT_DESK: true,
  RESERVATION_AGENT: true,
  ACCOUNTANT: true,
  HOUSEKEEPING: true,
  SYSADMIN: true,
};

/** Khoá principal dùng cho fingerprint và cho bản ghi quote (ổn định, không chứa PII ngoài id). */
export const principalKey = (principal: Principal): string => `${principal.type}:${principal.id}`;

function bearerToken(header: string | undefined): string | null {
  if (header === undefined) return null;
  return /^Bearer +(\S+)$/i.exec(header)?.[1] ?? null;
}

export async function quotePrincipal(
  request: FastifyRequest,
  config: ApiConfig,
  clock: Clock,
): Promise<Principal> {
  const token = bearerToken(request.headers.authorization);
  if (token === null)
    return Object.freeze({ type: 'ANONYMOUS' as const, id: request.ip ?? 'unknown' });
  const verified = await verifyAccessToken(token, config.JWT_ACCESS_SECRET, clock.now());
  if (verified === null) throw new AppError(401, 'E_AUTH_INVALID_CREDENTIALS', 'Chưa xác thực.');
  return Object.freeze({
    type: STAFF_ROLES[verified.role] === true ? ('USER' as const) : ('GUEST' as const),
    id: verified.userId,
  });
}
