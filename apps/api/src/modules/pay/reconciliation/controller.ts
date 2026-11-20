/**
 * `POST /reconciliation/daily/close` (HB-150; api.md §2.6, §6.1; UC-PAY-05; BR-PAY-06, BR-PAY-10).
 *
 * Lệnh chốt đối soát ngày theo `(người thu, ngày VN)`, bảo vệ bằng `@Permission('reconciliation.close')`,
 * `@Idempotent(ReconciliationAccess)` và `pinToken` một lần trong transaction.
 */
import { Body, Controller, Get, Header, HttpCode, Inject, Post, Query, Req } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import type { PrismaClient } from '@prisma/client';
import type { Clock } from '@pinehill/domain';
import type { ReconciliationCloseResponse, ReconciliationDaily } from '@pinehill/contracts';
import { isAuthorizedActor } from '../../../common/actor/authorized-actor.js';
import { IdempotencyContext } from '../../../common/idempotency/context.js';
import { Idempotent } from '../../../common/idempotency/decorators.js';
import { Permission } from '../../../common/rbac/permissions.js';
import { CLOCK } from '../../../infrastructure/ports.js';
import { PRISMA } from '../../../infrastructure/prisma/prisma.module.js';
import { ReconciliationAccess } from './access.js';
import { dailySummary } from './daily.js';
import { forbidden } from './errors.js';
import { ReconciliationService } from './service.js';

@Controller('reconciliation/daily')
export class ReconciliationController {
  constructor(
    @Inject(ReconciliationService) private readonly service: ReconciliationService,
    @Inject(IdempotencyContext) private readonly context: IdempotencyContext,
    @Inject(PRISMA) private readonly db: PrismaClient,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  /** HB-262 (SCR-68): tổng tiền mặt theo người thu trong ngày VN; lễ tân chỉ thấy dòng của mình. */
  @Permission('reconciliation.read')
  @Get()
  @Header('Cache-Control', 'no-store')
  async daily(
    @Query() query: unknown,
    @Req() request: FastifyRequest,
  ): Promise<ReconciliationDaily> {
    const actor = request.actor;
    if (!isAuthorizedActor(actor)) throw forbidden();
    return dailySummary(this.db, this.clock, actor, query);
  }

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
