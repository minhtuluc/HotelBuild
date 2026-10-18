/**
 * HTTP PIN (HB-015; api.md §2.1): `POST /auth/pin/verify`, `PUT /auth/pin`,
 * `DELETE /users/{userId}/pin`. Quyền tối thiểu và phạm vi cơ sở do `@Permission` +
 * `RbacGuard` (HB-014) và `PinService` thực thi; thân yêu cầu kiểm bằng schema hợp đồng.
 *
 * Không dùng middleware idempotency chung cho `POST /auth/pin/verify`: phản hồi chứa `pinToken`
 * nên bộ chuẩn hoá sẽ từ chối (`common/idempotency/README.md` mục 5). `PUT`/`DELETE` là ghi
 * idempotent tự nhiên (upsert/deleteMany) và theo khuôn auth hiện hành (audit trong transaction).
 */
import { Body, Controller, Delete, HttpCode, Inject, Param, Post, Put, Req } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { pinVerifyRequestSchema, setPinRequestSchema } from '@pinehill/contracts';
import type { PinToken } from '@pinehill/contracts';
import { AppError } from '../../../common/app-error.js';
import { isAuthorizedActor } from '../../../common/actor/authorized-actor.js';
import { invalidCredentials } from '../../../common/guards/auth.guard.js';
import { Permission } from '../../../common/rbac/permissions.js';
import { PinService } from './service.js';

function validationError(): AppError {
  return new AppError(400, 'E_GEN_VALIDATION_FAILED', 'Yêu cầu không hợp lệ.');
}

function requireActor(request: FastifyRequest) {
  if (!isAuthorizedActor(request.actor)) throw invalidCredentials();
  return request.actor;
}

@Controller('auth')
export class PinController {
  constructor(@Inject(PinService) private readonly pin: PinService) {}

  @Permission('pin.verify')
  @Post('pin/verify')
  @HttpCode(200)
  async verify(@Body() body: unknown, @Req() request: FastifyRequest): Promise<PinToken> {
    const parsed = pinVerifyRequestSchema.safeParse(body);
    if (!parsed.success) throw validationError();
    return this.pin.verify(requireActor(request), parsed.data);
  }

  @Permission('pin.set')
  @Put('pin')
  @HttpCode(204)
  async set(@Body() body: unknown, @Req() request: FastifyRequest): Promise<void> {
    const parsed = setPinRequestSchema.safeParse(body);
    if (!parsed.success) throw validationError();
    await this.pin.set(requireActor(request), parsed.data);
  }
}

@Controller('users')
export class UserPinController {
  constructor(@Inject(PinService) private readonly pin: PinService) {}

  @Permission('pin.delete')
  @Delete(':userId/pin')
  @HttpCode(204)
  async remove(@Param('userId') userId: string, @Req() request: FastifyRequest): Promise<void> {
    await this.pin.remove(requireActor(request), userId);
  }
}
