import { Module } from '@nestjs/common';
import type { Provider } from '@nestjs/common';
import type { Clock } from '@pinehill/domain';
import { AuditWriter } from '../../../../infrastructure/audit/audit-writer.js';
import { MailModule } from '../../../../infrastructure/mail/mail.module.js';
import { CLOCK } from '../../../../infrastructure/ports.js';
import { PasswordResetAttempts } from './attempts.js';
import { PasswordResetController } from './controller.js';
import { PasswordResetService } from './service.js';

const auditWriterProvider: Provider = {
  provide: AuditWriter,
  inject: [CLOCK],
  useFactory: (clock: Clock): AuditWriter => new AuditWriter(clock),
};

/** HB-028: quên mật khẩu khách qua email. Route công khai nên không cần khai báo permission. */
@Module({
  imports: [MailModule],
  controllers: [PasswordResetController],
  providers: [PasswordResetService, PasswordResetAttempts, auditWriterProvider],
})
export class GuestPasswordResetModule {}
