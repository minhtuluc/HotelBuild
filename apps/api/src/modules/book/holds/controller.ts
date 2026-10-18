/**
 * `POST /api/v1/holds` + `DELETE /api/v1/holds/{holdId}` (HB-076; api.md §2.5, §3.4).
 *
 * `@Public()` ở đây là **có chủ ý**, không phải bỏ quên phân quyền: `POST /holds` là tuyến của **phiên
 * khách** (api.md §2.5, §6.3) mà `GUEST` không phải vai trò trong `userRoleSchema`, còn `AuthGuard`
 * (HB-013) chỉ xác thực phiên nhân viên — nhánh phiên khách thuộc HB-017. Vì vậy module tự phân giải
 * chủ thể (`principal.ts`) theo đúng cách `POST /quotes` (HB-074) đang làm cho journey khách: vẫn đòi
 * Bearer hợp lệ (401), đọc lại `users.role`/`is_active` từ CSDL cho nhân viên, kiểm quyền
 * `holds.release` + phạm vi cơ sở cho `DELETE` (xem `principal.ts`, `permissions.ts`). Khi HB-017 mở
 * phiên khách, hai tuyến này chuyển sang guard chung và bỏ nhánh phân giải tại chỗ.
 *
 * `Idempotency-Key` là bắt buộc theo hợp đồng F4 (`idempotencyHeaders`), nên mọi lệnh đi qua
 * interceptor HB-029 và handler lấy transaction từ `IdempotencyContext`.
 */
import {
  Body,
  Controller,
  Delete,
  HttpCode,
  Inject,
  Param,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import type { PrismaClient } from '@prisma/client';
import type { FastifyRequest } from 'fastify';
import type { Clock } from '@pinehill/domain';
import type { Hold } from '@pinehill/contracts';
import { Public } from '../../../common/guards/decorators.js';
import { Idempotent } from '../../../common/idempotency/decorators.js';
import { IdempotencyContext } from '../../../common/idempotency/context.js';
import { CONFIG } from '../../../config/env.js';
import type { ApiConfig } from '../../../config/env.js';
import { CLOCK } from '../../../infrastructure/ports.js';
import { PRISMA } from '../../../infrastructure/prisma/prisma.module.js';
import { HoldAccess } from './access.js';
import { holdCaller } from './principal.js';
import { HoldsService } from './service.js';
import { holdInput, releaseReason } from './validation.js';
import { uuid } from '../../rate/calendar/support.js';

@Public()
@Controller('holds')
export class HoldsController {
  constructor(
    @Inject(HoldsService) private readonly service: HoldsService,
    @Inject(IdempotencyContext) private readonly context: IdempotencyContext,
    @Inject(PRISMA) private readonly db: PrismaClient,
    @Inject(CONFIG) private readonly config: ApiConfig,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  /** AC1–AC3: khoá theo ADR-014, kiểm tồn sau khoá, tiêu thụ quote, ghi booking HELD + assignment. */
  @Idempotent(HoldAccess)
  @Post()
  @HttpCode(201)
  async create(@Body() body: unknown, @Req() request: FastifyRequest): Promise<Hold> {
    return this.service.create(
      this.context.transaction(),
      await holdCaller(this.db, request, this.config, this.clock),
      holdInput(body),
    );
  }

  /** AC4: giải phóng ngay, trả phòng về tồn khả dụng, audit cùng transaction (204). */
  @Idempotent(HoldAccess)
  @Delete(':holdId')
  @HttpCode(204)
  async release(
    @Param('holdId') id: unknown,
    @Query() query: unknown,
    @Req() request: FastifyRequest,
  ): Promise<void> {
    await this.service.release(
      this.context.transaction(),
      await holdCaller(this.db, request, this.config, this.clock),
      uuid(id),
      releaseReason(query),
    );
  }
}
