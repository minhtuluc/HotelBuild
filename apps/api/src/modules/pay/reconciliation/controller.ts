/**
 * `POST /reconciliation/daily/close` (HB-150; api.md §2.6, §6.1; UC-PAY-05; BR-PAY-06, BR-PAY-10).
 *
 * Lệnh chốt đối soát ngày theo `(người thu, ngày VN)`, bảo vệ bằng `@Permission('reconciliation.close')`,
 * `@Idempotent(ReconciliationAccess)` và `pinToken` một lần trong transaction.
 */
import { Body, Controller, HttpCode, Inject, Post, Req } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import type { ReconciliationCloseResponse } from '@pinehill/contracts';
import { isAuthorizedActor } from '../../../common/actor/authorized-actor.js';
import { IdempotencyContext } from '../../../common/idempotency/context.js';
import { Idempotent } from '../../../common/idempotency/decorators.js';
import { Permission } from '../../../common/rbac/permissions.js';
import { ReconciliationAccess } from './access.js';
import { forbidden } from './errors.js';
import { ReconciliationService } from './service.js';

@Controller('reconciliation/daily')
export class ReconciliationController {
  constructor(
    @Inject(ReconciliationService) private readonly service: ReconciliationService,
    @Inject(IdempotencyContext) private readonly context: IdempotencyContext,
  ) {}

  @Permission('reconciliation.close')
  @Idempotent(ReconciliationAccess)
  @Post('close')
  @HttpCode(201)
  async close(
    @Body() body: unknown,
    @Req() request: FastifyRequest,
  ): Promise<ReconciliationCloseResponse> {
    const actor = request.actor;
    if (!isAuthorizedActor(actor)) throw forbidden();
    return this.service.closeDaily(this.context.transaction(), actor, body);
  }
}
