import { Inject, Injectable } from '@nestjs/common';
import type { ExecutionContext } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { IdempotencyAccess } from '../../common/idempotency/decorators.js';
import { actor } from '../sys/settings/validation.js';
import { NotificationsService } from './service.js';
import { notificationId, resendInput } from './validation.js';

/**
 * HB-168/HB-029: `POST /notifications/{notificationId}/resend` (BR-GEN-08).
 *
 * `authorize` chạy **trước mọi claim/phát lại** nên chỉ kiểm phần "quyền hiện tại + tài nguyên":
 * quyền vai trò (đã chặn ở `@Permission`, kiểm lại lần hai như `HousekeepingAccess`), thân lệnh, bản ghi
 * còn tồn tại và còn trong phạm vi cơ sở. Hạn mức 3 lượt và mốc 5 phút là trạng thái nghiệp vụ, để
 * trong handler — bản phát lại cùng khoá phải trả đúng kết quả đã commit dù đã quá 5 phút hay đã cạn lượt.
 */
@Injectable()
export class NotificationResendAccess implements IdempotencyAccess {
  constructor(@Inject(NotificationsService) private readonly service: NotificationsService) {}

  async authorize(context: ExecutionContext) {
    const request = context.switchToHttp().getRequest<FastifyRequest>();
    const current = actor(request);
    const params = z.object({ notificationId: z.unknown() }).parse(request.params);
    const id = notificationId(params.notificationId);
    resendInput(request.body);
    await this.service.authorize(current, id);
    return { type: 'USER' as const, id: current.id };
  }
}
