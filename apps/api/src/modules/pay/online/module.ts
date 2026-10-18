/**
 * Module `POST /payments/online` + `GET /payments/{paymentId}/status` (HB-094, UC-PAY-02).
 *
 * Nhập `PspModule` để dùng **cùng** adapter/cấu hình cổng với webhook (HB-095 sẽ dùng lại
 * `PAYMENT_GATEWAYS`, không dựng adapter thứ hai). `BookingLedger` (HB-093) là nguồn số của nghĩa vụ;
 * `AuditWriter` (HB-009) ghi trong **cùng** transaction của use case (BR-GEN-07).
 */
import { Module } from '@nestjs/common';
import type { PrismaClient } from '@prisma/client';
import type { Clock } from '@pinehill/domain';
import { AuditWriter } from '../../../infrastructure/audit/audit-writer.js';
import { PRISMA } from '../../../infrastructure/prisma/prisma.module.js';
import { CLOCK } from '../../../infrastructure/ports.js';
import { PermissionRegistry } from '../../../common/rbac/permission-registry.js';
import { BookingLedger } from '../ledger/service.js';
import { PAYMENT_GATEWAYS, PaymentGateways } from '../psp/gateways.js';
import { PspModule } from '../psp/module.js';
import { OnlinePaymentAccess } from './access.js';
import { OnlinePaymentsController } from './controller.js';
import { onlinePaymentPermissions } from './permissions.js';
import { OnlinePaymentsService } from './service.js';

@Module({
  imports: [PspModule],
  controllers: [OnlinePaymentsController],
  providers: [
    OnlinePaymentAccess,
    onlinePaymentPermissions,
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
    {
      provide: OnlinePaymentsService,
      inject: [PRISMA, BookingLedger, PAYMENT_GATEWAYS, PermissionRegistry, AuditWriter],
      useFactory: (
        db: PrismaClient,
        ledger: BookingLedger,
        gateways: PaymentGateways,
        permissions: PermissionRegistry,
        audit: AuditWriter,
      ) => new OnlinePaymentsService(db, ledger, gateways, permissions, audit),
    },
  ],
})
export class OnlinePaymentsModule {}
