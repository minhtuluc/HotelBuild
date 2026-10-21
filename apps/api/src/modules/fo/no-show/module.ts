/**
 * Module no-show (HB-147; UC-FO-04; api.md §2.9).
 *
 * Không khai lại quyền của module khác: `frontOffice.noShow` là khai báo riêng của module này (khai
 * trùng tên làm `PermissionRegistry` ném lỗi khởi động). `AuditWriter` nhận `CLOCK` của app để mốc
 * audit trùng mốc quyết định; `NoShowService` nhận `PRISMA` + `CLOCK` + writer qua factory như
 * `HousekeepingModule`/`CancelModule`.
 */
import { Module } from '@nestjs/common';
import type { PrismaClient } from '@prisma/client';
import type { Clock } from '@pinehill/domain';
import { AuditWriter } from '../../../infrastructure/audit/audit-writer.js';
import { PRISMA } from '../../../infrastructure/prisma/prisma.module.js';
import { CLOCK } from '../../../infrastructure/ports.js';
import { NoShowAccess } from './access.js';
import { NoShowController } from './controller.js';
import { noShowPermissions } from './permissions.js';
import { NoShowService } from './service.js';

@Module({
  controllers: [NoShowController],
  providers: [
    NoShowAccess,
    noShowPermissions,
    {
      provide: AuditWriter,
      inject: [CLOCK],
      useFactory: (clock: Clock) => new AuditWriter(clock),
    },
    {
      provide: NoShowService,
      inject: [PRISMA, CLOCK, AuditWriter],
      useFactory: (db: PrismaClient, clock: Clock, audit: AuditWriter) =>
        new NoShowService(db, clock, audit),
    },
  ],
})
export class NoShowModule {}
