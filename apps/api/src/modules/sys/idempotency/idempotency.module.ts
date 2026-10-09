import { Global, Module } from '@nestjs/common';
import type { PrismaClient } from '@prisma/client';
import type { Clock, IdGenerator } from '@pinehill/domain';
import { PRISMA } from '../../../infrastructure/prisma/prisma.module.js';
import { CLOCK, ID_GENERATOR } from '../../../infrastructure/ports.js';
import { IdempotencyContext } from '../../../common/idempotency/context.js';
import { IdempotencyStore } from '../../../common/idempotency/store.js';
import { IdempotencyInterceptor } from '../../../common/idempotency/interceptor.js';
import { IdempotencyCleanup } from './cleanup.js';
import { DiscoveryModule } from '@nestjs/core';
import { IdempotencyValidator } from '../../../common/idempotency/validator.js';

@Global()
@Module({
  imports: [DiscoveryModule],
  providers: [
    IdempotencyContext,
    IdempotencyInterceptor,
    IdempotencyCleanup,
    IdempotencyValidator,
    {
      provide: IdempotencyStore,
      inject: [PRISMA, CLOCK, ID_GENERATOR],
      useFactory: (db: PrismaClient, clock: Clock, ids: IdGenerator) =>
        new IdempotencyStore(db, clock, ids),
    },
  ],
  exports: [IdempotencyContext, IdempotencyInterceptor, IdempotencyStore],
})
export class IdempotencyModule {}
