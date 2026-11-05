/**
 * `/room-merges` (HB-125; api.md §3.10, F6-D01/D03). SHARE nhận consent từng bên; CONNECTING một
 * booking hai phòng nên vào thẳng APPROVED và thực thi bằng một `If-Match`.
 */
import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  Inject,
  Param,
  Post,
  Query,
  Req,
  Res,
  UseInterceptors,
} from '@nestjs/common';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { IdempotencyContext } from '../../../common/idempotency/context.js';
import { Idempotent } from '../../../common/idempotency/decorators.js';
import { Permission } from '../../../common/rbac/permissions.js';
import { LocationInterceptor } from '../headers.js';
import { actorOf } from '../support.js';
import {
  MergeApproveAccess,
  MergeConsentAccess,
  MergeCreateAccess,
  MergeExecuteAccess,
} from './access.js';
import { RoomMergeService } from './service.js';

@Controller('room-merges')
export class RoomMergeController {
  constructor(
    @Inject(RoomMergeService) private readonly service: RoomMergeService,
    @Inject(IdempotencyContext) private readonly context: IdempotencyContext,
  ) {}

  @Post()
  @Permission('over.merge.create')
  @Idempotent(MergeCreateAccess)
  @HttpCode(201)
  @UseInterceptors(
    new LocationInterceptor((_request, body) => `/api/v1/room-merges/${String(body.id)}`),
  )
  async create(@Body() body: unknown, @Req() request: FastifyRequest) {
    const created = await this.service.create(this.context.transaction(), actorOf(request), body);
    return created.body;
  }

  @Get(':id')
  @Permission('over.merge.read')
  async read(
    @Param('id') id: string,
    @Query() query: unknown,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    const result = await this.service.read(actorOf(request), id, query);
    reply
      .header('ETag', result.etag)
      .header('Cache-Control', 'no-store')
      .header('Access-Control-Expose-Headers', 'ETag');
    return result.body;
  }

  @Post(':id/consent')
  @Permission('over.merge.consent')
  @Idempotent(MergeConsentAccess)
  @HttpCode(200)
  consent(@Param('id') id: string, @Body() body: unknown, @Req() request: FastifyRequest) {
    return this.service.consent(this.context.transaction(), actorOf(request), id, body);
  }

  @Post(':id/approve')
  @Permission('over.merge.approve')
  @Idempotent(MergeApproveAccess)
  @HttpCode(200)
  approve(@Param('id') id: string, @Body() body: unknown, @Req() request: FastifyRequest) {
    return this.service.approve(this.context.transaction(), actorOf(request), id, body);
  }

  @Post(':id/execute')
  @Permission('over.merge.execute')
  @Idempotent(MergeExecuteAccess)
  @HttpCode(200)
  execute(
    @Param('id') id: string,
    @Body() body: unknown,
    @Headers('if-match') ifMatch: unknown,
    @Req() request: FastifyRequest,
  ) {
    return this.service.execute(this.context.transaction(), actorOf(request), id, body, ifMatch);
  }
}
