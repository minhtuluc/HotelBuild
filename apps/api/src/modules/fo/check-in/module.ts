/**
 * Module tiền sảnh — nhận phòng (HB-144). `AuditWriter` (HB-009) ghi cùng transaction của use case;
 * sổ cái HB-093 giữ số dư, engine HB-141 giữ luật check-in.
 */
import { Module } from '@nestjs/common';
import type { Clock } from '@pinehill/domain';
import { AuditWriter } from '../../../infrastructure/audit/audit-writer.js';
import { CLOCK } from '../../../infrastructure/ports.js';
import { CheckInAccess } from './access.js';
import { CheckInController } from './controller.js';
import { checkInPermissions } from './permissions.js';
import { CheckInService } from './service.js';

@Module({
  controllers: [CheckInController],
  providers: [
    CheckInAccess,
    checkInPermissions,
    {
      provide: AuditWriter,
      inject: [CLOCK],
      useFactory: (clock: Clock) => new AuditWriter(clock),
    },
    {
      provide: CheckInService,
      inject: [CLOCK, AuditWriter],
      useFactory: (clock: Clock, audit: AuditWriter) => new CheckInService(clock, audit),
    },
  ],
})
export class CheckInModule {}
