import { Inject, Module } from '@nestjs/common';
import type { OnModuleDestroy } from '@nestjs/common';
import type { PrismaClient } from '@prisma/client';
import type { Clock } from '@pinehill/domain';
import { CONFIG } from '../../../config/env.js';
import type { ApiConfig } from '../../../config/env.js';
import { AuditWriter } from '../../../infrastructure/audit/audit-writer.js';
import { CLOCK } from '../../../infrastructure/ports.js';
import { PRISMA } from '../../../infrastructure/prisma/prisma.module.js';
import { ReportExportAccess } from './access.js';
import { ReportExportController } from './controller.js';
import { reportExportPermissions } from './permissions.js';
import { EXPORT_QUEUE, createExportQueue } from './queue.js';
import type { ExportQueue } from './queue.js';
import { ReportExportService } from './service.js';

@Module({
  controllers: [ReportExportController],
  providers: [
    ReportExportAccess,
    reportExportPermissions,
    {
      provide: EXPORT_QUEUE,
      inject: [CONFIG],
      useFactory: (config: ApiConfig) => createExportQueue(config.REDIS_URL),
    },
    {
      provide: ReportExportService,
      inject: [PRISMA, EXPORT_QUEUE, CLOCK, CONFIG],
      useFactory: (db: PrismaClient, queue: ExportQueue, clock: Clock, config: ApiConfig) =>
        new ReportExportService(db, queue, new AuditWriter(clock), clock, config.BUSINESS_TIMEZONE),
    },
  ],
})
export class ReportExportModule implements OnModuleDestroy {
  constructor(@Inject(EXPORT_QUEUE) private readonly queue: ExportQueue) {}

  async onModuleDestroy(): Promise<void> {
    await this.queue.close();
  }
}
