/**
 * Module tiếp nhận webhook OTA (HB-128). Nhập `InboxModule` (hộp thư bền **dùng chung** với PSP —
 * HB-095) và `SettingsModule` (đọc `chan.ota.accounts` qua `RUNTIME_SETTINGS` có cache 60 giây):
 * không dựng kho inbox thứ hai và không đọc `system_settings` bằng đường riêng.
 *
 * `OtaRawBodyCapture` gắn hook `preParsing` một lần cho cả app — raw bytes phải có trước khi Fastify
 * parse JSON, và production không bật option `rawBody` nào (xem `raw-body.ts`).
 */
import { Inject, Injectable, Module } from '@nestjs/common';
import type { OnModuleInit } from '@nestjs/common';
import { HttpAdapterHost } from '@nestjs/core';
import type { FastifyInstance } from 'fastify';
import type { Clock } from '@pinehill/domain';
import { AuditWriter } from '../../../infrastructure/audit/audit-writer.js';
import { CLOCK } from '../../../infrastructure/ports.js';
import { InboxModule } from '../../integrations/inbox/module.js';
import { SettingsModule } from '../../sys/settings/module.js';
import { OtaWebhookController } from './controller.js';
import { registerOtaRawBody } from './raw-body.js';
import { OtaWebhookService } from './service.js';

@Injectable()
export class OtaRawBodyCapture implements OnModuleInit {
  constructor(@Inject(HttpAdapterHost) private readonly adapter: HttpAdapterHost) {}

  onModuleInit(): void {
    registerOtaRawBody(this.adapter.httpAdapter.getInstance<FastifyInstance>());
  }
}

@Module({
  imports: [InboxModule, SettingsModule],
  controllers: [OtaWebhookController],
  providers: [
    {
      provide: AuditWriter,
      inject: [CLOCK],
      useFactory: (clock: Clock) => new AuditWriter(clock),
    },
    OtaRawBodyCapture,
    OtaWebhookService,
  ],
})
export class ChanWebhooksModule {}
