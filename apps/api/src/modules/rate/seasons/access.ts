import { Inject, Injectable } from '@nestjs/common';
import type { ExecutionContext } from '@nestjs/common';
import type { PrismaClient } from '@prisma/client';
import type { FastifyRequest } from 'fastify';
import type { IdempotencyAccess } from '../../../common/idempotency/decorators.js';
import { PRISMA } from '../../../infrastructure/prisma/prisma.module.js';
import { requireProperty } from '../../../common/rbac/scope.js';
import { missing, owner, requestActor } from '../calendar/support.js';
import { expectedVersion, paramId } from '../rate-plans/support.js';
import { createInput, updateInput } from './validation.js';

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

/**
 * HB-241: sửa/ngừng mùa — OWNER, `If-Match` bắt buộc (428), thân hợp lệ, mùa **gắn cơ sở** tồn tại và
 * cơ sở đó trong phạm vi người sửa. Mùa toàn chuỗi không đi tuyến này (như `GET /seasons`).
 */
@Injectable()
export class SeasonUpdateAccess implements IdempotencyAccess {
  constructor(@Inject(PRISMA) private readonly db: PrismaClient) {}

  async authorize(context: ExecutionContext) {
    const request = context.switchToHttp().getRequest<FastifyRequest>();
    const actor = owner(requestActor(request));
    const id = paramId(request.params, 'seasonId');
    expectedVersion(request.headers['if-match']);
    updateInput(request.body);
    const season = await this.db.seasons.findUnique({
      where: { id },
      select: { property_id: true },
    });
    if (season?.property_id === null || season === null) throw missing();
    requireProperty(actor, season.property_id);
    return { type: 'USER' as const, id: actor.id };
  }
}
