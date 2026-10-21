import { Body, Controller, Header, HttpCode, Inject, Post, Req } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { Permission } from '../../../common/rbac/permissions.js';
import { Idempotent } from '../../../common/idempotency/decorators.js';
import { CheckOutService } from './service.js';
import { CheckOutAccess } from './access.js';
import { checkOutInput, requestActor } from './validation.js';

@Controller('front-office')
export class CheckOutController {
  constructor(@Inject(CheckOutService) private readonly service: CheckOutService) {}

  /** api.md §2.9: 🔒 PIN, idempotent; số tiền/phụ thu do máy chủ quyết (BR-FO-03/05/06). */
  @Post('check-out')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  @Permission('frontOffice.checkOut')
  @Idempotent(CheckOutAccess)
  checkOut(@Body() body: unknown, @Req() request: FastifyRequest) {
    return this.service.checkOut(requestActor(request), checkOutInput(body));
  }
}
