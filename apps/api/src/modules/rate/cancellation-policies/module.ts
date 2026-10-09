import { Module } from '@nestjs/common';
import type { PrismaClient } from '@prisma/client';
import type { Clock, IdGenerator } from '@pinehill/domain';
import { PRISMA } from '../../../infrastructure/prisma/prisma.module.js';
import { CLOCK, ID_GENERATOR } from '../../../infrastructure/ports.js';
import { permissionProvider } from '../../../common/rbac/permissions.js';
import { CancellationPoliciesController } from './controller.js';
import { CancellationPoliciesService } from './service.js';
import { CancellationPolicyAccess } from './access.js';
@Module({
  controllers: [CancellationPoliciesController],
  providers: [
    CancellationPolicyAccess,
    permissionProvider('cancellationPolicies', {
      'cancellationPolicies.read': ['OWNER'],
      'cancellationPolicies.update': ['OWNER'],
    }),
    {
      provide: CancellationPoliciesService,
      inject: [PRISMA, CLOCK, ID_GENERATOR],
      useFactory: (db: PrismaClient, clock: Clock, ids: IdGenerator) =>
        new CancellationPoliciesService(db, clock, ids),
    },
  ],
  exports: [CancellationPoliciesService],
})
export class CancellationPoliciesModule {}
