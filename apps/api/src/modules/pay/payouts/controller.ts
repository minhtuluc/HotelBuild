/** Controller chi hoàn (HB-100, api.md §2.6): ACCOUNTANT, chỉ hồ sơ APPROVED, đòi `pinToken`. */
import { Body, Controller, HttpCode, Inject, Param, Post, Req } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { Permission } from '../../../common/rbac/permissions.js';
import { Idempotent } from '../../../common/idempotency/decorators.js';
import { IdempotencyContext } from '../../../common/idempotency/context.js';
import { refundId, requestActor } from '../refunds/validation.js';
import { PayoutAccess } from './access.js';
import { PayoutService } from './service.js';
import { payInput } from './validation.js';

@Controller('refund-requests')
export class PayoutController {
  constructor(
    @Inject(PayoutService) private readonly service: PayoutService,
    @Inject(IdempotencyContext) private readonly context: IdempotencyContext,
  ) {}

  /**
   * Tạo chứng từ chi PENDING + operation READY rồi trả **202**: tiền chỉ rời hệ thống khi worker chi và
   * PSP xác nhận (ADR-016); client đọc lại trạng thái qua hồ sơ/đối soát.
   */
  @Post(':refundRequestId/pay')
  @HttpCode(202)
  @Permission('refunds.pay')
  @Idempotent(PayoutAccess)
  pay(
    @Param('refundRequestId') id: unknown,
    @Body() body: unknown,
    @Req() request: FastifyRequest,
  ) {
    return this.service.pay(
      this.context.transaction(),
      requestActor(request),
      refundId(id),
      payInput(body),
    );
  }
}
