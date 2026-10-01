import { afterEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import type { FastifyInstance } from 'fastify';
import { errorBodySchema } from '@pinehill/contracts';
import { createApp } from '../src/main.js';
import type { ApiConfig } from '../src/config/env.js';
import type { HealthProbe } from '../src/infrastructure/health/health-probe.js';

const testConfig: ApiConfig = {
  DATABASE_URL: 'postgresql://unused:unused@127.0.0.1:5432/unused',
  REDIS_URL: 'redis://127.0.0.1:6379',
  JWT_ACCESS_SECRET: 'test-access-secret',
  JWT_REFRESH_SECRET: 'test-refresh-secret',
  BUSINESS_TIMEZONE: 'Asia/Ho_Chi_Minh',
  IDEMPOTENCY_TTL_HOURS: 24,
  LOG_LEVEL: 'silent',
  PORT: 0,
};

const up = (name: string): HealthProbe => ({ name, check: () => Promise.resolve(true) });
const down = (name: string): HealthProbe => ({ name, check: () => Promise.resolve(false) });
const throwing = (name: string): HealthProbe => ({
  name,
  check: () => Promise.reject(new Error('SECRET_INTERNAL_xyz')),
});

const opened: NestFastifyApplication[] = [];

function isFastifyInstance(value: unknown): value is FastifyInstance {
  return typeof value === 'object' && value !== null && 'server' in value && 'ready' in value;
}

async function start(probes: readonly HealthProbe[]): Promise<FastifyInstance['server']> {
  const app = await createApp(testConfig, probes);
  opened.push(app);
  const instance: unknown = app.getHttpAdapter().getInstance();
  if (!isFastifyInstance(instance)) {
    throw new Error('Fastify adapter phải trả về FastifyInstance');
  }
  return instance.server;
}

afterEach(async () => {
  await Promise.all(opened.splice(0).map((app) => app.close()));
});

describe('GET /api/v1/system/health', () => {
  it('trả {status:"ok"} khi mọi phụ thuộc sống', async () => {
    const server = await start([up('postgres'), up('redis')]);
    const res = await request(server).get('/api/v1/system/health');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ok' });
  });
  it('trả 503 + E_GEN_SERVICE_UNAVAILABLE khi một phụ thuộc chết', async () => {
    const server = await start([up('postgres'), down('redis')]);
    const res = await request(server).get('/api/v1/system/health');
    const body: unknown = res.body;
    expect(res.status).toBe(503);
    expect(errorBodySchema.parse(body).code).toBe('E_GEN_SERVICE_UNAVAILABLE');
  });
  it('giữ X-Correlation-Id gửi tới; X-Trace-Id và traceId khớp mã đó', async () => {
    const server = await start([up('postgres'), down('redis')]);
    const res = await request(server)
      .get('/api/v1/system/health')
      .set('X-Correlation-Id', 'cid-123');
    const body: unknown = res.body;
    expect(res.headers['x-trace-id']).toBe('cid-123');
    expect(errorBodySchema.parse(body).traceId).toBe('cid-123');
  });
  it('sinh correlation id dạng UUID khi client không gửi', async () => {
    const server = await start([up('postgres'), down('redis')]);
    const res = await request(server).get('/api/v1/system/health');
    const body: unknown = res.body;
    const parsed = errorBodySchema.parse(body);
    expect(res.headers['x-trace-id']).toBe(parsed.traceId);
    expect(parsed.traceId).toMatch(/^[0-9a-f-]{36}$/);
  });
  it('lỗi lạ → 500 E_GEN_SERVICE_UNAVAILABLE, không lộ chi tiết nội bộ', async () => {
    const server = await start([throwing('postgres')]);
    const res = await request(server).get('/api/v1/system/health');
    const body: unknown = res.body;
    const parsed = errorBodySchema.parse(body);
    expect(res.status).toBe(500);
    expect(parsed.code).toBe('E_GEN_SERVICE_UNAVAILABLE');
    expect(parsed.message).not.toContain('SECRET_INTERNAL_xyz');
    expect(parsed.traceId.length).toBeGreaterThan(0);
  });
  it('route không tồn tại → 404 E_GEN_NOT_FOUND, giữ X-Trace-Id và traceId', async () => {
    const server = await start([up('postgres'), up('redis')]);
    const res = await request(server).get('/api/v1/nonexistent').set('X-Correlation-Id', 'cid-404');
    const body: unknown = res.body;
    const parsed = errorBodySchema.parse(body);
    expect(res.status).toBe(404);
    expect(parsed.code).toBe('E_GEN_NOT_FOUND');
    expect(res.headers['x-trace-id']).toBe('cid-404');
    expect(parsed.traceId).toBe('cid-404');
  });
  it('route không tồn tại, không header → sinh UUID cho X-Trace-Id', async () => {
    const server = await start([up('postgres'), up('redis')]);
    const res = await request(server).get('/api/v1/nonexistent');
    const body: unknown = res.body;
    const parsed = errorBodySchema.parse(body);
    expect(res.status).toBe(404);
    expect(parsed.traceId).toMatch(/^[0-9a-f-]{36}$/);
    expect(res.headers['x-trace-id']).toBe(parsed.traceId);
  });
});
