import { Inject, Injectable } from '@nestjs/common';
import type { ExecutionContext } from '@nestjs/common';
import type { PrismaClient } from '@prisma/client';
import type { FastifyRequest } from 'fastify';
import type { IdempotencyAccess } from '../../../common/idempotency/decorators.js';
import { PRISMA } from '../../../infrastructure/prisma/prisma.module.js';
import { requestOwner, paramId, expectedVersion, missing } from './support.js';
import { planInput } from './validation.js';
@Injectable()
export class RatePlanAccess implements IdempotencyAccess {
  constructor(@Inject(PRISMA) readonly db: PrismaClient) {}
  async authorize(context: ExecutionContext) {
    const request = context.switchToHttp().getRequest<FastifyRequest>(),
      actor = requestOwner(request);
    const id = paramId(request.params, 'ratePlanId');
    expectedVersion(request.headers['if-match']);
    planInput(request.body);
    if (!(await this.db.rate_plans.findUnique({ where: { id }, select: { id: true } })))
      throw missing();
    return { type: 'USER' as const, id: actor.id };
  }
}
