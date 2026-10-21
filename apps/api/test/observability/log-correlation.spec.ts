import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { Controller, Get, Module, Query } from '@nestjs/common';
import type { DynamicModule } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { getLoggerToken, LoggerModule, PARAMS_PROVIDER_TOKEN } from 'nestjs-pino';
import type { PinoLogger } from 'nestjs-pino';
import { InjectPinoLogger } from 'nestjs-pino';
import request from 'supertest';
import { expect, it } from 'vitest';
import { z } from 'zod';
import { AppModule } from '../../src/app.module.js';
import { AllExceptionsFilter } from '../../src/common/all-exceptions.filter.js';
import type { ErrorLogger } from '../../src/common/all-exceptions.filter.js';
import { loadConfig } from '../../src/config/env.js';
import { AppError } from '../../src/common/app-error.js';
import { SystemClock, UuidGenerator } from '../../src/infrastructure/ports.js';
import {
  currentTraceId,
  currentTraceparent,
} from '../../src/infrastructure/tracing/trace-context.js';
import { startTracing } from '../../src/infrastructure/tracing/tracing.js';
import type { Tracing } from '../../src/infrastructure/tracing/tracing.js';
import { createLogger } from '../../../worker/src/pino.logger.js';
import {
  newTrace as newWorkerTrace,
  runWithTrace as runWorkerTrace,
} from '../../../worker/src/tracing/trace-context.js';
import { TracingInterceptor } from '../../src/infrastructure/tracing/tracing.interceptor.js';

const INCOMING_TRACEPARENT = '00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01';
const INCOMING_TRACE_ID = '4bf92f3577b34da6a3ce929d0e0e4736';
const CORRELATION_ID = 'hb181-log-correlation';
const STREAM_WRITE_TIMEOUT_MS = 250;

/** Một dòng log pino là object JSON phẳng; parse ở biên thay vì tin vào `JSON.parse`. */
const logRecordSchema = z.record(z.string(), z.unknown());
const pinoParamsSchema = z.looseObject({ pinoHttp: z.record(z.string(), z.unknown()) });

const config = loadConfig({
  DATABASE_URL: 'postgresql://unused:unused@127.0.0.1/unused',
  REDIS_URL: 'redis://127.0.0.1:6379',
  JWT_ACCESS_SECRET: 'unused',
  JWT_REFRESH_SECRET: 'unused',
  BUSINESS_TIMEZONE: 'Asia/Ho_Chi_Minh',
});

@Controller('probe')
class ProbeController {
  constructor(@InjectPinoLogger(ProbeController.name) private readonly logger: PinoLogger) {}

  @Get('ok')
  ok(@Query('phone') _phone: string): { traceId: string | null; traceparent: string | null } {
    this.logger.info({ route: 'probe.ok' }, 'xử lý xong');
    return { traceId: currentTraceId(), traceparent: currentTraceparent() };
  }

  @Get('fail')
  fail(): never {
    this.logger.info({ route: 'probe.fail' }, 'bắt đầu xử lý');
    // Lỗi không lường trước ⇒ filter ghi log lỗi (lỗi đã biết như `AppError` trả về im lặng).
    throw new Error('boom');
  }

  @Get('not-found')
  notFound(): never {
    // 4xx: kết quả nghiệp vụ, không được đánh dấu span ERROR (HB-181 review P2).
    throw new AppError(404, 'E_GEN_NOT_FOUND', 'Không tìm thấy tài nguyên.');
  }
}

@Module({ controllers: [ProbeController] })
class ProbeModule {}

function isDynamicModule(entry: unknown): entry is DynamicModule {
  return typeof entry === 'object' && entry !== null && 'module' in entry;
}

/** Sao y cấu hình LoggerModule **thật** của API nhưng trỏ pino vào bộ đệm của test. */
function productionLogger(stream: { write(chunk: string): void }): DynamicModule {
  const imports = AppModule.register(config).imports;
  const registered = imports?.find(
    (entry): entry is DynamicModule => isDynamicModule(entry) && entry.module === LoggerModule,
  );
  if (!registered?.providers) throw Error('Expected production LoggerModule registration');
  const providers = registered.providers.map((provider) => {
    if (typeof provider !== 'object' || provider === null || !('provide' in provider))
      return provider;
    if (provider.provide !== PARAMS_PROVIDER_TOKEN || !('useValue' in provider)) return provider;
    const params = pinoParamsSchema.safeParse(provider.useValue);
    if (!params.success) throw Error('Expected production Pino options');
    return {
      provide: PARAMS_PROVIDER_TOKEN,
      useValue: { ...params.data, pinoHttp: [params.data.pinoHttp, stream] },
    };
  });
  return { ...registered, providers };
}

