import { Module } from '@nestjs/common';
import type { PrismaClient } from '@prisma/client';
import { PRISMA } from '../../../infrastructure/prisma/prisma.module.js';
import { gridPermissions } from './permissions.js';
import { GridController } from './controller.js';
import { GridService } from './service.js';
@Module({
  controllers: [GridController],
  providers: [
    gridPermissions,
    {
      provide: GridService,
      inject: [PRISMA],
      useFactory: (db: PrismaClient) => new GridService(db),
    },
  ],
})
export class GridModule {}
