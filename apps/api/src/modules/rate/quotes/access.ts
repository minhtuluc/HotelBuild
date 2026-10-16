/**
 * Tiền kiểm trước khi giữ khoá idempotency (HB-029): thân lệnh phải hợp lệ và principal phải xác định
 * được, nên lệnh hỏng không để lại `idempotency_keys` rác. Principal suy đúng như controller dùng để
 * phát hành quote (xem `principal.ts`).
 */
import { Inject, Injectable } from '@nestjs/common';
import type { ExecutionContext } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import type { Clock } from '@pinehill/domain';
import type { IdempotencyAccess } from '../../../common/idempotency/decorators.js';
import type { Principal } from '../../../common/idempotency/request.js';
import { CONFIG } from '../../../config/env.js';
import type { ApiConfig } from '../../../config/env.js';
import { CLOCK } from '../../../infrastructure/ports.js';
import { quotePrincipal } from './principal.js';
import { quoteInput } from './validation.js';

@Injectable()
export class QuoteAccess implements IdempotencyAccess {
  constructor(
    @Inject(CONFIG) private readonly config: ApiConfig,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  async authorize(context: ExecutionContext): Promise<Principal> {
    const request = context.switchToHttp().getRequest<FastifyRequest>();
    quoteInput(request.body);
    return quotePrincipal(request, this.config, this.clock);
  }
}
