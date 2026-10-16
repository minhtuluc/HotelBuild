import { Inject, Injectable } from '@nestjs/common';
import type { ExecutionContext } from '@nestjs/common';
import type { PrismaClient } from '@prisma/client';
import type { FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { IdempotencyAccess } from '../../../common/idempotency/decorators.js';
import { PRISMA } from '../../../infrastructure/prisma/prisma.module.js';
import { requireProperty } from '../../../common/rbac/scope.js';
import { invalid, missing, owner, requestActor } from './support.js';
import { overrideInput } from './validation.js';

const params = z.object({ roomTypeId: z.unknown() });

/**
 * Tiền kiểm trước khi giữ khoá idempotency (HB-029): quyền, thân lệnh, loại phòng tồn tại và nằm
 * trong phạm vi cơ sở. Lệnh sai không để lại `idempotency_keys` rác.
 */
@Injectable()
export class RateCalendarAccess implements IdempotencyAccess {
  constructor(@Inject(PRISMA) private readonly db: PrismaClient) {}

  async authorize(context: ExecutionContext) {
    const request = context.switchToHttp().getRequest<FastifyRequest>();
    const actor = owner(requestActor(request));
    const parsed = params.safeParse(request.params);
    if (!parsed.success) throw invalid();
    const input = overrideInput(parsed.data.roomTypeId, request.body);
    const type = await this.db.room_types.findUnique({
      where: { id: input.roomTypeId },
      select: { property_id: true },
    });
    if (!type) throw missing();
    requireProperty(actor, type.property_id);
    return { type: 'USER' as const, id: actor.id };
  }
}
