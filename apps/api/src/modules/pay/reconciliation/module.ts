/**
 * Module chốt đối soát ngày (HB-150, UC-PAY-05): `POST /reconciliation/daily/close`.
 */
import { Module } from '@nestjs/common';
import type { Clock } from '@pinehill/domain';
import { AuditWriter } from '../../../infrastructure/audit/audit-writer.js';
import { CLOCK } from '../../../infrastructure/ports.js';
import { NotificationGateway } from '../../noti/gateway.js';
import { NotiModule } from '../../noti/module.js';
import { ReconciliationAccess } from './access.js';
import { ReconciliationController } from './controller.js';
import { reconciliationPermissions } from './permissions.js';
import { ReconciliationService } from './service.js';

@Module({
  imports: [NotiModule],
  controllers: [ReconciliationController],
  providers: [
    ReconciliationAccess,
    reconciliationPermissions,
    {
      provide: AuditWriter,
      inject: [CLOCK],
      useFactory: (clock: Clock) => new AuditWriter(clock),
    },
    {
      provide: ReconciliationService,
      inject: [CLOCK, AuditWriter, NotificationGateway],
      useFactory: (clock: Clock, audit: AuditWriter, notifications: NotificationGateway) =>
        new ReconciliationService(clock, audit, notifications),
    },
  ],
})
export class ReconciliationModule {}
