/**
 * Module điều phối walk-in (HB-151, UC-BOOK-02): `POST /walk-in`.
 *
 * Nhập `QuotesModule` để dùng `RateQuoteService` (HB-074, được export) và dựng `BookingsService` bằng
 * **đúng** factory của `BookingsModule` (HB-077) — module đó chưa export service, và ticket này không
 * được sửa ra ngoài `book/walk-in/**`. Không khai lại quyền: tuyến dùng quyền `bookings.create` do
 * `BookingsModule` sở hữu (khai trùng tên sẽ làm `PermissionRegistry` ném lỗi khởi động).
 * `AuditWriter` (HB-009) ghi cùng transaction của use case con.
 */
import { Module } from '@nestjs/common';
import type { PrismaClient } from '@prisma/client';
import type { Clock } from '@pinehill/domain';
import { AuditWriter } from '../../../infrastructure/audit/audit-writer.js';
import { PRISMA } from '../../../infrastructure/prisma/prisma.module.js';
import { CLOCK } from '../../../infrastructure/ports.js';
import { CONFIG } from '../../../config/env.js';
import type { ApiConfig } from '../../../config/env.js';
import { PermissionRegistry } from '../../../common/rbac/permission-registry.js';
import { QuotesModule } from '../../rate/quotes/module.js';
import { RateQuoteService } from '../../rate/quotes/service.js';
import { BookingsService } from '../bookings/service.js';
import { WalkInAccess } from './access.js';
import { WalkInController } from './controller.js';
import { WalkInCreatedInterceptor } from './created-interceptor.js';
import { WalkInService } from './service.js';

@Module({
  imports: [QuotesModule],
  controllers: [WalkInController],
  providers: [
    WalkInAccess,
    WalkInCreatedInterceptor,
    {
      provide: AuditWriter,
      inject: [CLOCK],
      useFactory: (clock: Clock) => new AuditWriter(clock),
    },
    {
      provide: BookingsService,
      inject: [PRISMA, RateQuoteService, PermissionRegistry, AuditWriter, CONFIG, CLOCK],
      useFactory: (
        db: PrismaClient,
        quotes: RateQuoteService,
        permissions: PermissionRegistry,
        audit: AuditWriter,
        config: ApiConfig,
        clock: Clock,
      ) => new BookingsService(db, quotes, permissions, audit, config, clock),
    },
    {
      provide: WalkInService,
      inject: [RateQuoteService, BookingsService],
      useFactory: (quotes: RateQuoteService, bookings: BookingsService) =>
        new WalkInService(quotes, bookings),
    },
  ],
})
export class WalkInModule {}
