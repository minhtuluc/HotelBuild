import { Body, Controller, Get, HttpCode, Inject, Post, Query, Req, Res } from '@nestjs/common';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { Permission } from '../../../common/rbac/permissions.js';
import { Idempotent } from '../../../common/idempotency/decorators.js';
import { IdempotencyContext } from '../../../common/idempotency/context.js';
import { requestActor } from '../calendar/support.js';
import { PromotionsService } from './service.js';
import { PromotionAccess } from './access.js';
import { createInput, listQuery } from './validation.js';

@Controller('promotions')
export class PromotionsController {
  constructor(
    @Inject(PromotionsService) private readonly service: PromotionsService,
    @Inject(IdempotencyContext) private readonly context: IdempotencyContext,
  ) {}

  @Get()
  @Permission('promotions.read')
  list(
    @Query() query: unknown,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    reply.header('cache-control', 'no-store');
    return this.service.list(requestActor(request), listQuery(query));
  }

  /** 201 rỗng như `createPromotion` (`requestVoid`) của `@pinehill/api-client` chờ đợi. */
  @Post()
  @HttpCode(201)
  @Permission('promotions.create')
  @Idempotent(PromotionAccess)
  async create(@Body() body: unknown, @Req() request: FastifyRequest) {
    await this.service.create(this.context.transaction(), requestActor(request), createInput(body));
  }
}
