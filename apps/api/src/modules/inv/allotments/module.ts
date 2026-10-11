import { Module } from '@nestjs/common';
import type { PrismaClient } from '@prisma/client';
import type { Clock } from '@pinehill/domain';
import { PRISMA } from '../../../infrastructure/prisma/prisma.module.js';
import { CLOCK } from '../../../infrastructure/ports.js';
import { AuditWriter } from '../../../infrastructure/audit/audit-writer.js';
import { allotmentPermissions } from './permissions.js';
import { AllotmentsService } from './service.js';
import { AllotmentsController } from './controller.js';
import { AllotmentAccess } from './access.js';
import { AllotmentETagInterceptor } from './etag-interceptor.js';
@Module({
  controllers: [AllotmentsController],
  providers: [
    AllotmentAccess,
    AllotmentETagInterceptor,
    allotmentPermissions,
    {
      provide: AllotmentsService,
      inject: [PRISMA, CLOCK],
      useFactory: (db: PrismaClient, clock: Clock) =>
        new AllotmentsService(db, clock, new AuditWriter(clock)),
    },
  ],
})
export class AllotmentsModule {}
