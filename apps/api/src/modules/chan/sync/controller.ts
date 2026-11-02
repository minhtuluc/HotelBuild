import {
  Body,
  Controller,
  Header,
  HttpCode,
  Inject,
  Param,
  Post,
  Req,
  UseInterceptors,
} from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { IdempotencyContext } from '../../../common/idempotency/context.js';
import { Idempotent } from '../../../common/idempotency/decorators.js';
import { Permission } from '../../../common/rbac/permissions.js';
import { actor } from '../../sys/settings/validation.js';
import { ChannelSyncAccess } from './access.js';
import { ChannelOperationLocationInterceptor } from './location-interceptor.js';
import { ChannelSyncService } from './service.js';
import { channelIdParam, syncInput } from './validation.js';

/**
 * api.md §2.7 — `POST /channels/{channelId}/sync` trả **202** `{operationId,status,statusUrl}` + `Location`
 * (NFR-COMP-04). Quyền MANAGER/OWNER; scope cơ sở kiểm trong `ChannelSyncAccess` và kiểm lại trong
 * transaction của service.
 */
@Controller('channels')
export class ChannelSyncController {
  constructor(
    @Inject(ChannelSyncService) private readonly service: ChannelSyncService,
    @Inject(IdempotencyContext) private readonly context: IdempotencyContext,
  ) {}

  @Post(':channelId/sync')
  @HttpCode(202)
  @Header('Cache-Control', 'no-store')
  @Permission('channels.sync')
  @Idempotent(ChannelSyncAccess)
  @UseInterceptors(ChannelOperationLocationInterceptor)
  sync(
    @Param('channelId') channelId: string,
    @Body() body: unknown,
    @Req() request: FastifyRequest,
  ) {
    return this.service.request(
      this.context.transaction(),
      actor(request),
      channelIdParam(channelId),
      syncInput(body),
    );
  }
}
