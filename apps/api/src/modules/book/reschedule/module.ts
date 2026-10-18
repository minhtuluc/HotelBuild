/**
 * Module hai lệnh BOOK của HB-098: `POST /bookings/{bookingId}/reschedule` và
 * `DELETE /bookings/{bookingId}` (UC-BOOK-05/06, api.md §2.5).
 *
 * Nhập `QuotesModule` để dùng `RateQuoteService` — **điểm nối duy nhất** cho báo giá: `consume` (báo giá
 * đã chấp nhận) và `create` (báo giá mới từ loader HB-056/198 + engine HB-052), nên không có công thức
 * giá thứ hai trong module này (BR-RATE-17, ADR-015 §7).
 *
 * Dùng lại `lockStock`/`planHold` của `book/holds` (HB-076) cho khoá ADR-014 và kiểm tồn bằng engine
 * HB-032; `AuditWriter` (HB-009) ghi cùng transaction của use case, còn vết xoá cứng do trigger
 * `trg_bookings_delete` ghi (BR-BOOK-17).
 */
import { Module } from '@nestjs/common';
import type { PrismaClient } from '@prisma/client';
import type { Clock } from '@pinehill/domain';
import { CONFIG } from '../../../config/env.js';
import type { ApiConfig } from '../../../config/env.js';
import { AuditWriter } from '../../../infrastructure/audit/audit-writer.js';
import { PRISMA } from '../../../infrastructure/prisma/prisma.module.js';
import { CLOCK } from '../../../infrastructure/ports.js';
import { QuotesModule } from '../../rate/quotes/module.js';
import { RateQuoteService } from '../../rate/quotes/service.js';
import { HardDeleteAccess, RescheduleAccess } from './access.js';
import { RescheduleController } from './controller.js';
import { reschedulePermissions } from './permissions.js';
import { RescheduleService } from './service.js';

@Module({
  imports: [QuotesModule],
  controllers: [RescheduleController],
  providers: [
    RescheduleAccess,
    HardDeleteAccess,
    reschedulePermissions,
    {
      provide: AuditWriter,
      inject: [CLOCK],
      useFactory: (clock: Clock) => new AuditWriter(clock),
    },
    {
      provide: RescheduleService,
      inject: [PRISMA, RateQuoteService, AuditWriter, CONFIG, CLOCK],
      useFactory: (
        db: PrismaClient,
        quotes: RateQuoteService,
        audit: AuditWriter,
        config: ApiConfig,
        clock: Clock,
      ) => new RescheduleService(db, quotes, audit, config, clock),
    },
  ],
})
export class RescheduleModule {}
