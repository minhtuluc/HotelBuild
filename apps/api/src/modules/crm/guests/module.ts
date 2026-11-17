import { Module } from '@nestjs/common';
import type { PrismaClient } from '@prisma/client';
import type { Clock } from '@pinehill/domain';
import { AuditWriter } from '../../../infrastructure/audit/audit-writer.js';
import { PRISMA } from '../../../infrastructure/prisma/prisma.module.js';
import { CLOCK } from '../../../infrastructure/ports.js';
import { GuestsController } from './controller.js';
import { GuestsMeController } from './me.controller.js';
import { guestsPermissions } from './permissions.js';
import { GuestsService } from './service.js';

@Module({
  // `GuestsMeController` trước: đường tĩnh `guests/me` không bị hiểu thành `guests/:guestId`.
  controllers: [GuestsMeController, GuestsController],
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
