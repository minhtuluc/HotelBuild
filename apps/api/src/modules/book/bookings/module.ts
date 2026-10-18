/**
 * Module BOOK của journey khách (HB-077, UC-BOOK-01): `POST /bookings`, `confirm`, `GET /bookings`,
 * `GET /bookings/{bookingId}`.
 *
 * Nhập `QuotesModule` để tiêu thụ quote qua `RateQuoteService.consume` (HB-074) — điểm nối **duy nhất**
 * cho luật principal/fingerprint/hạn, không chép lại và **không** tính lại giá (BR-RATE-17). Dùng lại
 * `lockStock`/`planHold` của `book/holds` (HB-076) cho khoá ADR-014 và kiểm tồn bằng engine HB-032.
 * `AuditWriter` (HB-009) ghi cùng transaction của use case.
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
import { BookingAccess } from './access.js';
import { BookingsController } from './controller.js';
import { BookingCreatedInterceptor } from './created-interceptor.js';
import { bookingPermissions } from './permissions.js';
import { BookingsService } from './service.js';

@Module({
  imports: [QuotesModule],
  controllers: [BookingsController],
  providers: [
    BookingAccess,
    BookingCreatedInterceptor,
    bookingPermissions,
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
  ],
})
export class BookingsModule {}
