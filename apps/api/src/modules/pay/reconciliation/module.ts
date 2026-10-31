/**
 * Module chốt đối soát ngày (HB-150, UC-PAY-05): `POST /reconciliation/daily/close`.
 */
import { Module } from '@nestjs/common';
import type { Clock } from '@pinehill/domain';
import { AuditWriter } from '../../../infrastructure/audit/audit-writer.js';
import { CLOCK } from '../../../infrastructure/ports.js';
import { ReconciliationAccess } from './access.js';
import { ReconciliationController } from './controller.js';
import { reconciliationPermissions } from './permissions.js';
import { ReconciliationService } from './service.js';

@Module({
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
      inject: [CLOCK, AuditWriter],
      useFactory: (clock: Clock, audit: AuditWriter) => new ReconciliationService(clock, audit),
    },
  ],
})
export class ReconciliationModule {}
