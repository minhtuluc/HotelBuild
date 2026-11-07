import { Controller, Get, Header, Inject, Param, Query, Req } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { Permission } from '../../../common/rbac/permissions.js';
import { actor } from '../../sys/settings/validation.js';
import { channelIdParam } from '../sync/validation.js';
import { ChannelOtaBookingsService } from './service.js';
import { queueQuery } from './validation.js';

/**
 * api.md §2.7 — `GET /channels/{channelId}/ota-bookings` (MANAGER/OWNER): hàng đợi booking OTA trong
 * scope cơ sở, phân trang keyset ổn định, DTO đã che PII/payload.
 */
@Controller('channels')
export class ChannelOtaBookingsController {
  constructor(
    @Inject(ChannelOtaBookingsService) private readonly service: ChannelOtaBookingsService,
  ) {}

  @Get(':channelId/ota-bookings')
  @Header('Cache-Control', 'no-store')
  @Permission('channels.otaBookings')
  list(
    @Param('channelId') channelId: string,
    @Query() query: unknown,
    @Req() request: FastifyRequest,
  ) {
    return this.service.list(actor(request), channelIdParam(channelId), queueQuery(query));
  }
}
