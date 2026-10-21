/**
 * Tiền kiểm `@Idempotent` của `POST /front-office/check-in` (HB-029 README mục 1).
 *
 * Thân lệnh + quyền/phạm vi trên booking phải quyết được **trước** khi claim khoá idempotency, nếu không
 * lệnh hỏng để lại `idempotency_keys` rác và replay có thể trả kết quả cho người không có quyền.
 * `request.actor` lúc này đã được `RbacGuard` đọc lại từ CSDL cùng tập `propertyScope`. Các cổng
 * nghiệp vụ (trạng thái, sẵn sàng, nợ, 23:59) thuộc service **sau khi khoá** booking.
 */
import { Inject, Injectable } from '@nestjs/common';
import type { ExecutionContext } from '@nestjs/common';
import type { PrismaClient } from '@prisma/client';
import type { FastifyRequest } from 'fastify';
import { isAuthorizedActor } from '../../../common/actor/authorized-actor.js';
import type { IdempotencyAccess } from '../../../common/idempotency/decorators.js';
import type { Principal } from '../../../common/idempotency/request.js';
import { requireProperty } from '../../../common/rbac/scope.js';
import { PRISMA } from '../../../infrastructure/prisma/prisma.module.js';
import { invalid, missing } from './errors.js';
import { command } from './validation.js';

@Injectable()
export class CheckInAccess implements IdempotencyAccess {
  constructor(@Inject(PRISMA) private readonly db: PrismaClient) {}

  async authorize(context: ExecutionContext): Promise<Principal> {
    const request = context.switchToHttp().getRequest<FastifyRequest>();
    if (!isAuthorizedActor(request.actor)) throw invalid();
    const input = command(request.body);
    const booking = await this.db.bookings.findUnique({
      where: { id: input.bookingId },
      select: { property_id: true },
    });
    if (booking === null) throw missing();
    requireProperty(request.actor, booking.property_id);
    return { type: 'USER', id: request.actor.id };
  }
}
