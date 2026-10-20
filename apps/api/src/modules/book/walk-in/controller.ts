/**
 * `POST /api/v1/walk-in` (HB-151; UC-BOOK-02, FR-BOOK-02).
 *
 * Một lệnh cho lễ tân: báo giá → giữ chỗ/đặt phòng trên kênh cấu hình `WALKIN` trong cùng transaction;
 * bước thu cọc kế tiếp là `POST /payments` của booking vừa trả về (xem `service.ts`). Quyền
 * `bookings.create` (FRONT_DESK, RESERVATION_AGENT, MANAGER, OWNER — api.md §2.5, §6.3) do
 * `RbacGuard` kiểm; `Idempotency-Key` bắt buộc theo hợp đồng lệnh ghi.
 */
import { Body, Controller, HttpCode, Inject, Post, Req, UseInterceptors } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { isAuthorizedActor } from '../../../common/actor/authorized-actor.js';
import { IdempotencyContext } from '../../../common/idempotency/context.js';
import { Idempotent } from '../../../common/idempotency/decorators.js';
import { Permission } from '../../../common/rbac/permissions.js';
import { WalkInAccess } from './access.js';
import { WalkInCreatedInterceptor } from './created-interceptor.js';
import { WalkInService } from './service.js';
import { unauthorized, walkInInput } from './validation.js';
import type { WalkInResult } from './validation.js';

@Controller('walk-in')
export class WalkInController {
  constructor(
    @Inject(WalkInService) private readonly service: WalkInService,
    @Inject(IdempotencyContext) private readonly context: IdempotencyContext,
  ) {}

  @Permission('bookings.create')
  @Idempotent(WalkInAccess)
  @Post()
  @HttpCode(201)
  @UseInterceptors(WalkInCreatedInterceptor)
  async create(@Body() body: unknown, @Req() request: FastifyRequest): Promise<WalkInResult> {
    const actor = request.actor;
    if (!isAuthorizedActor(actor)) throw unauthorized();
    return this.service.create(this.context.transaction(), actor, walkInInput(body));
  }
}
