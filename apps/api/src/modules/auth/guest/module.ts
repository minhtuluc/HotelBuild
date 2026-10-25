import { Module } from '@nestjs/common';
import type { Provider } from '@nestjs/common';
import type { Clock } from '@pinehill/domain';
import { AuditWriter } from '../../../infrastructure/audit/audit-writer.js';
import { CLOCK } from '../../../infrastructure/ports.js';
import { LoginAttempts } from '../login-attempts.js';
import { GuestAuthController } from './controller.js';
import { GuestAuthService } from './service.js';

const auditWriterProvider: Provider = {
  provide: AuditWriter,
  inject: [CLOCK],
  useFactory: (clock: Clock): AuditWriter => new AuditWriter(clock),
};

@Module({
  controllers: [GuestAuthController],
  providers: [GuestAuthService, LoginAttempts, auditWriterProvider],
})
export class GuestAuthModule {}
