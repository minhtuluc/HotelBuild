import { serializeSafeRequest } from './common/safe-request.js';
import { RoomBlocksModule } from './modules/prop/room-blocks/module.js';
import { RatePlansModule } from './modules/rate/rate-plans/module.js';
import { CancellationPoliciesModule } from './modules/rate/cancellation-policies/module.js';
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
import { SysModule } from './modules/sys/sys.module.js';
import { IdempotencyModule } from './modules/sys/idempotency/idempotency.module.js';
import { IdempotencyInterceptor } from './common/idempotency/interceptor.js';

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
        RbacModule,
        IdempotencyModule,
        RoomBlocksModule,
        RatePlansModule,
        CancellationPoliciesModule,
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
        { provide: APP_INTERCEPTOR, useExisting: IdempotencyInterceptor },
        { provide: APP_FILTER, useClass: AllExceptionsFilter },
      ],
      exports: [CONFIG, ID_GENERATOR, CLOCK, HEALTH_PROBES],
    };
  }
}
