/**
 * `POST /guest-auth/password-reset/request` (202) và `/confirm` (204) — công khai (api.md §2.1, QĐ-03 T7).
 * Thân lệnh là `strictObject`: không nhận email/guestId do client khai (chống gửi thư tới địa chỉ kẻ tấn công
 * và chiếm tài khoản); SĐT sai dáng → 422 `E_CRM_PHONE_INVALID` do service chuẩn hoá.
 */
import { Body, Controller, HttpCode, Inject, Post, Req } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { z } from 'zod';
import { passwordResetConfirmRequestSchema } from '@pinehill/contracts';
import { AppError } from '../../../../common/app-error.js';
import { Public } from '../../../../common/guards/decorators.js';
import { PasswordResetService } from './service.js';
import type { RequestContext } from './service.js';

/** Dáng thô của SĐT; `normalizePhone` mới quyết định hợp lệ (nhận cả `0…` lẫn `+84…`). */
const requestBodySchema = z.strictObject({ phone: z.string().min(1).max(32) });

function validationError(): AppError {
  return new AppError(400, 'E_GEN_VALIDATION_FAILED', 'Yêu cầu không hợp lệ.');
}

function contextOf(request: FastifyRequest): RequestContext {
  const header = request.headers['x-correlation-id'];
  return {
    ip: request.ip ?? null,
    correlationId: typeof header === 'string' && header !== '' ? header : (request.id ?? ''),
  };
}

@Controller('guest-auth/password-reset')
export class PasswordResetController {
  constructor(@Inject(PasswordResetService) private readonly service: PasswordResetService) {}

  @Public()
  @Post('request')
  @HttpCode(202)
  async request(@Body() body: unknown, @Req() request: FastifyRequest): Promise<void> {
    const parsed = requestBodySchema.safeParse(body);
    if (!parsed.success) throw validationError();
    await this.service.request(parsed.data.phone, contextOf(request));
  }

  @Public()
  @Post('confirm')
  @HttpCode(204)
  async confirm(@Body() body: unknown, @Req() request: FastifyRequest): Promise<void> {
    const parsed = passwordResetConfirmRequestSchema.safeParse(body);
    if (!parsed.success) throw validationError();
    await this.service.confirm(parsed.data.token, parsed.data.newPassword, contextOf(request));
  }
}
