import { RUNTIME_SETTINGS } from './runtime-port.js';
import { RuntimeSettingsReader } from './runtime.js';
import { SettingsCommittedInterceptor } from './committed-interceptor.js';
import { Module } from '@nestjs/common';
import type { PrismaClient } from '@prisma/client';
import { PRISMA } from '../../../infrastructure/prisma/prisma.module.js';
import { permissionProvider } from '../../../common/rbac/permissions.js';
import { SettingsController } from './controller.js';
import { SettingsService } from './service.js';
import { CLOCK } from '../../../infrastructure/ports.js';
import type { Clock } from '@pinehill/domain';
import { SettingsETagInterceptor } from './etag-interceptor.js';
import { SettingsAccess } from './access.js';
@Module({
  exports: [RUNTIME_SETTINGS, SettingsCommittedInterceptor],
  controllers: [SettingsController],
  providers: [
    SettingsAccess,
    SettingsCommittedInterceptor,
    {
      provide: RUNTIME_SETTINGS,
      inject: [PRISMA, CLOCK],
      useFactory: (db: PrismaClient, clock: Clock) => new RuntimeSettingsReader(db, clock),
    },
    SettingsETagInterceptor,
    permissionProvider('sys-settings', {
      'systemSettings.read': ['OWNER'],
      'systemSettings.update': ['OWNER'],
    }),
    {
      provide: SettingsService,
      inject: [PRISMA, CLOCK],
      useFactory: (db: PrismaClient, clock: Clock) => new SettingsService(db, clock),
    },
  ],
})
export class SettingsModule {}
