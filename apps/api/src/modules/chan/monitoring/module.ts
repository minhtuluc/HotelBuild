import { Module } from '@nestjs/common';
import type { PrismaClient } from '@prisma/client';
import type { Clock } from '@pinehill/domain';
import { AuditWriter } from '../../../infrastructure/audit/audit-writer.js';
import { CLOCK } from '../../../infrastructure/ports.js';
import { PRISMA } from '../../../infrastructure/prisma/prisma.module.js';
import { ChannelOperationLocationInterceptor } from '../sync/location-interceptor.js';
import { ChannelSyncModule } from '../sync/module.js';
import { ChannelSyncService } from '../sync/service.js';
import { ChannelDeliveryRetryAccess } from './access.js';
import { ChannelMonitoringController } from './controller.js';
import { ChannelMonitoringService } from './service.js';

/** HB-131 — đọc trạng thái đồng bộ/delivery và retry có kiểm quyền (dùng lại interceptor `Location`). */
@Module({
  imports: [ChannelSyncModule],
  controllers: [ChannelMonitoringController],
  providers: [
    ChannelDeliveryRetryAccess,
    ChannelOperationLocationInterceptor,
    {
      provide: ChannelMonitoringService,
      inject: [PRISMA, ChannelSyncService, CLOCK],
      useFactory: (db: PrismaClient, channels: ChannelSyncService, clock: Clock) =>
        new ChannelMonitoringService(db, channels, new AuditWriter(clock)),
    },
  ],
})
export class ChannelMonitoringModule {}
