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
  Res,
} from '@nestjs/common';
import type { FastifyRequest, FastifyReply } from 'fastify';
import { Permission } from '../../../common/rbac/permissions.js';
import { Idempotent } from '../../../common/idempotency/decorators.js';
import { IdempotencyContext } from '../../../common/idempotency/context.js';
import { CancelService } from './service.js';
import { CancelAccess } from './access.js';
import { bookingId, cancelInput, previewAnchor, previewInput, requestActor } from './validation.js';

@Controller('bookings/:bookingId')
export class CancelController {
  constructor(
    @Inject(CancelService) private readonly service: CancelService,
    @Inject(IdempotencyContext) private readonly context: IdempotencyContext,
  ) {}

  /** AC1: xem trước thuần đọc; ETag là neo để `cancel` kiểm lại mốc giờ/version. */
  @Post('cancel-preview')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  @Permission('bookings.cancelPreview')
  async preview(
    @Param('bookingId') id: unknown,
    @Body() body: unknown,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    const { body: preview, tag } = await this.service.preview(
      requestActor(request),
      bookingId(id),
      previewInput(body),
    );
    reply.header('ETag', tag);
    return preview;
  }

  /** AC1–AC4: kiểm lại xem trước trong transaction, lập yêu cầu hoàn + giữ hạn mức nguyên tử. */
  @Post('cancel')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  @Permission('bookings.cancel')
  @Idempotent(CancelAccess)
  cancel(
    @Param('bookingId') id: unknown,
    @Body() body: unknown,
    @Headers('if-match') tag: unknown,
    @Req() request: FastifyRequest,
  ) {
    return this.service.cancel(
      this.context.transaction(),
      requestActor(request),
      bookingId(id),
      cancelInput(body),
      previewAnchor(tag),
    );
  }
}
