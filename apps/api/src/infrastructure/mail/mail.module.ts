import { Module } from '@nestjs/common';
import type { Provider } from '@nestjs/common';
import { CONFIG } from '../../config/env.js';
import type { ApiConfig } from '../../config/env.js';
import { MAILER } from './mailer.js';
import type { Mailer } from './mailer.js';
import { DEFAULT_MAIL_FROM, SmtpMailer, UnconfiguredMailer } from './smtp-mailer.js';

const mailerProvider: Provider = {
  provide: MAILER,
  inject: [CONFIG],
  useFactory: (config: ApiConfig): Mailer =>
    config.SMTP_URL === undefined
      ? new UnconfiguredMailer()
      : new SmtpMailer(config.SMTP_URL, config.SMTP_FROM ?? DEFAULT_MAIL_FROM),
};

@Module({ providers: [mailerProvider], exports: [MAILER] })
export class MailModule {}
