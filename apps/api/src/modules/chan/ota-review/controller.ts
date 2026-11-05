import {
  Body,
  Controller,
  Header,
  Headers,
  HttpCode,
  Inject,
  Param,
  Post,
  Req,
  UseInterceptors,
} from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { Permission } from '../../../common/rbac/permissions.js';
import { isAuthorizedActor } from '../../../common/actor/authorized-actor.js';
import { Idempotent } from '../../../common/idempotency/decorators.js';
import { IdempotencyContext } from '../../../common/idempotency/context.js';
import { OtaReviewService } from './service.js';
import { OtaReviewAccess } from './access.js';
import { OtaReviewETagInterceptor } from './etag-interceptor.js';
import { expectedVersion, flagInput, forbidden, params } from './validation.js';

/**
 * AC12 — `POST /channels/{channelId}/ota-bookings/{bookingId}/duplicate-flag`.
 *
 * Thứ tự kiểm tra là hợp đồng: thân lệnh (400) → `If-Match` (428/412) → định danh trong URL (400).
 * Nhờ vậy một yêu cầu sai hình dạng không bao giờ chạm CSDL, và mã lỗi không phụ thuộc việc booking
 * có tồn tại hay không.
 */
@Controller('channels/:channelId/ota-bookings')
export class OtaReviewController {
  constructor(
    @Inject(OtaReviewService) private readonly service: OtaReviewService,
    @Inject(IdempotencyContext) private readonly context: IdempotencyContext,
  ) {}

  @Post(':bookingId/duplicate-flag')
  @HttpCode(200)
  @Header('Access-Control-Expose-Headers', 'ETag')
  @Permission('otaBookings.review')
  @Idempotent(OtaReviewAccess)
  @UseInterceptors(OtaReviewETagInterceptor)
  async flag(
    @Param() rawParams: unknown,
    @Body() body: unknown,
    @Headers('if-match') tag: unknown,
    @Req() request: FastifyRequest,
  ) {
    const input = flagInput(body);
    const expected = expectedVersion(tag);
    const scope = params(rawParams);
    if (!isAuthorizedActor(request.actor)) throw forbidden();
    return this.service.review(this.context.transaction(), request.actor, {
      channelId: scope.channelId,
      bookingId: scope.bookingId,
      flagged: input.flagged,
      reason: input.reason,
      expected,
    });
  }
}
