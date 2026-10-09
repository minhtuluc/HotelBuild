import { Module } from '@nestjs/common';
import type { Provider } from '@nestjs/common';
import type { Clock } from '@pinehill/domain';
import { AuditWriter } from '../../infrastructure/audit/audit-writer.js';
import { CLOCK } from '../../infrastructure/ports.js';
import { AuthController } from './auth.controller.js';
import { AuthService } from './auth.service.js';
import { authPermissions } from './permissions.js';
import { LoginAttempts } from './login-attempts.js';

const auditWriterProvider: Provider = {
  provide: AuditWriter,
  inject: [CLOCK],
  useFactory: (clock: Clock): AuditWriter => new AuditWriter(clock),
};

@Module({
  controllers: [AuthController],
  providers: [AuthService, LoginAttempts, auditWriterProvider, authPermissions],
  exports: [AuthService],
})
export class AuthModule {}
