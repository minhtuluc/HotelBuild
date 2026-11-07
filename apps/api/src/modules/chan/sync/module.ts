import { Module } from '@nestjs/common';
import type { PrismaClient } from '@prisma/client';
import type { Clock } from '@pinehill/domain';
import { CONFIG } from '../../../config/env.js';
import type { ApiConfig } from '../../../config/env.js';
import { AuditWriter } from '../../../infrastructure/audit/audit-writer.js';
import { CLOCK } from '../../../infrastructure/ports.js';
import { PRISMA } from '../../../infrastructure/prisma/prisma.module.js';
import { chanPermissions } from '../permissions.js';
import { ChannelSyncAccess } from './access.js';
import { ChannelSyncController } from './controller.js';
import { ChannelOperationLocationInterceptor } from './location-interceptor.js';
import { ChannelSyncService } from './service.js';

/**
 * HB-131 — lệnh đồng bộ kênh. Module này cũng là **một chỗ duy nhất** đăng ký `chanPermissions` cho cả
 * họ module CHAN (registry từ chối quyền trùng tên nên bốn module còn lại không khai lại).
 */
@Module({
  controllers: [ChannelSyncController],
  exports: [ChannelSyncService],
  providers: [
    ChannelSyncAccess,
    ChannelOperationLocationInterceptor,
    chanPermissions,
    {
      provide: ChannelSyncService,
      inject: [PRISMA, CLOCK, CONFIG],
      useFactory: (db: PrismaClient, clock: Clock, config: ApiConfig) =>
        new ChannelSyncService(db, clock, config.BUSINESS_TIMEZONE, new AuditWriter(clock)),
    },
  ],
})
export class ChannelSyncModule {}
