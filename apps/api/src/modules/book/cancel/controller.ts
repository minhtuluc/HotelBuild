import {
  Body,
  Controller,
  Header,
  Headers,
  HttpCode,
  Inject,
  Param,
  Post,
  Query,
  Req,
  Res,
} from '@nestjs/common';
import type { FastifyRequest, FastifyReply } from 'fastify';
import type { PrismaClient } from '@prisma/client';
import type { Clock } from '@pinehill/domain';
import { Public } from '../../../common/guards/decorators.js';
import { PermissionRegistry } from '../../../common/rbac/permission-registry.js';
import { CONFIG } from '../../../config/env.js';
import type { ApiConfig } from '../../../config/env.js';
import { CLOCK } from '../../../infrastructure/ports.js';
import { PRISMA } from '../../../infrastructure/prisma/prisma.module.js';
import { cancelCaller } from './caller.js';
import { Idempotent } from '../../../common/idempotency/decorators.js';
import { IdempotencyContext } from '../../../common/idempotency/context.js';
import { CancelService } from './service.js';
import { CancelAccess } from './access.js';
import { bookingId, cancelInput, previewInput, previewRooms } from './validation.js';

/**
 * HB-256: hai tuyến `@Public` để **khách tự huỷ** booking của mình (api.md §2.5); chủ thể tự xác thực ở
 * `cancelCaller` — nhân viên vẫn cần `bookings.cancelPreview`/`bookings.cancel` như trước.
 */
@Controller('bookings/:bookingId')
export class CancelController {
  constructor(
    @Inject(CancelService) private readonly service: CancelService,
    @Inject(IdempotencyContext) private readonly context: IdempotencyContext,
    @Inject(PRISMA) readonly db: PrismaClient,
    @Inject(CONFIG) readonly config: ApiConfig,
    @Inject(CLOCK) readonly clock: Clock,
    @Inject(PermissionRegistry) readonly permissions: PermissionRegistry,
  ) {}

  /**
   * AC1: xem trước thuần đọc; `ETag` là neo **bắt buộc** cho `cancel` (mốc phiên bản + vân tay cả kết quả).
   * `?bookingRoomIds=` chọn cùng tập phòng với lệnh huỷ (thân lệnh đã chốt chỉ có `reason`/`isForceMajeure`).
   */
  @Public()
  @Post('cancel-preview')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  async preview(
    @Param('bookingId') id: unknown,
    @Body() body: unknown,
    @Query() query: unknown,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    const { body: preview, tag } = await this.service.preview(
      await cancelCaller(this, request, 'bookings.cancelPreview'),
      bookingId(id),
      previewInput(body),
      previewRooms(query),
    );
    reply.header('ETag', tag);
    return preview;
  }

  /** AC1–AC4: kiểm lại xem trước trong transaction, lập yêu cầu hoàn + giữ hạn mức nguyên tử. */
  @Public()
  @Post('cancel')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  @Idempotent(CancelAccess)
  async cancel(
    @Param('bookingId') id: unknown,
    @Body() body: unknown,
    @Headers('if-match') tag: unknown,
    @Req() request: FastifyRequest,
  ) {
    return this.service.cancel(
      this.context.transaction(),
      await cancelCaller(this, request, 'bookings.cancel'),
      bookingId(id),
      cancelInput(body),
      tag,
    );
  }
}
