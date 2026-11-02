/**
 * `POST /api/v1/integrations/ota/{channel}/bookings` (HB-128; api.md §5.1, §6.3).
 *
 * `@Public()` **có chủ ý** như webhook PSP (HB-095): nguồn gọi là simulator OTA, không phải phiên nhân
 * viên/khách — bảo vệ bằng HMAC của giao thức (`chan/adapters`), không bearer. Vì vậy tuyến này không có
 * dòng oracle RBAC (oracle chỉ soi route có permission); xem `test/rbac/routes/f6-ota-inbox.ts`.
 *
 * Controller không tự thêm mã lỗi: `OtaWebhookService` đã ánh xạ mọi kết cục sang ACK/mã của api.md §4.2.
 */
import { Controller, Inject, Param, Post, Req, Res } from '@nestjs/common';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { Public } from '../../../common/guards/decorators.js';
import type { OtaWebhookAck } from './service.js';
import { OtaWebhookService } from './service.js';

@Public()
@Controller('integrations/ota')
export class OtaWebhookController {
  constructor(@Inject(OtaWebhookService) private readonly service: OtaWebhookService) {}

  @Post(':channel/bookings')
  async receive(
    @Param('channel') channel: string,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<unknown> {
    const ack: OtaWebhookAck = await this.service.receive(channel, request);
    reply.status(ack.status);
    return ack.body;
  }
}
