/**
 * Controller auth (UC-AUTH-01; api.md §1.2): login/refresh/logout/đổi mật khẩu/me.
 * Login/refresh công khai; logout/password cho phép cả khi tài khoản đang buộc đổi mật khẩu (QĐ-03 quyết định 8).
 */
import { Body, Controller, Get, HttpCode, Inject, Post, Req } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import {
  changePasswordRequestSchema,
  loginRequestSchema,
  refreshRequestSchema,
} from '@pinehill/contracts';
import type { TokenPair, UserMe } from '@pinehill/contracts';
import { AppError } from '../../common/app-error.js';
import { invalidCredentials } from '../../common/guards/auth.guard.js';
import { AllowPasswordChange, Public } from '../../common/guards/decorators.js';
import type { AuthenticatedActor } from '../../common/actor/actor-context.js';
import { Permission } from '../../common/rbac/permissions.js';
import { AuthService } from './auth.service.js';

function validationError(): AppError {
  return new AppError(400, 'E_GEN_VALIDATION_FAILED', 'Yêu cầu không hợp lệ.');
}

function correlationId(request: FastifyRequest): string {
  const header = request.headers['x-correlation-id'];
  return typeof header === 'string' && header !== '' ? header : (request.id ?? '');
}

function requireActor(request: FastifyRequest): AuthenticatedActor {
  if (request.actor === undefined) throw invalidCredentials();
  return request.actor;
}

@Controller('auth')
export class AuthController {
  constructor(@Inject(AuthService) private readonly auth: AuthService) {}

  @Public()
  @Post('login')
  @HttpCode(200)
  async login(@Body() body: unknown, @Req() request: FastifyRequest): Promise<TokenPair> {
    const parsed = loginRequestSchema.safeParse(body);
    if (!parsed.success) throw validationError();
    return this.auth.login(parsed.data, {
      ip: request.ip ?? null,
      correlationId: correlationId(request),
    });
  }

  @Public()
  @Post('refresh')
  @HttpCode(200)
  async refresh(@Body() body: unknown): Promise<TokenPair> {
    const parsed = refreshRequestSchema.safeParse(body);
    if (!parsed.success) throw validationError();
    return this.auth.refresh(parsed.data.refreshToken);
  }

  @AllowPasswordChange()
  @Permission('auth.logout')
  @Post('logout')
  @HttpCode(204)
  async logout(@Req() request: FastifyRequest): Promise<void> {
    await this.auth.logout(requireActor(request).sessionId);
  }

  @AllowPasswordChange()
  @Permission('auth.password')
  @Post('password')
  @HttpCode(204)
  async changePassword(@Body() body: unknown, @Req() request: FastifyRequest): Promise<void> {
    const parsed = changePasswordRequestSchema.safeParse(body);
    if (!parsed.success) throw validationError();
    const actor = requireActor(request);
    await this.auth.changePassword(actor.id, parsed.data.currentPassword, parsed.data.newPassword, {
      ip: actor.ip,
      correlationId: actor.correlationId,
    });
  }

  @Permission('auth.me')
  @Get('me')
  @HttpCode(200)
  async me(@Req() request: FastifyRequest): Promise<UserMe> {
    return this.auth.me(requireActor(request).id);
  }
}
