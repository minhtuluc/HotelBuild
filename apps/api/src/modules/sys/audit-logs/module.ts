import { Module } from '@nestjs/common';
import type { PrismaClient } from '@prisma/client';
import { PRISMA } from '../../../infrastructure/prisma/prisma.module.js';
import { permissionProvider } from '../../../common/rbac/permissions.js';
import { AuditLogsController } from './controller.js';
import { AuditLogsService } from './service.js';
@Module({
  controllers: [AuditLogsController],
  providers: [
    permissionProvider('sys-audit-read', { 'auditLogs.read': ['OWNER', 'MANAGER'] }),
    {
      provide: AuditLogsService,
      inject: [PRISMA],
      useFactory: (db: PrismaClient) => new AuditLogsService(db),
    },
  ],
})
export class AuditLogsModule {}