it('mọi dòng log mang traceId/correlationId và không lộ PII/token', async () => {
  const privateValues = ['0905123456', `${randomUUID()}@example.test`, `token-${randomUUID()}`];
  let output = '';
  const records: Record<string, unknown>[] = [];
  const logging = productionLogger({
    write(chunk) {
      output += chunk;
      const parsed: unknown = JSON.parse(chunk);
      records.push(logRecordSchema.parse(parsed));
    },
  });
  const app = await NestFactory.create<NestFastifyApplication>(
    { module: ProbeModule, imports: [logging] },
    new FastifyAdapter(),
    { logger: false },
  );
  try {
    const logger = app.get<ErrorLogger>(getLoggerToken(AllExceptionsFilter.name));
    app.useGlobalFilters(new AllExceptionsFilter(new SystemClock(), new UuidGenerator(), logger));
    // SDK tắt (endpoint trống) ⇒ chỉ kiểm phần lan truyền + log, đúng mặc định của dev. Ghi lại mọi
    // `fail(status, errorCode)` để chứng minh 4xx không bị đánh dấu lỗi server.
    const failures: { status: number; errorCode: string | null }[] = [];
    const tracing = startTracing({
      serviceName: 'api',
      environment: 'test',
      endpoint: undefined,
    });
    const recordingTracing: Tracing = {
      ...tracing,
      startServerSpan: (trace, name, attributes) => {
        const span = tracing.startServerSpan(trace, name, attributes);
        return {
          ...span,
          fail: (status, errorCode) => {
            failures.push({ status, errorCode });
            span.fail(status, errorCode);
          },
        };
      },
    };
    app.useGlobalInterceptors(
      new TracingInterceptor(recordingTracing, new UuidGenerator(), config),
    );
    await app.listen({ port: 0, host: '127.0.0.1' });
    const baseUrl = await app.getUrl();

    const ok = await request(baseUrl)
      .get('/probe/ok')
      .query({ phone: privateValues[0] })
      .set('Authorization', `Bearer ${privateValues[2]}`)
      .set('Cookie', `session=${privateValues[2]}`)
      .set('X-Correlation-Id', CORRELATION_ID)
      .set('traceparent', INCOMING_TRACEPARENT);
    expect(ok.status).toBe(200);
    const traceProbe = z.object({ traceId: z.string(), traceparent: z.string() }).parse(ok.body);
    expect(traceProbe.traceId).toBe(INCOMING_TRACE_ID);
    expect(traceProbe.traceparent).toBe(INCOMING_TRACEPARENT);

    const failed = await request(baseUrl)
      .get('/probe/fail')
      .set('X-Correlation-Id', CORRELATION_ID)
      .set('traceparent', INCOMING_TRACEPARENT);
    expect(failed.status).toBe(500);

    const notFound = await request(baseUrl)
      .get('/probe/not-found')
      .set('X-Correlation-Id', CORRELATION_ID)
      .set('traceparent', INCOMING_TRACEPARENT);
    expect(notFound.status).toBe(404);
    expect(failures).toEqual([
      { status: 500, errorCode: null },
      { status: 404, errorCode: 'E_GEN_NOT_FOUND' },
    ]);

    // Chờ dòng log hoàn tất của pino-http (ghi ở sự kiện `finish` của response).
    const flushed = Promise.withResolvers<void>();
    setTimeout(flushed.resolve, STREAM_WRITE_TIMEOUT_MS);
    await flushed.promise;

    expect(records.length).toBeGreaterThan(0);
    for (const record of records) {
      expect(record.traceId, 'mỗi dòng log phải có traceId').toBe(INCOMING_TRACE_ID);
      expect(record.correlationId, 'mỗi dòng log phải có correlationId').toBe(CORRELATION_ID);
    }
    // Log nghiệp vụ và log lỗi đều nằm trong mẫu ⇒ phép kiểm không chỉ chạm middleware HTTP.
    expect(records.some((row) => row.msg === 'xử lý xong')).toBe(true);
    expect(records.some((row) => row.context === AllExceptionsFilter.name)).toBe(true);

    for (const value of privateValues) {
      expect(output.includes(value), 'PII/token không được vào log').toBe(false);
      expect(output.includes(encodeURIComponent(value))).toBe(false);
    }
  } finally {
    await app.close();
  }
});

it('log worker trong job mang cùng traceId/correlationId (AC2 cho cả worker)', () => {
  const lines: string[] = [];
  const logger = createLogger('info', {
    write: (chunk: string) => {
      lines.push(chunk);
    },
  });
  const trace = newWorkerTrace('hb181-worker', true);
  runWorkerTrace(trace, () => logger.info({ queue: 'q.hold-expiry' }, 'quét hết hạn'));
  const record = logRecordSchema.parse(JSON.parse(lines[0] ?? ''));
  expect(record).toMatchObject({
    service: 'worker',
    traceId: trace.traceId,
    correlationId: 'hb181-worker',
    queue: 'q.hold-expiry',
  });
});
