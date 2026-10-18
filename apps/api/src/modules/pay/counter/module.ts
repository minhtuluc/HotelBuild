/**
 * Module thu tiền tại quầy (HB-096, UC-PAY-01/03): `POST /payments`.
 * `AuditWriter` (HB-009) ghi cùng transaction của use case; sổ cái HB-093 là nguồn số duy nhất.
 */
import { Module } from '@nestjs/common';
import type { Clock, IdGenerator } from '@pinehill/domain';
import { AuditWriter } from '../../../infrastructure/audit/audit-writer.js';
import { CLOCK, ID_GENERATOR } from '../../../infrastructure/ports.js';
import { CounterAccess } from './access.js';
import { CounterController } from './controller.js';
import { counterPermissions } from './permissions.js';
import { CounterService } from './service.js';

@Module({
  controllers: [CounterController],
  providers: [
    CounterAccess,
    counterPermissions,
    {
      provide: AuditWriter,
      inject: [CLOCK],
      useFactory: (clock: Clock) => new AuditWriter(clock),
    },
    {
      provide: CounterService,
      inject: [CLOCK, ID_GENERATOR, AuditWriter],
      useFactory: (clock: Clock, ids: IdGenerator, audit: AuditWriter) =>
        new CounterService(clock, ids, audit),
    },
  ],
})
export class PayCounterModule {}
