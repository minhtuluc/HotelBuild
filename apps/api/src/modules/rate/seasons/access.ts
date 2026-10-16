import { Inject, Injectable } from '@nestjs/common';
import type { ExecutionContext } from '@nestjs/common';
import type { PrismaClient } from '@prisma/client';
import type { FastifyRequest } from 'fastify';
import type { IdempotencyAccess } from '../../../common/idempotency/decorators.js';
import { PRISMA } from '../../../infrastructure/prisma/prisma.module.js';
import { requireProperty } from '../../../common/rbac/scope.js';
import { missing, owner, requestActor } from '../calendar/support.js';
import { createInput } from './validation.js';

/** Tiền kiểm trước khi giữ khoá idempotency: quyền, thân lệnh và cơ sở đích phải hợp lệ và trong phạm vi. */
@Injectable()
export class SeasonAccess implements IdempotencyAccess {
  constructor(@Inject(PRISMA) private readonly db: PrismaClient) {}

  async authorize(context: ExecutionContext) {
    const request = context.switchToHttp().getRequest<FastifyRequest>();
    const actor = owner(requestActor(request));
    const input = createInput(request.body);
    const property = await this.db.properties.findUnique({
      where: { id: input.propertyId },
      select: { id: true },
    });
    if (!property) throw missing();
    requireProperty(actor, input.propertyId);
    return { type: 'USER' as const, id: actor.id };
  }
}
