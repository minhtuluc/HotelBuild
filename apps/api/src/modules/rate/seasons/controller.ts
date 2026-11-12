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
import { SeasonsService } from './service.js';
import { SeasonAccess, SeasonUpdateAccess } from './access.js';
import { createInput, listQuery, updateInput } from './validation.js';
import { expectedVersion, uuid } from '../rate-plans/support.js';

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

  /** HB-241 (TD-06): sửa/ngừng mùa — 204, `If-Match` bắt buộc như gói giá. */
  @Put(':seasonId')
  @HttpCode(204)
  @Permission('seasons.update')
  @Idempotent(SeasonUpdateAccess)
  async update(
    @Param('seasonId') id: string,
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
