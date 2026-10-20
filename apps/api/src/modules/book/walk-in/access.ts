/**
 * Tiền kiểm `@Idempotent` của `POST /walk-in` (HB-151; HB-029 README mục 1).
 *
 * Chủ thể + cú pháp + phạm vi cơ sở phải quyết được **trước** khi giữ khoá idempotency, nên lệnh hỏng
 * hoặc ngoài phạm vi không để lại `idempotency_keys` rác và không phát lại kết quả cho người khác
 * (api.md §1.6). Tuyến không `@Public` nên `request.actor` đã là `AuthorizedActor` do `AuthGuard`
 * (HB-013) + `RbacGuard` (HB-014) đọc lại từ CSDL; quyền `bookings.create` do `RbacGuard` kiểm theo
 * decorator, ở đây chỉ còn cú pháp thân lệnh và phạm vi cơ sở (BR-RBAC-02/03).
 */
import { Injectable } from '@nestjs/common';
import type { ExecutionContext } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { isAuthorizedActor } from '../../../common/actor/authorized-actor.js';
import type { IdempotencyAccess } from '../../../common/idempotency/decorators.js';
import type { Principal } from '../../../common/idempotency/request.js';
import { outOfScope, unauthorized, walkInInput } from './validation.js';

@Injectable()
export class WalkInAccess implements IdempotencyAccess {
  async authorize(context: ExecutionContext): Promise<Principal> {
    const request = context.switchToHttp().getRequest<FastifyRequest>();
    const actor = request.actor;
    if (!isAuthorizedActor(actor)) throw unauthorized();
    const input = walkInInput(request.body);
    if (!actor.canActOn(input.propertyId)) throw outOfScope();
    return Object.freeze({ type: 'USER' as const, id: actor.id });
  }
}
