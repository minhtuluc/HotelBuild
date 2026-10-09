import { Module } from '@nestjs/common';
import type { PrismaClient } from '@prisma/client';
import type { Clock, IdGenerator } from '@pinehill/domain';
import { PRISMA } from '../../../infrastructure/prisma/prisma.module.js';
import { CLOCK, ID_GENERATOR } from '../../../infrastructure/ports.js';
import { permissionProvider } from '../../../common/rbac/permissions.js';
import { RatePlansController } from './controller.js';
import { RatePlansService } from './service.js';
import { RatePlanAccess } from './access.js';
@Module({
  controllers: [RatePlansController],
  providers: [
    RatePlanAccess,
    permissionProvider('ratePlans', {
      'ratePlans.admin': ['OWNER'],
      'ratePlans.update': ['OWNER'],
    }),
    {
      provide: RatePlansService,
      inject: [PRISMA, CLOCK, ID_GENERATOR],
      useFactory: (db: PrismaClient, clock: Clock, ids: IdGenerator) =>
        new RatePlansService(db, clock, ids),
    },
  ],
  exports: [RatePlansService],
})
export class RatePlansModule {}
