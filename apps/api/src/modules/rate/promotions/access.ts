import { Inject, Injectable } from '@nestjs/common';
import type { ExecutionContext } from '@nestjs/common';
import type { PrismaClient } from '@prisma/client';
import type { FastifyRequest } from 'fastify';
import type { IdempotencyAccess } from '../../../common/idempotency/decorators.js';
import { PRISMA } from '../../../infrastructure/prisma/prisma.module.js';
import { owner, requestActor } from '../calendar/support.js';
import { expectedVersion, missing, paramId } from '../rate-plans/support.js';
import { createInput, updateInput } from './validation.js';

/** Tiền kiểm trước khi giữ khoá idempotency: chỉ OWNER, thân lệnh phải hợp lệ. Khuyến mãi áp toàn chuỗi. */
@Injectable()
export class PromotionAccess implements IdempotencyAccess {
  authorize(context: ExecutionContext) {
    const request = context.switchToHttp().getRequest<FastifyRequest>();
    const actor = owner(requestActor(request));
    createInput(request.body);
    return Promise.resolve({ type: 'USER' as const, id: actor.id });
  }
}

/** HB-240: sửa/ngừng — OWNER, `If-Match` bắt buộc (428), thân hợp lệ, khuyến mãi tồn tại. */
@Injectable()
export class PromotionUpdateAccess implements IdempotencyAccess {
  constructor(@Inject(PRISMA) readonly db: PrismaClient) {}
  async authorize(context: ExecutionContext) {
    const request = context.switchToHttp().getRequest<FastifyRequest>();
    const actor = owner(requestActor(request));
    const id = paramId(request.params, 'promotionId');
    expectedVersion(request.headers['if-match']);
    updateInput(request.body);
    if (!(await this.db.promotions.findUnique({ where: { id }, select: { id: true } })))
      throw missing();
    return { type: 'USER' as const, id: actor.id };
  }
}
