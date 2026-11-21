import { Module } from '@nestjs/common';
import type { PrismaClient } from '@prisma/client';
import type { Clock } from '@pinehill/domain';
import { AuditWriter } from '../../../infrastructure/audit/audit-writer.js';
import { CLOCK } from '../../../infrastructure/ports.js';
import { PRISMA } from '../../../infrastructure/prisma/prisma.module.js';
import { BackupAccess, RestoreAccess } from './access.js';
import { BackupController } from './controller.js';
import { backupPermissions } from './permissions.js';
import { BackupService } from './service.js';

@Module({
  controllers: [BackupController],
  providers: [
    BackupAccess,
    RestoreAccess,
    backupPermissions,
    {
      provide: BackupService,
      inject: [PRISMA, CLOCK],
      useFactory: (db: PrismaClient, clock: Clock) =>
        new BackupService(db, new AuditWriter(clock), clock),
    },
  ],
})
export class BackupModule {}
