/**
 * `POST /payments` (HB-096; api.md §2.6, §3.5) — thu cọc/số dư/phụ thu tại quầy, tuyến 🔒 PIN.
 *
 * Lệnh ghi theo hợp đồng F5 (`bearerWrite`): `@Permission('payments.collect')` cho quyền theo cơ sở,
 * `@Idempotent(CounterAccess)` cho khoá chống trùng HB-029 (claim + nghiệp vụ + audit commit cùng
 * transaction), `Idempotency-Key` bắt buộc. Controller chỉ chuyển thân lệnh — mọi luật tiền/trạng thái/
 * PIN nằm ở `CounterService` sau khi khoá booking.
 */
import { Body, Controller, HttpCode, Inject, Post, Req } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import type { Payment } from '@pinehill/contracts';
import { isAuthorizedActor } from '../../../common/actor/authorized-actor.js';
import { IdempotencyContext } from '../../../common/idempotency/context.js';
import { Idempotent } from '../../../common/idempotency/decorators.js';
import { Permission } from '../../../common/rbac/permissions.js';
import { CounterAccess } from './access.js';
import { forbidden } from './errors.js';
import { CounterService } from './service.js';

@Controller('payments')
export class CounterController {
  constructor(
    @Inject(CounterService) private readonly service: CounterService,
    @Inject(IdempotencyContext) private readonly context: IdempotencyContext,
  ) {}

  @Permission('payments.collect')
  @Idempotent(CounterAccess)
  @Post()
  @HttpCode(201)
  async create(@Body() body: unknown, @Req() request: FastifyRequest): Promise<Payment> {
    const actor = request.actor;
    if (!isAuthorizedActor(actor)) throw forbidden();
    return this.service.collect(this.context.transaction(), actor, body);
  }
}
