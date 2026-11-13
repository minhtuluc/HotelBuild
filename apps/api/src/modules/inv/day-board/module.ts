import { Module } from '@nestjs/common';
import type { PrismaClient } from '@prisma/client';
import { PRISMA } from '../../../infrastructure/prisma/prisma.module.js';
import { dayBoardPermissions } from './permissions.js';
import { DayBoardController } from './controller.js';
import { DayBoardService } from './service.js';

@Module({
  controllers: [DayBoardController],
  providers: [
    dayBoardPermissions,
    {
      provide: DayBoardService,
      inject: [PRISMA],
      useFactory: (db: PrismaClient) => new DayBoardService(db),
    },
  ],
})
export class DayBoardModule {}
