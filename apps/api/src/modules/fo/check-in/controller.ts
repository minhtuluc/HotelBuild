/**
 * `POST /front-office/check-in` (HB-144; api.md §2.9) — lệnh có `Idempotency-Key`.
 * Controller chỉ chuyển thân lệnh; mọi luật trạng thái/sẵn sàng/nợ/23:59 nằm ở service sau khi khoá.
 */
import { Body, Controller, HttpCode, Inject, Post, Req } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import type { CheckInResponse } from '@pinehill/contracts';
import { isAuthorizedActor } from '../../../common/actor/authorized-actor.js';
import { IdempotencyContext } from '../../../common/idempotency/context.js';
import { Idempotent } from '../../../common/idempotency/decorators.js';
import { Permission } from '../../../common/rbac/permissions.js';
import { CheckInAccess } from './access.js';
import { forbidden } from './errors.js';
import { CheckInService } from './service.js';

@Controller('front-office')
export class CheckInController {
  constructor(
    @Inject(CheckInService) private readonly service: CheckInService,
    @Inject(IdempotencyContext) private readonly context: IdempotencyContext,
  ) {}

  @Permission('frontOffice.checkIn')
  @Idempotent(CheckInAccess)
  @Post('check-in')
  @HttpCode(201)
  async checkIn(@Body() body: unknown, @Req() request: FastifyRequest): Promise<CheckInResponse> {
    const actor = request.actor;
    if (!isAuthorizedActor(actor)) throw forbidden();
    return this.service.checkIn(this.context.transaction(), actor, body);
  }
}
