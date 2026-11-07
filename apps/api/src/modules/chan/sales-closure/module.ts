import { Module } from '@nestjs/common';
import type { PrismaClient } from '@prisma/client';
import type { Clock } from '@pinehill/domain';
import { AuditWriter } from '../../../infrastructure/audit/audit-writer.js';
import { CLOCK } from '../../../infrastructure/ports.js';
import { PRISMA } from '../../../infrastructure/prisma/prisma.module.js';
import { ChannelSyncModule } from '../sync/module.js';
import { ChannelSyncService } from '../sync/service.js';
import { ChannelSalesClosureAccess } from './access.js';
import { ChannelSalesClosureController } from './controller.js';
import { ChannelSalesClosureService } from './service.js';

/** HB-131 — đóng/mở bán theo ngày; dùng lại `ChannelSyncService` cho tra kênh/loại phòng. */
@Module({
  imports: [ChannelSyncModule],
  controllers: [ChannelSalesClosureController],
  providers: [
    ChannelSalesClosureAccess,
    {
      provide: ChannelSalesClosureService,
      inject: [PRISMA, CLOCK, ChannelSyncService],
      useFactory: (db: PrismaClient, clock: Clock, channels: ChannelSyncService) =>
        new ChannelSalesClosureService(db, clock, new AuditWriter(clock), channels),
    },
  ],
})
export class ChannelSalesClosureModule {}
