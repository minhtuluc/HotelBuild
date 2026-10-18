import { Module } from '@nestjs/common';
import type { PrismaClient } from '@prisma/client';
import type { Clock } from '@pinehill/domain';
import { PRISMA } from '../../../infrastructure/prisma/prisma.module.js';
import { CLOCK } from '../../../infrastructure/ports.js';
import { AuditWriter } from '../../../infrastructure/audit/audit-writer.js';
import { RefundAccess } from './access.js';
import { RefundController } from './controller.js';
import { refundPermissions } from './permissions.js';
import { RefundService } from './service.js';

@Module({
  controllers: [RefundController],
  providers: [
    RefundAccess,
    refundPermissions,
    {
      provide: RefundService,
      inject: [PRISMA, CLOCK],
      useFactory: (db: PrismaClient, clock: Clock) =>
        new RefundService(db, clock, new AuditWriter(clock)),
    },
  ],
})
export class RefundModule {}
