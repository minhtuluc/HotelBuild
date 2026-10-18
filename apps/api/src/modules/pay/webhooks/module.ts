/**
 * Module webhook PSP (HB-095). Nhập `InboxModule` (hộp thư vào bền **dùng chung** với OTA — HB-128)
 * và `PspModule` (adapter/cấu hình cổng của HB-094): webhook không dựng adapter thứ hai và không đọc
 * cấu hình riêng. `BookingLedger`/`AuditWriter` tiêm cùng kiểu như `pay/online/module.ts`; `PspWebhookService`
 * dùng `@Inject` tường minh trên từng tham số (vitest/esbuild không phát emitDecoratorMetadata).
 */
import { Module } from '@nestjs/common';
import type { Clock } from '@pinehill/domain';
import { AuditWriter } from '../../../infrastructure/audit/audit-writer.js';
import { CLOCK } from '../../../infrastructure/ports.js';
import { InboxModule } from '../../integrations/inbox/module.js';
import { BookingLedger } from '../ledger/service.js';
import { PspModule } from '../psp/module.js';
import { PspWebhookController } from './controller.js';
import { PspWebhookService } from './service.js';

@Module({
  imports: [InboxModule, PspModule],
  controllers: [PspWebhookController],
  providers: [
    {
      provide: AuditWriter,
      inject: [CLOCK],
      useFactory: (clock: Clock) => new AuditWriter(clock),
    },
    {
      provide: BookingLedger,
      inject: [CLOCK],
      useFactory: (clock: Clock) => new BookingLedger(clock),
    },
    PspWebhookService,
  ],
})
export class PspWebhooksModule {}
