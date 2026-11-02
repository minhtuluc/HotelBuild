import { Module } from '@nestjs/common';
import type { PrismaClient } from '@prisma/client';
import { PRISMA } from '../../../infrastructure/prisma/prisma.module.js';
import { ChannelSyncModule } from '../sync/module.js';
import { ChannelSyncService } from '../sync/service.js';
import { ChannelOtaBookingsController } from './controller.js';
import { ChannelOtaBookingsService } from './service.js';

/** HB-131 — chiếu hàng đợi booking OTA (đọc, kiểm scope cơ sở trong service). */
@Module({
  imports: [ChannelSyncModule],
  controllers: [ChannelOtaBookingsController],
  providers: [
    {
      provide: ChannelOtaBookingsService,
      inject: [PRISMA, ChannelSyncService],
      useFactory: (db: PrismaClient, channels: ChannelSyncService) =>
        new ChannelOtaBookingsService(db, channels),
    },
  ],
})
export class ChannelOtaBookingsModule {}
