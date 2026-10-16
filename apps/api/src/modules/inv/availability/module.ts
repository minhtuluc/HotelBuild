import { Module } from '@nestjs/common';
import type { PrismaClient } from '@prisma/client';
import { PRISMA } from '../../../infrastructure/prisma/prisma.module.js';
import { AvailabilityController } from './controller.js';
import { AvailabilityRateLimit } from './rate-limit.js';
import { AvailabilityService } from './service.js';

@Module({
  controllers: [AvailabilityController],
  providers: [
    {
      provide: AvailabilityService,
      inject: [PRISMA],
      useFactory: (db: PrismaClient) => new AvailabilityService(db),
    },
    AvailabilityRateLimit,
  ],
})
export class AvailabilityModule {}
