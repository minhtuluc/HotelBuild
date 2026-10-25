/**
 * Controller auth khách (HB-017; api.md §2.1): `register`/`login`/`refresh` công khai — danh tính là SĐT +
 * mật khẩu hoặc refresh token, không có bearer. Token khách không gọi được tuyến nhân viên (guard trả 403).
 */
import { Body, Controller, HttpCode, Inject, Post, Req } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { refreshRequestSchema } from '@pinehill/contracts';
import type { TokenPair } from '@pinehill/contracts';
import { Public } from '../../../common/guards/decorators.js';
import { GuestAuthService } from './service.js';
import { loginCommand, registerCommand, requestContext, validationFailed } from './validation.js';

@Controller('guest-auth')
export class GuestAuthController {
  constructor(@Inject(GuestAuthService) private readonly guests: GuestAuthService) {}

  @Public()
  @Post('register')
  @HttpCode(201)
  register(@Body() body: unknown, @Req() request: FastifyRequest): Promise<TokenPair> {
    return this.guests.register(registerCommand(body), requestContext(request));
  }

  @Public()
  @Post('login')
  @HttpCode(200)
  login(@Body() body: unknown, @Req() request: FastifyRequest): Promise<TokenPair> {
    return this.guests.login(loginCommand(body), requestContext(request));
  }

  @Public()
  @Post('refresh')
  @HttpCode(200)
  refresh(@Body() body: unknown): Promise<TokenPair> {
    const parsed = refreshRequestSchema.safeParse(body);
    if (!parsed.success) throw validationFailed();
    return this.guests.refresh(parsed.data.refreshToken);
  }
}
