/**
 * `GET /api/v1/integrations/psp/vnpay/callback` (IPN query string) và
 * `POST /api/v1/integrations/psp/momo/callback` (IPN JSON) (HB-095; api.md §5.2).
 *
 * `@Public()` **có chủ ý** như các tuyến PSP của HB-094: nguồn gọi là cổng thanh toán, không phải
 * phiên nhân viên/khách — bảo vệ bằng chữ ký của chính giao thức (constant-time qua `pay/psp`),
 * không phải phiên đăng nhập. GET có tác dụng ghi là ngoại lệ do giao thức cổng quy định, không áp
 * cache HTTP. Mọi lời gọi đều ánh xạ thành ACK theo cổng; controller không tự thêm mã lỗi nào.
 */
import { Body, Controller, Get, Inject, Post, Req, Res } from '@nestjs/common';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { PspMethod } from '../psp/port.js';
import { Public } from '../../../common/guards/decorators.js';
import type { CallbackAck, WebhookContext } from './contract.js';
import { PspWebhookService } from './service.js';

/** Chuỗi truy vấn **nguyên bản** đúng byte cổng gửi: VNPay ký trên tham số URL-encoded. */
function rawQuery(request: FastifyRequest): string {
  const url = request.raw.url ?? '';
  const separator = url.indexOf('?');
  return separator === -1 ? '' : url.slice(separator + 1);
}

/** Thân MoMo đã parse; adapter ký lại theo danh sách trường của giao thức nên vòng JSON giữ nguyên giá trị. */
function rawIpn(body: unknown): string {
  return typeof body === 'string' ? body : JSON.stringify(body);
}

@Public()
@Controller('integrations/psp')
export class PspWebhookController {
  constructor(@Inject(PspWebhookService) private readonly service: PspWebhookService) {}

  @Get('vnpay/callback')
  async vnpay(
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<unknown> {
    return this.respond('VNPAY', rawQuery(request), request, reply);
  }

  @Post('momo/callback')
  async momo(
    @Body() body: unknown,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<unknown> {
    return this.respond('MOMO', rawIpn(body), request, reply);
  }

  /** ACK đã bền: dữ liệu inbox đã commit trước khi trả về (ADR-017 §5); mã lặp lại cho bản phát lại. */
  private async respond(
    method: PspMethod,
    raw: string,
    request: FastifyRequest,
    reply: FastifyReply,
  ): Promise<unknown> {
    const context: WebhookContext = { correlationId: String(request.id), ip: request.ip ?? null };
    const ack: CallbackAck = await this.service.receive(method, raw, context);
    reply.status(ack.httpStatus);
    return ack.body ?? undefined;
  }
}
