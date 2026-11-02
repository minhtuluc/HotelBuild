import { Body, Controller, Header, HttpCode, Inject, Param, Post, Req } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { IdempotencyContext } from '../../../common/idempotency/context.js';
import { Idempotent } from '../../../common/idempotency/decorators.js';
import { Permission } from '../../../common/rbac/permissions.js';
import { actor } from '../../sys/settings/validation.js';
import { channelIdParam } from '../sync/validation.js';
import { ChannelSalesClosureAccess } from './access.js';
import { ChannelSalesClosureService } from './service.js';
import { closureInput } from './validation.js';

/**
 * api.md §2.7 — `POST /channels/{channelId}/sales-closure` (MANAGER/OWNER) trả 200 kèm projection đóng
 * bán theo ngày; `closed` mặc định **true** (HB-120 AC14). Lệnh ghi nên bắt buộc `Idempotency-Key`;
 * gọi lại cùng khoá + cùng thân lệnh không nhân đôi audit/outbox/closure.
 */
@Controller('channels')
export class ChannelSalesClosureController {
  constructor(
    @Inject(ChannelSalesClosureService) private readonly service: ChannelSalesClosureService,
    @Inject(IdempotencyContext) private readonly context: IdempotencyContext,
  ) {}

  @Post(':channelId/sales-closure')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  @Permission('channels.salesClosure')
  @Idempotent(ChannelSalesClosureAccess)
  apply(
    @Param('channelId') channelId: string,
    @Body() body: unknown,
    @Req() request: FastifyRequest,
  ) {
    return this.service.apply(
      this.context.transaction(),
      actor(request),
      channelIdParam(channelId),
      closureInput(body),
    );
  }
}
