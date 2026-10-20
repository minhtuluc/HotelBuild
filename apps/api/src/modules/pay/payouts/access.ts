/** Cổng khoá chống trùng của lệnh chi (`@Idempotent`): kiểm thân lệnh + phạm vi trước khi claim (HB-097). */
import { Inject, Injectable } from '@nestjs/common';
import type { ExecutionContext } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { IdempotencyAccess } from '../../../common/idempotency/decorators.js';
import { refundId, requestActor } from '../refunds/validation.js';
import { PayoutService } from './service.js';
import { payInput } from './validation.js';

@Injectable()
export class PayoutAccess implements IdempotencyAccess {
  constructor(@Inject(PayoutService) private readonly service: PayoutService) {}

  async authorize(context: ExecutionContext) {
    const request = context.switchToHttp().getRequest<FastifyRequest>();
    const actor = requestActor(request);
    const params = z.object({ refundRequestId: z.unknown() }).parse(request.params);
    const id = refundId(params.refundRequestId);
    // Kiểm cú pháp trước khi khoá chống trùng: thân sai → 400, replay không ăn thân khác.
    payInput(request.body);
    await this.service.authorizeRefundFor(this.service.db, actor, id);
    return { type: 'USER' as const, id: actor.id };
  }
}
