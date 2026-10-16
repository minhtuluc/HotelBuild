import {
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  Param,
  Put,
  Query,
  Req,
  Res,
} from '@nestjs/common';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { Permission } from '../../../common/rbac/permissions.js';
import { Idempotent } from '../../../common/idempotency/decorators.js';
import { IdempotencyContext } from '../../../common/idempotency/context.js';
import { RateCalendarService } from './service.js';
import { RateCalendarAccess } from './access.js';
import { requestActor } from './support.js';
import { calendarQuery, overrideInput } from './validation.js';

@Controller('room-types/:roomTypeId/rate-calendar')
export class RateCalendarController {
  constructor(
    @Inject(RateCalendarService) private readonly service: RateCalendarService,
    @Inject(IdempotencyContext) private readonly context: IdempotencyContext,
  ) {}

  @Get()
  @Permission('rateCalendar.read')
  get(
    @Param('roomTypeId') roomTypeId: string,
    @Query() query: unknown,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    // Giá là cấu hình sống: không để proxy/cache phục vụ bản cũ.
    reply.header('cache-control', 'no-store');
    return this.service.get(requestActor(request), calendarQuery(roomTypeId, query));
  }

  /** Lệnh sinh bản ghi giá mới nên **không** có `If-Match` (api.md §2.4); chống trùng bằng khoá idempotency. */
  @Put()
  @HttpCode(200)
  @Permission('rateCalendar.override')
  @Idempotent(RateCalendarAccess)
  override(
    @Param('roomTypeId') roomTypeId: string,
    @Body() body: unknown,
    @Req() request: FastifyRequest,
  ) {
    return this.service.override(
      this.context.transaction(),
      requestActor(request),
      overrideInput(roomTypeId, body),
    );
  }
}
