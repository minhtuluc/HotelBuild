import { Module } from '@nestjs/common';
import type { PrismaClient } from '@prisma/client';
import type { Clock } from '@pinehill/domain';
import { PRISMA } from '../../../infrastructure/prisma/prisma.module.js';
import { CLOCK } from '../../../infrastructure/ports.js';
import { AuditWriter } from '../../../infrastructure/audit/audit-writer.js';
import { permissionProvider } from '../../../common/rbac/permissions.js';
import { HousekeepingService } from './service.js';
import { HousekeepingController } from './controller.js';
import { HousekeepingAccess } from './access.js';
@Module({
  controllers: [HousekeepingController],
  providers: [
    HousekeepingAccess,
    permissionProvider('housekeeping', {
      'housekeepingTasks.read': ['HOUSEKEEPING', 'FRONT_DESK', 'MANAGER'],
      'housekeepingTasks.update': ['HOUSEKEEPING', 'FRONT_DESK', 'MANAGER'],
    }),
    {
      provide: HousekeepingService,
      inject: [PRISMA, CLOCK],
      useFactory: (db: PrismaClient, clock: Clock) =>
        new HousekeepingService(db, clock, new AuditWriter(clock)),
    },
  ],
})
export class HousekeepingModule {}
