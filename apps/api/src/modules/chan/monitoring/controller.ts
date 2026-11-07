import {
  Controller,
  Get,
  Header,
  HttpCode,
  Inject,
  Param,
  Post,
  Query,
  Req,
  UseInterceptors,
} from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { IdempotencyContext } from '../../../common/idempotency/context.js';
import { Idempotent } from '../../../common/idempotency/decorators.js';
import { Permission } from '../../../common/rbac/permissions.js';
import { actor } from '../../sys/settings/validation.js';
import { ChannelOperationLocationInterceptor } from '../sync/location-interceptor.js';
import { channelIdParam } from '../sync/validation.js';
import { ChannelDeliveryRetryAccess } from './access.js';
import { ChannelMonitoringService } from './service.js';
import { deliveryIdParam, deliveryQuery } from './validation.js';

/**
 * api.md §2.7 — ba đường đọc/retry của SCR-41 (MANAGER/OWNER): trạng thái đồng bộ, danh sách delivery đã
 * che payload, và gửi lại một delivery đã chết. Retry trả **202** + `Location` như mọi tác vụ dài.
 */
@Controller('channels')
export class ChannelMonitoringController {
  constructor(
    @Inject(ChannelMonitoringService) private readonly service: ChannelMonitoringService,
    @Inject(IdempotencyContext) private readonly context: IdempotencyContext,
  ) {}

  @Get(':channelId/sync-status')
  @Header('Cache-Control', 'no-store')
  @Permission('channels.syncStatus')
  syncStatus(@Param('channelId') channelId: string, @Req() request: FastifyRequest) {
    return this.service.syncStatus(actor(request), channelIdParam(channelId));
  }

  @Get(':channelId/outbox-deliveries')
  @Header('Cache-Control', 'no-store')
  @Permission('channels.deliveries')
  deliveries(
    @Param('channelId') channelId: string,
    @Query() query: unknown,
    @Req() request: FastifyRequest,
  ) {
    return this.service.deliveries(actor(request), channelIdParam(channelId), deliveryQuery(query));
  }

  @Post(':channelId/outbox-deliveries/:deliveryId/retry')
  @HttpCode(202)
  @Header('Cache-Control', 'no-store')
  @Permission('channels.deliveryRetry')
  @Idempotent(ChannelDeliveryRetryAccess)
  @UseInterceptors(ChannelOperationLocationInterceptor)
  retry(
    @Param('channelId') channelId: string,
    @Param('deliveryId') deliveryId: string,
    @Req() request: FastifyRequest,
  ) {
    return this.service.retry(
      this.context.transaction(),
      actor(request),
      channelIdParam(channelId),
      deliveryIdParam(deliveryId),
    );
  }
}
