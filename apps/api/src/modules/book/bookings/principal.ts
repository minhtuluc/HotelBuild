/**
 * Chủ thể và quyền của bốn tuyến BOOK (HB-077; api.md §2.5, §6.3):
 * `POST /bookings` + `GET /bookings` + `GET /bookings/{bookingId}` là hành trình khách (vai trò GUEST,
 * nhân viên cũng dùng được với quyền `bookings.read`/`bookings.create`), còn
 * `POST /bookings/{bookingId}/confirm` là tuyến nhân viên (FRONT_DESK).
 *
 * Vì sao ba tuyến kia tự phân giải chủ thể thay vì `@Permission` + `RbacGuard` (HB-014): `GUEST`
 * **không** phải vai trò trong `userRoleSchema` nên `PermissionRegistry` từ chối khai nó ngay khi khởi
 * động, còn `AuthGuard` (HB-013) chỉ xác thực phiên nhân viên (`auth_sessions.users`); nhánh phiên
 * khách thuộc HB-017. Cùng lý do và cùng cách làm như `POST /quotes` (HB-074) và `POST/DELETE /holds`
 * (HB-076): `@Public()` + phân giải chủ thể trong module, vẫn kiểm chữ ký/hạn token bằng
 * `verifyAccessToken`, và **đọc lại** `users.role`/`is_active`/phạm vi cơ sở từ CSDL cho nhân viên.
 *
 * `POST /bookings/{bookingId}/confirm` là tuyến **có** `@Permission('bookings.confirm')`; trên tuyến
 * đó `request.actor` đã được guard dựng nên `bookingCaller` dùng lại, không xác thực hai lần.
 */
import type { PrismaClient } from '@prisma/client';
import type { FastifyRequest } from 'fastify';
import type { Clock } from '@pinehill/domain';
import { isAuthorizedActor } from '../../../common/actor/authorized-actor.js';
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
export interface BookingCaller {
  readonly type: 'GUEST' | 'USER';
  readonly id: string;
  readonly role: string;
  /** Phạm vi cơ sở cấp cho người dùng (rỗng với phiên khách) — HB-014, BR-RBAC-02. */
  readonly propertyScope: readonly string[];
  readonly ip: string | null;
  /** Mã tương quan do `CorrelationInterceptor` gắn (api.md §1.3), dùng cho nhật ký kiểm toán. */
  readonly correlationId: string;
  /** Định danh cho idempotency (HB-029) và fingerprint quote (HB-074). */
  readonly principal: Principal;
}

function bearerToken(header: string | undefined): string | null {
  if (header === undefined) return null;
  return /^Bearer +(\S+)$/i.exec(header)?.[1] ?? null;
}

/** Chủ thể của request: actor của guard khi có, ngược lại tự xác thực bearer (tuyến `@Public`). */
export async function bookingCaller(
  db: PrismaClient,
  request: FastifyRequest,
  config: ApiConfig,
  clock: Clock,
): Promise<BookingCaller> {
  const actor = request.actor;
  if (isAuthorizedActor(actor))
    return Object.freeze({
      type: 'USER' as const,
      id: actor.id,
      role: actor.role,
      propertyScope: actor.propertyScope,
      ip: actor.ip,
      correlationId: actor.correlationId,
      principal: Object.freeze({ type: 'USER' as const, id: actor.id }),
    });
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

/**
 * Phạm vi cơ sở của BR-RBAC-02/03: OWNER có phạm vi toàn chuỗi, SYSADMIN không thao tác dữ liệu cơ sở
 * (giống `canActOn` của `common/actor/authorized-actor.ts`), còn lại phải nằm trong `propertyScope`.
 */
function assertProperty(caller: BookingCaller, propertyId: string): void {
  if (caller.role === 'OWNER') return;
  if (caller.role === 'SYSADMIN' || !caller.propertyScope.includes(propertyId)) throw outOfScope();
}

/** `POST /bookings`: phiên khách tạo cho chính mình, hoặc nhân viên có quyền tạo trong cơ sở. */
export function requireCreate(
  permissions: PermissionLookup,
  caller: BookingCaller,
  propertyId: string,
): void {
  if (caller.type === 'GUEST') return;
  if (!permissions.allows(caller.role, 'bookings.create')) throw forbidden();
  assertProperty(caller, propertyId);
}

/** `GET /bookings`: khách tự lọc theo chính mình, nhân viên cần quyền đọc (phạm vi áp ở truy vấn). */
export function requireRead(permissions: PermissionLookup, caller: BookingCaller): void {
  if (caller.type === 'GUEST') return;
  if (!permissions.allows(caller.role, 'bookings.read')) throw forbidden();
}

/**
 * `GET /bookings/{bookingId}`: khách chỉ thấy booking gắn `guest_id` của phiên mình — booking người
 * khác ⇒ `404 E_GEN_NOT_FOUND` (api.md §1.4: không lộ sự tồn tại tài nguyên người khác).
 */
export function requireBookingRead(
  permissions: PermissionLookup,
  caller: BookingCaller,
  target: { readonly guestId: string; readonly propertyId: string },
): void {
  if (caller.type === 'GUEST') {
    if (caller.id !== target.guestId) throw missing();
    return;
  }
  if (!permissions.allows(caller.role, 'bookings.read')) throw forbidden();
  assertProperty(caller, target.propertyId);
}

/** `POST /bookings/{bookingId}/confirm`: FRONT_DESK trở lên, đúng cơ sở (api.md §2.5, §6.3). */
export function requireConfirm(
  permissions: PermissionLookup,
  caller: BookingCaller,
  target: { readonly propertyId: string },
): void {
  if (caller.type === 'GUEST') throw forbidden();
  if (!permissions.allows(caller.role, 'bookings.confirm')) throw forbidden();
  assertProperty(caller, target.propertyId);
}

/**
 * Điều kiện phạm vi cơ sở cho truy vấn danh sách — cùng luật `propertyWhere` của
 * `common/rbac/scope.ts` nhưng trên chủ thể của module (nhân viên ở đây có thể đến từ phiên được
 * phân giải tại chỗ, không có `AuthorizedActor`):
 * - OWNER: không giới hạn;
 * - SYSADMIN: không cơ sở nào (`in: []`), không thao tác dữ liệu nghiệp vụ;
 * - còn lại: đúng tập `propertyScope`.
 */
export function scopedPropertyIds(caller: BookingCaller): readonly string[] | null {
  if (caller.role === 'OWNER') return null;
  if (caller.role === 'SYSADMIN') return Object.freeze([]);
  return caller.propertyScope;
}
