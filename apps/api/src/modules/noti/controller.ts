import {
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  Inject,
  Param,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { IdempotencyContext } from '../../common/idempotency/context.js';
import { Idempotent } from '../../common/idempotency/decorators.js';
import { Permission } from '../../common/rbac/permissions.js';
import { actor } from '../sys/settings/validation.js';
import { NotificationResendAccess } from './access.js';
import { NotificationsService } from './service.js';
import { notificationId, notificationListInput, resendInput } from './validation.js';

/** api.md §2.11 — danh sách thông báo đã gửi + gửi lại có giới hạn (BR-SYS-06). */
@Controller('notifications')
export class NotificationsController {
  constructor(
    @Inject(NotificationsService) private readonly service: NotificationsService,
    @Inject(IdempotencyContext) private readonly context: IdempotencyContext,
  ) {}

  @Get()
  @Header('Cache-Control', 'no-store')
  @Permission('notifications.read')
  list(@Query() query: unknown, @Req() request: FastifyRequest) {
    return this.service.list(actor(request), notificationListInput(query));
  }

  /** Lệnh ghi bắt buộc `Idempotency-Key` (BR-GEN-08): cùng khoá + cùng thân lệnh phát lại kết quả đã commit. */
  @Post(':notificationId/resend')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  @Permission('notifications.resend')
  @Idempotent(NotificationResendAccess)
  resend(
    @Param('notificationId') id: unknown,
    @Body() body: unknown,
    @Req() request: FastifyRequest,
  ) {
    return this.service.resend(
      this.context.transaction(),
      actor(request),
      notificationId(id),
      resendInput(body),
    );
  }
}
