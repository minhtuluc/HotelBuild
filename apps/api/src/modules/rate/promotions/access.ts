import { Injectable } from '@nestjs/common';
import type { ExecutionContext } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import type { IdempotencyAccess } from '../../../common/idempotency/decorators.js';
import { owner, requestActor } from '../calendar/support.js';
import { createInput } from './validation.js';

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
