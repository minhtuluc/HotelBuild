import { Module } from '@nestjs/common';
import type { PrismaClient } from '@prisma/client';
import type { Clock } from '@pinehill/domain';
import { PRISMA } from '../../../infrastructure/prisma/prisma.module.js';
import { CLOCK } from '../../../infrastructure/ports.js';
import { AuditWriter } from '../../../infrastructure/audit/audit-writer.js';
import { CancelAccess } from './access.js';
import { cancelPermissions } from './permissions.js';
import { CancelController } from './controller.js';
import { CancelService } from './service.js';

@Module({
  controllers: [CancelController],
  providers: [
    CancelAccess,
    cancelPermissions,
    {
      provide: CancelService,
      inject: [PRISMA, CLOCK],
      useFactory: (db: PrismaClient, clock: Clock) =>
        new CancelService(db, clock, new AuditWriter(clock)),
    },
  ],
})
export class CancelModule {}
