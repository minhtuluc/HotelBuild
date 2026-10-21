import { Module } from '@nestjs/common';
import type { PrismaClient } from '@prisma/client';
import type { Clock } from '@pinehill/domain';
import { CONFIG } from '../../../config/env.js';
import type { ApiConfig } from '../../../config/env.js';
import { PRISMA } from '../../../infrastructure/prisma/prisma.module.js';
import { CLOCK } from '../../../infrastructure/ports.js';
import { AuditWriter } from '../../../infrastructure/audit/audit-writer.js';
import { CheckOutAccess } from './access.js';
import { checkOutPermissions } from './permissions.js';
import { CheckOutController } from './controller.js';
import { CheckOutService } from './service.js';

@Module({
  controllers: [CheckOutController],
  providers: [
    CheckOutAccess,
    checkOutPermissions,
    {
      provide: CheckOutService,
      inject: [PRISMA, CLOCK, CONFIG],
      useFactory: (db: PrismaClient, clock: Clock, config: ApiConfig) =>
        new CheckOutService(db, clock, config, new AuditWriter(clock)),
    },
  ],
})
export class CheckOutModule {}
