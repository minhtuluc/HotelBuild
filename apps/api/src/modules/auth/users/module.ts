/**
 * Module người dùng nội bộ (HB-016): controller + service + permission riêng. `AuditWriter` ghi trong
 * transaction của caller nên cần `Clock` (HB-009), như `PinModule`.
 */
import { Module } from '@nestjs/common';
import type { Provider } from '@nestjs/common';
import type { Clock } from '@pinehill/domain';
import { AuditWriter } from '../../../infrastructure/audit/audit-writer.js';
import { CLOCK } from '../../../infrastructure/ports.js';
import { UsersAccess } from './access.js';
import { UsersController } from './controller.js';
import { usersPermissions } from './permissions.js';
import { UsersService } from './service.js';

const auditWriterProvider: Provider = {
  provide: AuditWriter,
  inject: [CLOCK],
  useFactory: (clock: Clock): AuditWriter => new AuditWriter(clock),
};

@Module({
  controllers: [UsersController],
  providers: [UsersService, UsersAccess, auditWriterProvider, usersPermissions],
})
export class UsersModule {}
