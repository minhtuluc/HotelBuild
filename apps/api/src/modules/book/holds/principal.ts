/**
 * Chủ thể của `POST/DELETE /holds` (HB-076) — hành trình khách F4 (api.md §2.5: `POST /holds` vai
 * trò **GUEST**, `DELETE /holds/{holdId}` vai trò **FRONT_DESK**).
 *
 * Vì sao module tự phân giải chủ thể thay vì `@Permission` + `RbacGuard` (HB-014): `GUEST` **không**
 * phải vai trò trong `userRoleSchema` nên `PermissionRegistry` từ chối khai nó ngay khi khởi động, và
 * `AuthGuard` (HB-013) chỉ xác thực phiên nhân viên (`auth_sessions.users`), chưa có nhánh phiên khách
 * — phiên khách thuộc HB-017 (`auth_sessions.guest_id`, vai trò `GUEST`). Cùng lý do và cùng cách làm
 * như `POST /quotes` (HB-074, `rate/quotes/principal.ts`): `@Public()` + phân giải chủ thể trong module,
 * vẫn kiểm chữ ký/hạn token bằng `verifyAccessToken` và **đọc lại** `users.role`/`is_active` từ CSDL cho
 * nhân viên (không tin claim trong token, giống `RbacGuard`).
 *
 * Định danh chủ thể dùng luôn cho `RateQuoteService.consume` (fingerprint gắn principal): `GUEST:<guests.id>`
 * khi là phiên khách, `USER:<users.id>` khi là nhân viên — trùng cách HB-074 phát hành quote.
 */
import type { PrismaClient } from '@prisma/client';
import type { FastifyRequest } from 'fastify';
import type { Clock } from '@pinehill/domain';
import { AppError } from '../../../common/app-error.js';
import type { PermissionLookup } from '../../../common/actor/authorized-actor.js';
import type { Principal } from '../../../common/idempotency/request.js';
import type { ApiConfig } from '../../../config/env.js';
import { verifyAccessToken } from '../../../infrastructure/crypto/access-tokens.js';
import { forbidden, missing, outOfScope, unauthorized } from './validation.js';

/** Vai trò phiên nhân viên (BR-RBAC-01). Vai trò khác (vd. `GUEST` của HB-017) là phiên khách. */
const STAFF_ROLES: Readonly<Record<string, true>> = {
  OWNER: true,
  MANAGER: true,
  FRONT_DESK: true,
  RESERVATION_AGENT: true,
  ACCOUNTANT: true,
  HOUSEKEEPING: true,
  SYSADMIN: true,
};

/**
 * Chủ thể đã kiểm: `id` là `guests.id` (phiên khách) hoặc `users.id` (nhân viên); `role` cho phiên
 * khách luôn là `GUEST`, cho nhân viên là vai trò **đọc từ CSDL**.
 */
export interface HoldCaller {
  readonly type: 'GUEST' | 'USER';
  readonly id: string;
  readonly role: string;
  /** Phạm vi cơ sở cấp cho người dùng (rỗng với phiên khách) — HB-014, BR-RBAC-02. */
  readonly propertyScope: readonly string[];
  readonly ip: string | null;
  /** Mã tương quan do `CorrelationInterceptor` gắn (api.md §1.3), dùng cho nhật ký kiểm toán. */
  readonly correlationId: string;
  /** Định danh dùng cho idempotency (HB-029) và fingerprint quote (HB-074). */
  readonly principal: Principal;
}

function bearerToken(header: string | undefined): string | null {
  if (header === undefined) return null;
  return /^Bearer +(\S+)$/i.exec(header)?.[1] ?? null;
}

export async function holdCaller(
  db: PrismaClient,
  request: FastifyRequest,
  config: ApiConfig,
  clock: Clock,
): Promise<HoldCaller> {
  const token = bearerToken(request.headers.authorization);
  if (token === null) throw unauthorized();
  const verified = await verifyAccessToken(token, config.JWT_ACCESS_SECRET, clock.now());
  if (verified === null) throw unauthorized();
  const ip = request.ip ?? null;
  const correlationId = request.id;
  if (STAFF_ROLES[verified.role] !== true)
    return Object.freeze({
      type: 'GUEST' as const,
      id: verified.userId,
      role: 'GUEST',
      propertyScope: Object.freeze([]),
      ip,
      correlationId,
      principal: Object.freeze({ type: 'GUEST' as const, id: verified.userId }),
    });
  const user = await db.users.findUnique({
    where: { id: verified.userId },
    select: {
      id: true,
      role: true,
      is_active: true,
      user_property_scopes: { select: { property_id: true } },
    },
  });
  if (user === null || !user.is_active) throw unauthorized();
  return Object.freeze({
    type: 'USER' as const,
    id: user.id,
    role: user.role,
    propertyScope: Object.freeze(user.user_property_scopes.map((scope) => scope.property_id)),
    ip,
    correlationId,
    principal: Object.freeze({ type: 'USER' as const, id: user.id }),
  });
}

/** api.md §2.5/§3.4: chỉ phiên khách mới mở hold (nhân viên dùng luồng đặt phòng, HB-077/HB-151). */
export function requireGuest(caller: HoldCaller): void {
  if (caller.type !== 'GUEST')
    throw new AppError(
      403,
      'E_RBAC_FORBIDDEN',
      'Chỉ phiên khách được giữ chỗ tạm; nhân viên dùng luồng đặt phòng.',
    );
}

/**
 * Quyền trên một hold cụ thể khi **giải phóng** (api.md §1.4 và §2.5):
 * - khách: chỉ hold gắn `guestId` của phiên mình, hold của người khác ⇒ `404 E_GEN_NOT_FOUND`
 *   (không lộ sự tồn tại của tài nguyên người khác);
 * - nhân viên: cần quyền `holds.release` (khai ở `permissions.ts`) **và** phạm vi cơ sở
 *   (BR-RBAC-02/03) ⇒ `403 E_AUTH_OUT_OF_SCOPE`; OWNER có phạm vi chuỗi, SYSADMIN không thao tác
 *   dữ liệu cơ sở (giống `canActOn` của `common/actor/authorized-actor.ts`).
 */
export function requireHoldAccess(
  permissions: PermissionLookup,
  caller: HoldCaller,
  target: { readonly guestId: string; readonly propertyId: string },
): void {
  if (caller.type === 'GUEST') {
    if (caller.id !== target.guestId) throw missing();
    return;
  }
  if (!permissions.allows(caller.role, 'holds.release')) throw forbidden();
  if (caller.role === 'OWNER') return;
  if (caller.role === 'SYSADMIN' || !caller.propertyScope.includes(target.propertyId))
    throw outOfScope();
}
