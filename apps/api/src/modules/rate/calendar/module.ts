import { Module } from '@nestjs/common';
import type { PrismaClient } from '@prisma/client';
import type { Clock, IdGenerator } from '@pinehill/domain';
import { PRISMA } from '../../../infrastructure/prisma/prisma.module.js';
import { CLOCK, ID_GENERATOR } from '../../../infrastructure/ports.js';
import { AuditWriter } from '../../../infrastructure/audit/audit-writer.js';
import { RateCalendarController } from './controller.js';
import { RateCalendarService } from './service.js';
import { RateCalendarAccess } from './access.js';
import { rateCalendarPermissions } from './permissions.js';

@Module({
  controllers: [RateCalendarController],
  providers: [
    RateCalendarAccess,
    rateCalendarPermissions,
    {
      provide: RateCalendarService,
      inject: [PRISMA, CLOCK, ID_GENERATOR],
      useFactory: (db: PrismaClient, clock: Clock, ids: IdGenerator) =>
        new RateCalendarService(db, ids, new AuditWriter(clock)),
    },
  ],
  exports: [RateCalendarService],
})
export class RateCalendarModule {}
