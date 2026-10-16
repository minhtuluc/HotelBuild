import { Module } from '@nestjs/common';
import type { PrismaClient } from '@prisma/client';
import type { Clock } from '@pinehill/domain';
import { PRISMA } from '../../../infrastructure/prisma/prisma.module.js';
import { CLOCK } from '../../../infrastructure/ports.js';
import { AuditWriter } from '../../../infrastructure/audit/audit-writer.js';
import { permissionProvider } from '../../../common/rbac/permissions.js';
import { CancelAccess } from './access.js';
import { CancelController } from './controller.js';
import { CancelService } from './service.js';

@Module({
  controllers: [CancelController],
  providers: [
    CancelAccess,
    permissionProvider('book-cancel', {
      // api.md §2.5: quầy/điều phối huỷ và xem trước; khách tự huỷ chờ phiên GUEST (HB-017).
      'bookings.cancelPreview': ['FRONT_DESK', 'RESERVATION_AGENT', 'MANAGER', 'OWNER'],
      'bookings.cancel': ['FRONT_DESK', 'RESERVATION_AGENT', 'MANAGER', 'OWNER'],
    }),
    {
      provide: CancelService,
      inject: [PRISMA, CLOCK],
      useFactory: (db: PrismaClient, clock: Clock) =>
        new CancelService(db, clock, new AuditWriter(clock)),
    },
  ],
})
export class CancelModule {}
