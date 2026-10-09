import 'reflect-metadata';
import { Controller, Get, Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import type { FastifyInstance } from 'fastify';
import request from 'supertest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Mock } from 'vitest';
import { errorBodySchema } from '@pinehill/contracts';
import { AllExceptionsFilter } from '../src/common/all-exceptions.filter.js';
import { AppError } from '../src/common/app-error.js';
import { SystemClock, UuidGenerator } from '../src/infrastructure/ports.js';

@Controller('probe')
class ProbeController {
  @Get('known')
  known(): never {
    throw new AppError(404, 'E_GEN_NOT_FOUND', 'Không tìm thấy tài nguyên.');
  }

  /** `message` rỗng ⇒ ứng viên body không khớp `errorBodySchema` ⇒ filter phải thoái hoá về 500. */
  @Get('invalid-body')
  invalidBody(): never {
    throw new AppError(400, 'E_GEN_NOT_FOUND', '');
  }
}

@Module({ controllers: [ProbeController] })
class ProbeModule {}

const opened: NestFastifyApplication[] = [];

function isFastifyInstance(value: unknown): value is FastifyInstance {
  return typeof value === 'object' && value !== null && 'server' in value && 'ready' in value;
}

async function start(): Promise<{ server: FastifyInstance['server']; errors: Mock }> {
  const app = await NestFactory.create<NestFastifyApplication>(ProbeModule, new FastifyAdapter(), {
    logger: false,
  });
  const errors = vi.fn();
  app.useGlobalFilters(
    new AllExceptionsFilter(new SystemClock(), new UuidGenerator(), { error: errors }),
  );
  opened.push(app);
  await app.init();
  const instance: unknown = app.getHttpAdapter().getInstance();
  if (!isFastifyInstance(instance)) {
    throw new Error('Fastify adapter phải trả về FastifyInstance');
  }
  await instance.ready();
  return { server: instance.server, errors };
}

afterEach(async () => {
  await Promise.all(opened.splice(0).map((app) => app.close()));
});

describe('AllExceptionsFilter — đối chiếu errorBodySchema trước khi gửi', () => {
  it('body hợp lệ giữ nguyên mã và trạng thái của AppError', async () => {
    const { server, errors } = await start();
    const res = await request(server).get('/probe/known');
    expect(res.status).toBe(404);
    expect(errorBodySchema.parse(res.body).code).toBe('E_GEN_NOT_FOUND');
    expect(errors).not.toHaveBeenCalled();
  });

  it('body không khớp hợp đồng → 500 E_GEN_SERVICE_UNAVAILABLE và ghi log', async () => {
    const { server, errors } = await start();
    const res = await request(server).get('/probe/invalid-body');
    const parsed = errorBodySchema.parse(res.body);
    expect(res.status).toBe(500);
    expect(parsed.code).toBe('E_GEN_SERVICE_UNAVAILABLE');
    expect(errors).toHaveBeenCalledWith(
      expect.objectContaining({ path: '/probe/invalid-body' }),
      expect.stringContaining('không khớp hợp đồng'),
    );
  });
});

it('query values never enter error-body paths or fallback error log paths', async () => {
  const { server, errors } = await start();
  for (const path of ['/probe/known', '/probe/invalid-body']) {
    const response = await request(server).get(path).query({ reason: 'CCCD012345678934' });
    expect(errorBodySchema.parse(response.body).path).toBe(path);
  }
  expect(JSON.stringify(errors.mock.calls)).not.toContain('012345678934');
});
