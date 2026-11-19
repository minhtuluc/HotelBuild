/**
 * Chủ thể của hai tuyến huỷ (HB-256) và tuyến đổi ngày (HB-258): nhân viên **hoặc** khách sở hữu booking (api.md §2.5 vai trò tối
 * thiểu `GUEST`). Hai tuyến là `@Public` để phiên khách đi qua; chủ thể tự xác thực bằng `bookingCaller`
 * (cùng cách `POST/GET /bookings` của HB-077 và `GET /bookings/{id}/balance`): kiểm chữ ký, dòng phiên
 * (TD-59) và **đọc lại** vai trò/phạm vi nhân viên từ CSDL. Nhân viên vẫn phải có quyền của tuyến.
 */
import type { PrismaClient } from '@prisma/client';
import type { FastifyRequest } from 'fastify';
import type { Clock } from '@pinehill/domain';
import type { ActorContext } from '../../../common/actor/actor-context.js';
import type { AuthorizedActor } from '../../../common/actor/authorized-actor.js';
import type { PermissionRegistry } from '../../../common/rbac/permission-registry.js';
import type { ApiConfig } from '../../../config/env.js';
import { bookingCaller } from '../bookings/principal.js';
import { forbidden } from './validation.js';

export interface CancelActor {
  readonly kind: 'USER' | 'GUEST';
  /** `users.id` của nhân viên hoặc `guests.id` của khách. */
  readonly id: string;
  readonly role: string;
  readonly ip: string | null;
  readonly correlationId: string;
}

export interface CallerDeps {
  readonly db: PrismaClient;
  readonly config: ApiConfig;
  readonly clock: Clock;
  readonly permissions: PermissionRegistry;
}

export async function cancelCaller(
  deps: CallerDeps,
  request: FastifyRequest,
  permission: 'bookings.cancel' | 'bookings.cancelPreview' | 'bookings.reschedule',
): Promise<CancelActor> {
  const caller = await bookingCaller(deps.db, request, deps.config, deps.clock);
  if (caller.type === 'USER' && !deps.permissions.allows(caller.role, permission))
    throw forbidden();
  return Object.freeze({
    kind: caller.type,
    id: caller.id,
    role: caller.role,
    ip: caller.ip,
    correlationId: caller.correlationId,
  });
}

/** Actor ghi audit/sổ: `audit_logs.actor_id` là FK `users`, nên khách ghi `null` kèm vai trò `GUEST`. */
export function auditActor(actor: CancelActor): ActorContext {
  return {
    id: actor.kind === 'USER' ? actor.id : null,
    role: actor.role,
    ip: actor.ip,
    correlationId: actor.correlationId,
  };
}

/** Nhân viên đã qua guard (trả phòng sớm dùng chung `recordRefund`) — cùng hình dạng chủ thể huỷ. */
export function staffActor(actor: AuthorizedActor): CancelActor {
  return {
    kind: 'USER',
    id: actor.id,
    role: actor.role,
    ip: actor.ip,
    correlationId: actor.correlationId,
  };
}
