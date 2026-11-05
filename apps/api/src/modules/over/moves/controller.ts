/**
 * `/room-moves` (HB-125; api.md §3.10). Create trả 201 + Location; duyệt/thực thi trả 200.
 * Mọi lệnh ghi có `Idempotency-Key`; execute bắt buộc `If-Match` của `GET /room-moves/{id}`.
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
import { MoveApproveAccess, MoveCreateAccess, MoveExecuteAccess } from './access.js';
import { RoomMoveService } from './service.js';

@Controller('room-moves')
export class RoomMoveController {
  constructor(
    @Inject(RoomMoveService) private readonly service: RoomMoveService,
    @Inject(IdempotencyContext) private readonly context: IdempotencyContext,
  ) {}

  @Post()
  @Permission('over.move.create')
  @Idempotent(MoveCreateAccess)
  @HttpCode(201)
  @UseInterceptors(
    new LocationInterceptor((_request, body) => `/api/v1/room-moves/${String(body.id)}`),
  )
  async create(@Body() body: unknown, @Req() request: FastifyRequest) {
    const created = await this.service.create(this.context.transaction(), actorOf(request), body);
    return created.body;
  }

  @Get(':id')
  @Permission('over.move.read')
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

  @Post(':id/approve')
  @Permission('over.move.approve')
  @Idempotent(MoveApproveAccess)
  @HttpCode(200)
  approve(@Param('id') id: string, @Body() body: unknown, @Req() request: FastifyRequest) {
    return this.service
      .approve(this.context.transaction(), actorOf(request), id, body)
      .then((result) => result.body);
  }

  @Post(':id/execute')
  @Permission('over.move.execute')
  @Idempotent(MoveExecuteAccess)
  @HttpCode(200)
  execute(
    @Param('id') id: string,
    @Body() body: unknown,
    @Headers('if-match') ifMatch: unknown,
    @Req() request: FastifyRequest,
  ) {
    return this.service
      .execute(this.context.transaction(), actorOf(request), id, body, ifMatch)
      .then((result) => result.body);
  }
}
