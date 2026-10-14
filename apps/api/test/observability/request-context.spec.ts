import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { Controller, Get, Module } from '@nestjs/common';
import type { DynamicModule } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import type { FastifyInstance } from 'fastify';
import { getLoggerToken, LoggerModule, PARAMS_PROVIDER_TOKEN } from 'nestjs-pino';
import request from 'supertest';
import { expect, it } from 'vitest';
import { errorBodySchema } from '@pinehill/contracts';
import { AppModule } from '../../src/app.module.js';
import { AllExceptionsFilter } from '../../src/common/all-exceptions.filter.js';
import type { ErrorLogger } from '../../src/common/all-exceptions.filter.js';
import { SystemClock, UuidGenerator } from '../../src/infrastructure/ports.js';

@Controller('request-probe')
class ProbeController {
  @Get(':value') fail(): never {
    throw Error('Controlled failure');
  }
}
@Module({ controllers: [ProbeController] })
class ProbeModule {}
const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
function isFastify(value: unknown): value is FastifyInstance {
  return isRecord(value) && 'ready' in value && 'server' in value;
}
function isDynamic(value: unknown): value is DynamicModule {
  return isRecord(value) && 'module' in value && Array.isArray(value.providers);
}

/** Capture only the destination; consume the actual AppModule logger options and middleware. */
function productionLogger(stream: { write(chunk: string): void }): DynamicModule {
  const imports = AppModule.register({
    DATABASE_URL: 'postgresql://unused:unused@127.0.0.1/unused',
    REDIS_URL: 'redis://127.0.0.1:6379',
    JWT_ACCESS_SECRET: 'unused',
    JWT_REFRESH_SECRET: 'unused',
    BUSINESS_TIMEZONE: 'Asia/Ho_Chi_Minh',
    IDEMPOTENCY_TTL_HOURS: 24,
    LOG_LEVEL: 'info',
    HOST: '127.0.0.1',
    PORT: 0,
  }).imports;
  const registered = imports?.find(
    (entry): entry is DynamicModule => isDynamic(entry) && entry.module === LoggerModule,
  );
  if (!registered?.providers) throw Error('Expected production LoggerModule registration');
  const providers = registered.providers.map((provider) => {
    if (!isRecord(provider) || provider.provide !== PARAMS_PROVIDER_TOKEN) return provider;
    const params: unknown = provider.useValue;
    if (!isRecord(params) || !isRecord(params.pinoHttp))
      throw Error('Expected production Pino options');
    return {
      provide: PARAMS_PROVIDER_TOKEN,
      useValue: { ...params, pinoHttp: [params.pinoHttp, stream] },
    };
  });
  return { ...registered, providers };
}

it('production request-scoped filter and completion logs omit private dynamic paths, query values and headers', async () => {
  const privateValues = [randomUUID() + '@example.test', randomUUID()];
  let output = '';
  const records: Record<string, unknown>[] = [];
  const logging = productionLogger({
    write(chunk) {
      output += chunk;
      const parsed: unknown = JSON.parse(chunk);
      if (!isRecord(parsed)) throw Error('Expected structured production Pino record');
      records.push(parsed);
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
    await app.init();
    const adapter: unknown = app.getHttpAdapter().getInstance();
    if (!isFastify(adapter)) throw Error('Expected actual Fastify instance');
    await adapter.ready();
    const path = '/request-probe/' + encodeURIComponent(privateValues[0]!);
    const response = await request(adapter.server)
      .get(path)
      .query({ token: privateValues[1] })
      .set('Authorization', 'Bearer ' + privateValues[1])
      .set('Cookie', 'session=' + privateValues[1])
      .set('X-Correlation-Id', 'hb181-scoped');
    expect(response.status).toBe(500);
    expect(errorBodySchema.parse(response.body)).toMatchObject({ path, traceId: 'hb181-scoped' });
    const missing = await request(adapter.server).get(
      '/missing/' + encodeURIComponent(privateValues[0]!),
    );
    expect(missing.status).toBe(404);
    const failure = records.find((row) => row.context === AllExceptionsFilter.name);
    expect(failure).toMatchObject({ path: '/request-probe/:value', correlationId: 'hb181-scoped' });
    for (const value of privateValues) {
      expect(
        output.includes(value),
        'Private data must not leak via inherited request bindings',
      ).toBe(false);
      expect(
        output.includes(encodeURIComponent(value)),
        'Encoded private data must not enter production Pino output',
      ).toBe(false);
    }
    expect(failure).not.toHaveProperty('req');
    const completions = records.filter((row) => 'responseTime' in row);
    expect(completions).toHaveLength(2);
    for (const row of completions) {
      expect(row).not.toHaveProperty('req');
      expect(row).toHaveProperty('reqId');
    }
  } finally {
    await app.close();
  }
});
