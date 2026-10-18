/**
 * Tiền kiểm `@Idempotent` của `POST /payments` (HB-096; HB-029 README mục 1).
 *
 * Chủ thể + cú pháp thân lệnh + quyền/phạm vi trên tài nguyên phải quyết được **trước** khi claim khoá
 * idempotency để lệnh hỏng không để lại `idempotency_keys` rác và replay không trả body cho người khác.
 * `request.actor` lúc này đã là `AuthorizedActor` do `RbacGuard` (HB-014) đọc lại từ CSDL nên
 * `hasPermission`/`canActOn` là nguồn quyền tin cậy. Chỉ `select` tối thiểu — toàn bộ kiểm chứng nghiệp
 * vụ (trạng thái, hold, nghĩa vụ hiện hành, pinToken) thuộc service sau khi khoá booking.
 */
import { Inject, Injectable } from '@nestjs/common';
import type { ExecutionContext } from '@nestjs/common';
import type { PrismaClient } from '@prisma/client';
import type { FastifyRequest } from 'fastify';
import { isAuthorizedActor } from '../../../common/actor/authorized-actor.js';
import type { IdempotencyAccess } from '../../../common/idempotency/decorators.js';
import type { Principal } from '../../../common/idempotency/request.js';
import { PRISMA } from '../../../infrastructure/prisma/prisma.module.js';
import { invalid, missing } from './errors.js';
import { counterCommand, requireCollect } from './principal.js';

@Injectable()
export class CounterAccess implements IdempotencyAccess {
  constructor(@Inject(PRISMA) private readonly db: PrismaClient) {}

  async authorize(context: ExecutionContext): Promise<Principal> {
    const request = context.switchToHttp().getRequest<FastifyRequest>();
    if (!isAuthorizedActor(request.actor)) throw invalid();
    const body = counterCommand(request.body);
    const booking = await this.db.bookings.findUnique({
      where: { id: body.bookingId },
      select: { property_id: true },
    });
    if (booking === null) throw missing();
    requireCollect(request.actor, { propertyId: booking.property_id, type: body.type });
    return { type: 'USER', id: request.actor.id };
  }
}
