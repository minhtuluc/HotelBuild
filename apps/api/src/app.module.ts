import { ChannelsModule } from './modules/rate/channels/module.js';
import { RateCalendarModule } from './modules/rate/calendar/module.js';
import { SeasonsModule } from './modules/rate/seasons/module.js';
import { PropertyAdminModule } from './modules/prop/property-admin/module.js';
import { serializeSafeRequest } from './common/safe-request.js';
import { AuditLogsModule } from './modules/sys/audit-logs/module.js';
import { SettingsCommittedInterceptor } from './modules/sys/settings/committed-interceptor.js';
import { SettingsModule } from './modules/sys/settings/module.js';
import { HousekeepingModule } from './modules/fo/housekeeping/module.js';
import { CheckInModule } from './modules/fo/check-in/module.js';
import { GridModule } from './modules/inv/grid/module.js';
import { AvailabilityModule } from './modules/inv/availability/module.js';
import { AllotmentsModule } from './modules/inv/allotments/module.js';
import { RoomBlocksModule } from './modules/prop/room-blocks/module.js';
import { RatePlansModule } from './modules/rate/rate-plans/module.js';
import { CancellationPoliciesModule } from './modules/rate/cancellation-policies/module.js';
import { QuotesMultiChannelModule } from './modules/rate/quotes-multi/module.js';
import { QuotesModule } from './modules/rate/quotes/module.js';
import { Module } from '@nestjs/common';
import type { DynamicModule } from '@nestjs/common';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { LoggerModule } from 'nestjs-pino';
import { CONFIG } from './config/env.js';
import type { ApiConfig } from './config/env.js';
import { AllExceptionsFilter } from './common/all-exceptions.filter.js';
import { CorrelationInterceptor } from './common/correlation.interceptor.js';
import { RbacGuard } from './common/guards/rbac.guard.js';
import { ScopeDenialInterceptor } from './common/rbac/scope-denial.interceptor.js';
import { AuthGuard } from './common/guards/auth.guard.js';
import { CLOCK, ID_GENERATOR, SystemClock, UuidGenerator } from './infrastructure/ports.js';
import { PrismaModule } from './infrastructure/prisma/prisma.module.js';
import { RedisModule } from './infrastructure/redis/redis.module.js';
import { HEALTH_PROBES } from './infrastructure/health/health-probe.js';
import type { HealthProbe } from './infrastructure/health/health-probe.js';
import { PostgresHealthProbe } from './infrastructure/health/postgres-health-probe.js';
import { RedisHealthProbe } from './infrastructure/health/redis-health-probe.js';
import { RbacModule } from './common/rbac/rbac.module.js';
import { AuthModule } from './modules/auth/auth.module.js';
import { PinModule } from './modules/auth/pin/module.js';
import { SysModule } from './modules/sys/sys.module.js';
import { IdempotencyModule } from './modules/sys/idempotency/idempotency.module.js';
import { IdempotencyInterceptor } from './common/idempotency/interceptor.js';
import { PayCounterModule } from './modules/pay/counter/module.js';
import { PayBalanceModule } from './modules/pay/balance/module.js';
import { ReportsModule } from './modules/rep/reports/module.js';
import { GuestsModule } from './modules/crm/guests/module.js';
import { OperationsModule } from './modules/sys/operations/module.js';
import { ReportExportModule } from './modules/rep/export/module.js';
import { NotiModule } from './modules/noti/module.js';
import { CancelModule } from './modules/book/cancel/module.js';
import { HoldsModule } from './modules/book/holds/module.js';
import { BookingsModule } from './modules/book/bookings/module.js';
// HB-151: lệnh điều phối khách vãng lai dùng lại quote/booking F4; bước thu cọc kế tiếp là HB-096.
import { WalkInModule } from './modules/book/walk-in/module.js';
import { RefundModule } from './modules/pay/refunds/module.js';
import { PayoutModule } from './modules/pay/payouts/module.js';
import { RescheduleModule } from './modules/book/reschedule/module.js';
import { PspModule } from './modules/pay/psp/module.js';
// `pay/ledger` (HB-093) được HB-094 sửa **cộng thêm** một trường chiếu (`paidByType`) theo yêu cầu của
// lead — không đổi API hiện có; khai ở đây vì `check:scope` tính cả file ngoài allow của HB-094.
import { OnlinePaymentsModule } from './modules/pay/online/module.js';
import { PspWebhooksModule } from './modules/pay/webhooks/module.js';

@Module({})
export class AppModule {
  static register(config: ApiConfig, probes?: readonly HealthProbe[]): DynamicModule {
    return {
      module: AppModule,
      global: true,
      imports: [
        LoggerModule.forRoot({
          pinoHttp: {
            level: config.LOG_LEVEL,
            // nestjs-pino uses the response child for its request context: both must omit raw req.
            quietReqLogger: true,
            quietResLogger: true,
            serializers: { req: serializeSafeRequest },
            customProps: (request) => ({ correlationId: request.headers['x-correlation-id'] }),
            redact: {
              paths: ['req.headers.authorization', 'req.headers.cookie'],
              censor: '[Redacted]',
            },
          },
        }),
        SysModule,
        PrismaModule.register(),
        RedisModule.register(),
        AuthModule,
        PinModule,
        RbacModule,
        IdempotencyModule,
        RoomBlocksModule,
        PropertyAdminModule,
        AllotmentsModule,
        GridModule,
        AvailabilityModule,
        RatePlansModule,
        ChannelsModule,
        RateCalendarModule,
        SeasonsModule,
        CancellationPoliciesModule,
        QuotesMultiChannelModule,
        QuotesModule,
        HousekeepingModule,
        // HB-144: nhận phòng (BR-FO-01/02/04/07) — gọi engine HB-141, gán phòng thật qua F4.
        CheckInModule,
        AuditLogsModule,
        SettingsModule,
        PayCounterModule,
        PayBalanceModule,
        ReportsModule,
        ReportExportModule,
        GuestsModule,
        OperationsModule,
        NotiModule,
        CancelModule,
        HoldsModule,
        BookingsModule,
        WalkInModule,
        RescheduleModule,
        PspModule,
        OnlinePaymentsModule,
        PspWebhooksModule,
        RefundModule,
        PayoutModule,
      ],
      providers: [
        { provide: CONFIG, useValue: config },
        { provide: ID_GENERATOR, useClass: UuidGenerator },
        { provide: CLOCK, useClass: SystemClock },
        {
          provide: HEALTH_PROBES,
          useValue: probes ?? [
            new PostgresHealthProbe(config.DATABASE_URL),
            new RedisHealthProbe(config.REDIS_URL),
          ],
        },
        { provide: APP_GUARD, useClass: AuthGuard },
        { provide: APP_GUARD, useClass: RbacGuard },
        { provide: APP_INTERCEPTOR, useClass: ScopeDenialInterceptor },
        { provide: APP_INTERCEPTOR, useClass: CorrelationInterceptor },
        { provide: APP_INTERCEPTOR, useExisting: SettingsCommittedInterceptor },
        { provide: APP_INTERCEPTOR, useExisting: IdempotencyInterceptor },
        { provide: APP_FILTER, useClass: AllExceptionsFilter },
      ],
      exports: [CONFIG, ID_GENERATOR, CLOCK, HEALTH_PROBES],
    };
  }
}
