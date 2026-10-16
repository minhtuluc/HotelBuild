import { Body, Controller, Get, HttpCode, Inject, Post, Query, Req, Res } from '@nestjs/common';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { Permission } from '../../../common/rbac/permissions.js';
import { Idempotent } from '../../../common/idempotency/decorators.js';
import { IdempotencyContext } from '../../../common/idempotency/context.js';
import { requestActor } from '../calendar/support.js';
import { SeasonsService } from './service.js';
import { SeasonAccess } from './access.js';
import { createInput, listQuery } from './validation.js';

@Controller('seasons')
export class SeasonsController {
  constructor(
    @Inject(SeasonsService) private readonly service: SeasonsService,
    @Inject(IdempotencyContext) private readonly context: IdempotencyContext,
  ) {}

  @Get()
  @Permission('seasons.read')
  list(
    @Query() query: unknown,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    reply.header('cache-control', 'no-store');
    return this.service.list(requestActor(request), listQuery(query));
  }

  /** Lệnh tạo mùa trả 201 rỗng như `createSeason` của `@pinehill/api-client` chờ đợi. */
  @Post()
  @HttpCode(201)
  @Permission('seasons.create')
  @Idempotent(SeasonAccess)
  async create(@Body() body: unknown, @Req() request: FastifyRequest) {
    await this.service.create(this.context.transaction(), requestActor(request), createInput(body));
  }
}
