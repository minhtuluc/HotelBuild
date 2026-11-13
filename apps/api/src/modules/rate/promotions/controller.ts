import {
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  Param,
  Post,
  Put,
  Query,
  Req,
  Res,
} from '@nestjs/common';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { Permission } from '../../../common/rbac/permissions.js';
import { Idempotent } from '../../../common/idempotency/decorators.js';
import { IdempotencyContext } from '../../../common/idempotency/context.js';
import { requestActor } from '../calendar/support.js';
import { PromotionsService } from './service.js';
import { PromotionAccess, PromotionUpdateAccess } from './access.js';
import { createInput, listQuery, updateInput } from './validation.js';
import { expectedVersion, uuid } from '../rate-plans/support.js';

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

  /** HB-240 (TD-08): sửa/ngừng khuyến mãi — 204, `If-Match` bắt buộc như gói giá. */
  @Put(':promotionId')
  @HttpCode(204)
  @Permission('promotions.update')
  @Idempotent(PromotionUpdateAccess)
  async update(
    @Param('promotionId') id: string,
    @Body() body: unknown,
    @Req() request: FastifyRequest,
  ) {
    await this.service.update(
      this.context.transaction(),
      requestActor(request),
      uuid(id),
      expectedVersion(request.headers['if-match']),
      updateInput(body),
    );
  }
}
