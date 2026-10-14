import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { Controller, Get, HttpException, Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import type { FastifyInstance } from 'fastify';
import pino from 'pino';
import request from 'supertest';
import { afterEach, describe, expect, it } from 'vitest';
import { errorBodySchema } from '@pinehill/contracts';
import { AllExceptionsFilter } from '../../src/common/all-exceptions.filter.js';
import { AppError } from '../../src/common/app-error.js';
import { SystemClock, UuidGenerator } from '../../src/infrastructure/ports.js';

const sensitive = {
  email: 'hb181-guest@example.test',
  phone: '0912345678',
  identity: '012345678934',
  token: 'hb181-' + randomUUID(),
  password: 'hb181-' + randomUUID(),
};
const payload = Object.values(sensitive).join(' ');
const dangerousError = () =>
  Object.assign(new Error(payload, { cause: new Error(payload) }), {
    code: sensitive.token,
    detail: payload,
    config: { password: sensitive.password },
  });

@Controller('probe')
class ProbeController {
  @Get('unexpected') unexpected(): never {
    throw dangerousError();
  }
  @Get('http') http(): never {
    throw new HttpException({ message: payload, credentials: sensitive }, 418, {
      cause: dangerousError(),
    });
  }
  @Get('object') object(): never {
    throw { payload, credentials: sensitive };
  }
  @Get('primitive') primitive(): never {
    throw payload;
  }
  @Get('dynamic/:id') dynamic(): never {
    throw dangerousError();
  }
  @Get('invalid-body') invalidBody(): never {
    // A strict-object error mentions unknown key names; those names can themselves be PII.
    const detail = Object.assign(
      { field: 'safeField', issue: 'SAFE_ISSUE' },
      { [sensitive.email]: sensitive.token },
    );
    throw new AppError(400, 'E_GEN_VALIDATION_FAILED', '', undefined, [detail]);
  }
  @Get('known') known(): never {
    throw new AppError(429, 'E_GEN_RATE_LIMITED', 'Yêu cầu quá nhanh.', 3, [
      { field: 'safeField', issue: 'SAFE_ISSUE' },
    ]);
  }
}
@Module({ controllers: [ProbeController] })
class ProbeModule {}
const opened: NestFastifyApplication[] = [];
const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
function isFastify(value: unknown): value is FastifyInstance {
  return isRecord(value) && 'server' in value && 'ready' in value;
}
async function start() {
  const app = await NestFactory.create<NestFastifyApplication>(ProbeModule, new FastifyAdapter(), {
    logger: false,
  });
  opened.push(app);
  let output = '';
  const records: Record<string, unknown>[] = [];
  const logger = pino(
    { level: 'error' },
    {
      write(chunk) {
        output += chunk;
        const record: unknown = JSON.parse(chunk);
        if (!isRecord(record)) throw Error('Expected one structured Pino record');
        records.push(record);
      },
    },
  );
  app.useGlobalFilters(new AllExceptionsFilter(new SystemClock(), new UuidGenerator(), logger));
  await app.init();
  const instance: unknown = app.getHttpAdapter().getInstance();
  if (!isFastify(instance)) throw Error('Expected actual Fastify instance');
  await instance.ready();
  return { server: instance.server, records, output: () => output };
}
afterEach(async () => {
  await Promise.all(opened.splice(0).map((app) => app.close()));
});
function expectPrivate(output: string) {
  for (const marker of Object.values(sensitive)) {
    // Boolean assertions avoid copying sensitive values into failure diagnostics.
    expect(output.includes(marker), 'Raw synthetic private value must not enter Pino output').toBe(
      false,
    );
    expect(
      output.includes(encodeURIComponent(marker)),
      'Encoded private value must not enter Pino output',
    ).toBe(false);
  }
}

describe('HB181 exception log projection through actual Nest/Fastify and Pino', () => {
  it.each(['unexpected', 'http', 'object', 'primitive'])(
    '%s failures keep response correlation without logging raw exception fields',
    async (route) => {
      const app = await start();
      const response = await request(app.server)
        .get('/probe/' + route)
        .query({ token: sensitive.token })
        .set('X-Correlation-Id', 'hb181-correlation');
      const body = errorBodySchema.parse(response.body);
      expect(response.status).toBe(500);
      expect(body.code).toBe('E_GEN_SERVICE_UNAVAILABLE');
      expect(body.traceId).toBe('hb181-correlation');
      expect(response.headers['x-trace-id']).toBe(body.traceId);
      expect(body.path).toBe('/probe/' + route);
      expectPrivate(app.output());
      expect(app.records).toHaveLength(1);
      expect(app.records[0]).toMatchObject({
        correlationId: 'hb181-correlation',
        outcome: 'error',
        errorCode: 'E_GEN_SERVICE_UNAVAILABLE',
        failureKind: route === 'http' ? 'UNMAPPED_HTTP' : 'UNEXPECTED',
        path: '/probe/' + route,
      });
      expect(app.records[0]).not.toHaveProperty('err');
    },
  );
  it('dynamic route values stay out of diagnostic log paths while HTTP path contract remains unchanged', async () => {
    const app = await start();
    const path = '/probe/dynamic/' + encodeURIComponent(sensitive.email);
    const response = await request(app.server).get(path).set('X-Correlation-Id', 'hb181-dynamic');
    expect(response.status).toBe(500);
    expect(errorBodySchema.parse(response.body).path).toBe(path);
    expectPrivate(app.output());
    expect(app.records[0]).toMatchObject({
      path: '/probe/dynamic/:id',
      correlationId: 'hb181-dynamic',
    });
  });
  it('invalid error-body fallback reports only issue counts/codes, never arbitrary Zod key names', async () => {
    const app = await start();
    const response = await request(app.server)
      .get('/probe/invalid-body')
      .set('X-Correlation-Id', 'hb181-fallback');
    expect(response.status).toBe(500);
    const body = errorBodySchema.parse(response.body);
    expect(body.code).toBe('E_GEN_SERVICE_UNAVAILABLE');
    expect(body.traceId).toBe('hb181-fallback');
    expectPrivate(app.output());
    expect(app.records).toHaveLength(1);
    expect(app.records[0]).toMatchObject({
      failureKind: 'INVALID_ERROR_BODY',
      issueCount: 2,
      issueCodes: ['too_small', 'unrecognized_keys'],
      outcome: 'error',
      errorCode: 'E_GEN_SERVICE_UNAVAILABLE',
    });
    expect(app.records[0]).not.toHaveProperty('issues');
  });
  it('known AppError status/message/details/Retry-After remain unchanged and do not generate error logs', async () => {
    const app = await start();
    const response = await request(app.server)
      .get('/probe/known')
      .set('X-Correlation-Id', 'hb181-known');
    expect(response.status).toBe(429);
    expect(response.headers['retry-after']).toBe('3');
    expect(errorBodySchema.parse(response.body)).toMatchObject({
      code: 'E_GEN_RATE_LIMITED',
      message: 'Yêu cầu quá nhanh.',
      retryAfterSeconds: 3,
      traceId: 'hb181-known',
      path: '/probe/known',
      details: [{ field: 'safeField', issue: 'SAFE_ISSUE' }],
    });
    expect(app.output()).toBe('');
    expect(app.records).toEqual([]);
  });
});
