import { Module } from '@nestjs/common';
import type { PrismaClient } from '@prisma/client';
import type { Clock, IdGenerator } from '@pinehill/domain';
import { PRISMA } from '../../../infrastructure/prisma/prisma.module.js';
import { CLOCK, ID_GENERATOR } from '../../../infrastructure/ports.js';
import { AuditWriter } from '../../../infrastructure/audit/audit-writer.js';
import { PromotionsController } from './controller.js';
import { PromotionsService } from './service.js';
import { PromotionAccess, PromotionUpdateAccess } from './access.js';
import { promotionPermissions } from './permissions.js';

@Module({
  controllers: [PromotionsController],
  providers: [
    PromotionAccess,
    PromotionUpdateAccess,
    promotionPermissions,
    {
      provide: PromotionsService,
      inject: [PRISMA, CLOCK, ID_GENERATOR],
      useFactory: (db: PrismaClient, clock: Clock, ids: IdGenerator) =>
        new PromotionsService(db, ids, new AuditWriter(clock)),
    },
  ],
})
export class PromotionsModule {}
