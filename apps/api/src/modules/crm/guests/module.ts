import { Module } from '@nestjs/common';
import type { PrismaClient } from '@prisma/client';
import type { Clock } from '@pinehill/domain';
import { AuditWriter } from '../../../infrastructure/audit/audit-writer.js';
import { PRISMA } from '../../../infrastructure/prisma/prisma.module.js';
import { CLOCK } from '../../../infrastructure/ports.js';
import { GuestsController } from './controller.js';
import { guestsPermissions } from './permissions.js';
import { GuestsService } from './service.js';

@Module({
  controllers: [GuestsController],
  providers: [
    guestsPermissions,
    {
      provide: GuestsService,
      inject: [PRISMA, CLOCK],
      useFactory: (db: PrismaClient, clock: Clock) =>
        new GuestsService(db, clock, new AuditWriter(clock)),
    },
  ],
})
export class GuestsModule {}
