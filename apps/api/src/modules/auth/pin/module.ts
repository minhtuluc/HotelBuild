/**
 * Module PIN (HB-015): controller + service + khai báo permission riêng.
 * `AuditWriter` ghi trong transaction của caller nên cần `Clock` (HB-009).
 */
import { Module } from '@nestjs/common';
import type { Provider } from '@nestjs/common';
import type { Clock } from '@pinehill/domain';
import { AuditWriter } from '../../../infrastructure/audit/audit-writer.js';
import { CLOCK } from '../../../infrastructure/ports.js';
import { PinController, UserPinController } from './controller.js';
import { PinService } from './service.js';
import { pinPermissions } from './permissions.js';

const auditWriterProvider: Provider = {
  provide: AuditWriter,
  inject: [CLOCK],
  useFactory: (clock: Clock): AuditWriter => new AuditWriter(clock),
};

@Module({
  controllers: [PinController, UserPinController],
  providers: [PinService, auditWriterProvider, pinPermissions],
})
export class PinModule {}
