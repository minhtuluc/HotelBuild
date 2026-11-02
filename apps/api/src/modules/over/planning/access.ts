/** Tiền kiểm `@Idempotent` cho các lệnh trên ca quá tải (HB-125 AC1/AC3). */
import { Inject, Injectable } from '@nestjs/common';
import type { ExecutionContext } from '@nestjs/common';
import type { PrismaClient } from '@prisma/client';
import type { FastifyRequest } from 'fastify';
import { overbookingResolveRequestSchema, relocationPlanRequestSchema } from '@pinehill/contracts';
import type { IdempotencyAccess } from '../../../common/idempotency/decorators.js';
import type { Principal } from '../../../common/idempotency/request.js';
import { PRISMA } from '../../../infrastructure/prisma/prisma.module.js';
import { actorOf, notFound, parse, pathId, requireProperties } from '../support.js';

async function requireCaseScope(
  db: PrismaClient,
  request: FastifyRequest,
  caseId: string,
): Promise<void> {
  const actor = actorOf(request);
  const rows = await db.$queryRaw<
    { property_id: string }[]
  >`SELECT property_id FROM overbooking_cases WHERE id=${caseId}::uuid`;
  const overbooking = rows[0];
  if (overbooking === undefined) throw notFound('Không tìm thấy ca quá tải.');
  requireProperties(actor, [overbooking.property_id]);
}

@Injectable()
export class RelocationPlanAccess implements IdempotencyAccess {
  constructor(@Inject(PRISMA) private readonly db: PrismaClient) {}

  async authorize(context: ExecutionContext): Promise<Principal> {
    const request = context.switchToHttp().getRequest<FastifyRequest>();
    const actor = actorOf(request);
    parse(relocationPlanRequestSchema, request.body);
    await requireCaseScope(this.db, request, pathId(request));
    return { type: 'USER', id: actor.id };
  }
}

@Injectable()
export class OverbookingResolveAccess implements IdempotencyAccess {
  constructor(@Inject(PRISMA) private readonly db: PrismaClient) {}

  async authorize(context: ExecutionContext): Promise<Principal> {
    const request = context.switchToHttp().getRequest<FastifyRequest>();
    const actor = actorOf(request);
    parse(overbookingResolveRequestSchema, request.body);
    await requireCaseScope(this.db, request, pathId(request));
    return { type: 'USER', id: actor.id };
  }
}
