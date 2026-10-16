import { Body, Controller, HttpCode, Inject, Post, Req } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import type { Clock } from '@pinehill/domain';
import { Public } from '../../../common/guards/decorators.js';
import { Idempotent } from '../../../common/idempotency/decorators.js';
import { IdempotencyContext } from '../../../common/idempotency/context.js';
import { CONFIG } from '../../../config/env.js';
import type { ApiConfig } from '../../../config/env.js';
import { CLOCK } from '../../../infrastructure/ports.js';
import { QuoteAccess } from './access.js';
import { quotePrincipal } from './principal.js';
import { RateQuoteService } from './service.js';

/**
 * Công khai (api.md §2.4 vai trò "—"; §6.3 "tìm phòng, báo giá" là nhóm công khai): khách xem giá
 * trước khi đăng nhập journey F4. Khoá `Idempotency-Key` là **bắt buộc** theo hợp đồng F4
 * (`idempotencyHeaders` required) nên lệnh đi qua interceptor HB-029 như mọi lệnh ghi; giá và hệ số
 * client gửi không có thẩm quyền.
 */
@Controller('quotes')
export class QuotesController {
  constructor(
    @Inject(RateQuoteService) private readonly service: RateQuoteService,
    @Inject(IdempotencyContext) private readonly context: IdempotencyContext,
    @Inject(CONFIG) private readonly config: ApiConfig,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  @Public()
  @Post()
  @HttpCode(201)
  @Idempotent(QuoteAccess)
  async create(@Body() body: unknown, @Req() request: FastifyRequest) {
    return this.service.create(
      this.context.transaction(),
      await quotePrincipal(request, this.config, this.clock),
      body,
    );
  }
}
