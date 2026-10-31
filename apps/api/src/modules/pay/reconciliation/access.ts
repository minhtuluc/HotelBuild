/**
 * Tiền kiểm `@Idempotent` của `POST /reconciliation/daily/close` (HB-150; HB-029 README mục 1).
 *
 * Kiểm chủ thể + cú pháp thân lệnh + sự tồn tại cơ sở + phạm vi cơ sở **trước** khi claim khoá
 * idempotency để thân hỏng (như thân oracle `{}`) trả 400 ngay và không tạo khoá rác.
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
import { isUuid, reconciliationCommand, requireReconcile } from './principal.js';

@Injectable()
export class ReconciliationAccess implements IdempotencyAccess {
  constructor(@Inject(PRISMA) private readonly db: PrismaClient) {}

  async authorize(context: ExecutionContext): Promise<Principal> {
    const request = context.switchToHttp().getRequest<FastifyRequest>();
    if (!isAuthorizedActor(request.actor)) throw invalid();
    const body = reconciliationCommand(request.body);
    if (!isUuid(body.propertyId)) throw missing();
    const property = await this.db.properties.findUnique({
      where: { id: body.propertyId },
      select: { id: true },
    });
    if (property === null) throw missing();
    requireReconcile(request.actor, property.id);
    return { type: 'USER', id: request.actor.id };
  }
}
