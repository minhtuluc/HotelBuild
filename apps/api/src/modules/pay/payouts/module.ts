import { Module } from '@nestjs/common';
import type { PrismaClient } from '@prisma/client';
import type { Clock } from '@pinehill/domain';
import { PRISMA } from '../../../infrastructure/prisma/prisma.module.js';
import { CLOCK } from '../../../infrastructure/ports.js';
import { AuditWriter } from '../../../infrastructure/audit/audit-writer.js';
import { PayoutAccess } from './access.js';
import { PayoutController } from './controller.js';
import { payoutPermissions } from './permissions.js';
import { PayoutService } from './service.js';

@Module({
  controllers: [PayoutController],
  providers: [
    PayoutAccess,
    payoutPermissions,
    {
      provide: PayoutService,
      inject: [PRISMA, CLOCK],
      useFactory: (db: PrismaClient, clock: Clock) =>
        new PayoutService(db, clock, new AuditWriter(clock)),
    },
  ],
})
export class PayoutModule {}
