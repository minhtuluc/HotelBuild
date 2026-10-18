/**
 * `POST /api/v1/payments/online` + `GET /api/v1/payments/{paymentId}/status` (HB-094; api.md §2.6, §3.5).
 *
 * `@Public()` ở đây là **có chủ ý**, không phải bỏ quên phân quyền: cả hai tuyến là tuyến của **phiên
 * khách** (api.md §2.6) với `GUEST` không phải vai trò trong `userRoleSchema` và `AuthGuard` (HB-013) chỉ
 * xác thực phiên nhân viên — nhánh phiên khách thuộc HB-017. Vì vậy module tự phân giải chủ thể bằng
 * `bookingCaller` của HB-077 (một chỗ xác thực, đọc lại `users.role`/`is_active` từ CSDL cho nhân viên)
 * rồi áp `requireOnlinePayment` (xem `principal.ts`, `permissions.ts`).
 *
 * `POST` có `Idempotency-Key` bắt buộc ⇒ đi qua interceptor HB-029 và lấy transaction từ
 * `IdempotencyContext`; client khác body cùng khoá nhận `409 E_SYS_IDEMPOTENCY_KEY_REUSED`, cùng
 * body nhận lại đúng phản hồi cũ kèm `Idempotency-Replayed: true` (BR-PAY-03, api.md §1.6).
 * `GET` **không** có idempotency: đọc lại trạng thái là thao tác thuần đọc (AC3).
 */
import { Body, Controller, Get, HttpCode, Inject, Param, Post, Req } from '@nestjs/common';
import type { PrismaClient } from '@prisma/client';
import type { FastifyRequest } from 'fastify';
import type { Clock } from '@pinehill/domain';
import type { Payment, PaymentStatusView } from '@pinehill/contracts';
import { Public } from '../../../common/guards/decorators.js';
import { Idempotent } from '../../../common/idempotency/decorators.js';
import { IdempotencyContext } from '../../../common/idempotency/context.js';
import { CONFIG } from '../../../config/env.js';
import type { ApiConfig } from '../../../config/env.js';
import { CLOCK } from '../../../infrastructure/ports.js';
import { PRISMA } from '../../../infrastructure/prisma/prisma.module.js';
import { bookingCaller } from '../../book/bookings/principal.js';
import { uuid } from '../../rate/calendar/support.js';
import { OnlinePaymentAccess } from './access.js';
import { OnlinePaymentsService } from './service.js';
import { commandKey, onlinePaymentInput } from './validation.js';

@Public()
@Controller('payments')
export class OnlinePaymentsController {
  constructor(
    @Inject(OnlinePaymentsService) private readonly service: OnlinePaymentsService,
    @Inject(IdempotencyContext) private readonly context: IdempotencyContext,
    @Inject(PRISMA) private readonly db: PrismaClient,
    @Inject(CONFIG) private readonly config: ApiConfig,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  /** AC1–AC3: `201` với `Payment` `PENDING` + URL cổng đã ký; số tiền lệch nghĩa vụ ⇒ `422`. */
  @Idempotent(OnlinePaymentAccess)
  @Post('online')
  @HttpCode(201)
  async create(@Body() body: unknown, @Req() request: FastifyRequest): Promise<Payment> {
    const caller = await bookingCaller(this.db, request, this.config, this.clock);
    return this.service.init(
      this.context.transaction(),
      caller,
      onlinePaymentInput(body),
      commandKey(request.headers['idempotency-key']),
    );
  }

  /** AC3/BR-PAY-05: `200` đọc từ CSDL; kết quả cuối vẫn do PSP xác nhận qua webhook (HB-095). */
  @Get(':paymentId/status')
  async status(
    @Param('paymentId') id: unknown,
    @Req() request: FastifyRequest,
  ): Promise<PaymentStatusView> {
    const caller = await bookingCaller(this.db, request, this.config, this.clock);
    return this.service.status(caller, uuid(id));
  }
}
