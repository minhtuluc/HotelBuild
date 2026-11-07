import { Module } from '@nestjs/common';
import type { PrismaClient } from '@prisma/client';
import type { Clock } from '@pinehill/domain';
import { AuditWriter } from '../../../infrastructure/audit/audit-writer.js';
import { CLOCK } from '../../../infrastructure/ports.js';
import { PRISMA } from '../../../infrastructure/prisma/prisma.module.js';
import { ChannelMappingAccess } from './access.js';
import { ChannelMappingsController } from './controller.js';
import { ChannelMappingsETagInterceptor } from './etag-interceptor.js';
import { ChannelMappingsService } from './service.js';

/** HB-131 — cấu hình ánh xạ kênh (OWNER). Quyền `channels.*` khai một lần ở `sync/module.ts`. */
@Module({
  controllers: [ChannelMappingsController],
  providers: [
    ChannelMappingAccess,
    ChannelMappingsETagInterceptor,
    {
      provide: ChannelMappingsService,
      inject: [PRISMA, CLOCK],
      useFactory: (db: PrismaClient, clock: Clock) =>
        new ChannelMappingsService(db, clock, new AuditWriter(clock)),
    },
  ],
})
export class ChannelMappingsModule {}
