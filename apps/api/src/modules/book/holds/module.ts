/**
 * Module `POST /holds` + `DELETE /holds/{holdId}` (HB-076, UC-BOOK-04).
 *
 * Nhập `QuotesModule` để tiêu thụ quote qua `RateQuoteService.consume` (HB-074) — điểm nối duy nhất
 * cho luật principal/fingerprint/hạn, không chép lại. `AuditWriter` (HB-009) ghi cùng transaction của
 * use case; `HoldProjection` là bản ghi Redis `hold:<bookingId>` của csdl.md §3 (best-effort, nguồn
 * chân lý vẫn là `bookings.hold_expires_at`).
 */
import { Module } from '@nestjs/common';
import type { PrismaClient } from '@prisma/client';
import type { Clock } from '@pinehill/domain';
import { AuditWriter } from '../../../infrastructure/audit/audit-writer.js';
import { PRISMA } from '../../../infrastructure/prisma/prisma.module.js';
import { CLOCK } from '../../../infrastructure/ports.js';
import { REDIS } from '../../../infrastructure/redis/redis.module.js';
import type { RedisClient } from '../../../infrastructure/redis/redis.module.js';
import { PermissionRegistry } from '../../../common/rbac/permission-registry.js';
import { QuotesModule } from '../../rate/quotes/module.js';
import { RateQuoteService } from '../../rate/quotes/service.js';
import { HoldAccess } from './access.js';
import { HoldsController } from './controller.js';
import { holdPermissions } from './permissions.js';
import { HoldProjection } from './projection.js';
import { HoldsService } from './service.js';

@Module({
  imports: [QuotesModule],
  controllers: [HoldsController],
  providers: [
    HoldAccess,
    holdPermissions,
    {
      provide: HoldProjection,
      inject: [REDIS],
      useFactory: (redis: RedisClient) => new HoldProjection(redis),
    },
    {
      provide: AuditWriter,
      inject: [CLOCK],
      useFactory: (clock: Clock) => new AuditWriter(clock),
    },
    {
      provide: HoldsService,
      inject: [PRISMA, RateQuoteService, PermissionRegistry, AuditWriter, HoldProjection],
      useFactory: (
        db: PrismaClient,
        quotes: RateQuoteService,
        permissions: PermissionRegistry,
        audit: AuditWriter,
        projection: HoldProjection,
      ) => new HoldsService(db, quotes, permissions, audit, projection),
    },
  ],
})
export class HoldsModule {}
