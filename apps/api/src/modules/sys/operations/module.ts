import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Module } from '@nestjs/common';
import type { PrismaClient } from '@prisma/client';
import { CONFIG } from '../../../config/env.js';
import type { ApiConfig } from '../../../config/env.js';
import { PRISMA } from '../../../infrastructure/prisma/prisma.module.js';
import { OperationsController } from './controller.js';
import { operationsPermissions } from './permissions.js';
import { OperationsService } from './service.js';

/** Cùng giá trị mặc định với `apps/worker` (worker ghi tệp, API đọc tệp). */
export const DEFAULT_EXPORT_DIR = join(tmpdir(), 'pinehill-exports');

@Module({
  controllers: [OperationsController],
  providers: [
    operationsPermissions,
    {
      provide: OperationsService,
      inject: [PRISMA, CONFIG],
      useFactory: (db: PrismaClient, config: ApiConfig) =>
        new OperationsService(
          db,
          config.EXPORT_DIR ?? DEFAULT_EXPORT_DIR,
          config.JWT_ACCESS_SECRET,
        ),
    },
  ],
})
export class OperationsModule {}
