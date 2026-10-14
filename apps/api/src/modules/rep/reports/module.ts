import { Module } from '@nestjs/common';
import type { PrismaClient } from '@prisma/client';
import { CONFIG } from '../../../config/env.js';
import type { ApiConfig } from '../../../config/env.js';
import { PRISMA } from '../../../infrastructure/prisma/prisma.module.js';
import { ReportsController } from './controller.js';
import { reportsPermissions } from './permissions.js';
import { ReportsService } from './service.js';

@Module({
  controllers: [ReportsController],
  providers: [
    reportsPermissions,
    {
      provide: ReportsService,
      inject: [PRISMA, CONFIG],
      useFactory: (db: PrismaClient, config: ApiConfig) =>
        new ReportsService(db, config.BUSINESS_TIMEZONE),
    },
  ],
})
export class ReportsModule {}
