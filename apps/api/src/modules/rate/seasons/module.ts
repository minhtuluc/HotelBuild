import { Module } from '@nestjs/common';
import type { PrismaClient } from '@prisma/client';
import type { Clock, IdGenerator } from '@pinehill/domain';
import { PRISMA } from '../../../infrastructure/prisma/prisma.module.js';
import { CLOCK, ID_GENERATOR } from '../../../infrastructure/ports.js';
import { AuditWriter } from '../../../infrastructure/audit/audit-writer.js';
import { SeasonsController } from './controller.js';
import { SeasonsService } from './service.js';
import { SeasonAccess } from './access.js';
import { seasonPermissions } from './permissions.js';

@Module({
  controllers: [SeasonsController],
  providers: [
    SeasonAccess,
    seasonPermissions,
    {
      provide: SeasonsService,
      inject: [PRISMA, CLOCK, ID_GENERATOR],
      useFactory: (db: PrismaClient, clock: Clock, ids: IdGenerator) =>
        new SeasonsService(db, ids, new AuditWriter(clock)),
    },
  ],
  exports: [SeasonsService],
})
export class SeasonsModule {}
