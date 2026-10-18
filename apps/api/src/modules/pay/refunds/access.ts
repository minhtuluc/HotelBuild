/** Cổng khoá chống trùng (`@Idempotent`): kiểm thân lệnh + phạm vi trước khi claim (HB-097 pattern). */
import { Inject, Injectable } from '@nestjs/common';
import type { ExecutionContext } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { z } from 'zod';
import { RefundService } from './service.js';
import {
  approveInput,
  cancelInput,
  createInput,
  refundError,
  refundId,
  rejectInput,
  requestActor,
} from './validation.js';
import type { IdempotencyAccess } from '../../../common/idempotency/decorators.js';

/** Bốn lệnh ghi của hợp đồng §3.6/§3.7 đều bắt buộc `Idempotency-Key`. */
type RefundAction = 'approve' | 'reject' | 'cancel' | 'create';

const actionOf = (url: string): RefundAction => {
  const path = url.split('?')[0]!;
  if (path.endsWith('/approve')) return 'approve';
  if (path.endsWith('/reject')) return 'reject';
  if (path.endsWith('/cancel')) return 'cancel';
  return 'create';
};

@Injectable()
export class RefundAccess implements IdempotencyAccess {
  constructor(@Inject(RefundService) private readonly service: RefundService) {}

  async authorize(context: ExecutionContext) {
    const request = context.switchToHttp().getRequest<FastifyRequest>();
    const actor = requestActor(request);
    // Kiểm cú pháp trước khi khoá chống trùng: thân sai → 400, replay không ăn thân khác.
    const bookingId = await this.target(actionOf(request.url), request);
    await this.service.authorizeFor(this.service.db, actor, bookingId);
    return { type: 'USER' as const, id: actor.id };
  }

  /** Booking mà lệnh tác động: từ thân lệnh khi lập hồ sơ, từ hồ sơ đích khi quyết định. */
  private async target(action: RefundAction, request: FastifyRequest): Promise<string> {
    if (action === 'create') return createInput(request.body).bookingId;
    const params = z.object({ refundRequestId: z.unknown() }).parse(request.params);
    const id = refundId(params.refundRequestId);
    if (action === 'approve') approveInput(request.body);
    else if (action === 'reject') rejectInput(request.body);
    else cancelInput(request.body);
    const found = await this.service.db.refund_requests.findUnique({
      where: { id },
      select: { booking_id: true },
    });
    if (!found) throw refundError('missing');
    return found.booking_id;
  }
}
