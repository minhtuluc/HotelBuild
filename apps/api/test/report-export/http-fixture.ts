import 'reflect-metadata';
import { randomBytes, randomUUID } from 'node:crypto';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeAll, beforeEach, afterAll, expect } from 'vitest';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { Queue } from 'bullmq';
import { Redis } from 'ioredis';
import request from 'supertest';
import { tokenPairSchema } from '@pinehill/contracts';
import { AppModule } from '../../src/app.module.js';
import { CLOCK } from '../../src/infrastructure/ports.js';
import { REPORT_EXPORT_QUEUE } from '../../src/modules/rep/export/queue.js';
import { databaseUrl, password } from '../idempotency/database.js';
import { rows, clock, userId } from '../reports/seed.js';

let app: NestFastifyApplication, redis: Redis, queue: Queue;

export const http = () => request(app.getHttpServer());
export { rows, clock, userId } from '../reports/seed.js';

/** Thư mục tệp xuất riêng của ca test (worker ghi, API đọc). */
export let exportDir = '';

/** Hàng đợi thật trỏ cùng Redis DB `/7` để đếm job `q.report-export` mà API vừa phát. */
export const exportJobs = () => queue.getJobs(['waiting', 'delayed', 'active', 'paused']);

export async function login(role = 'ACCOUNTANT'): Promise<string> {
  clock.value += 61000;
  await rows('UPDATE users SET role=$1 WHERE id=$2', [role, userId]);
  const response = await http()
    .post('/api/v1/auth/login')
    .send({ username: 'h029-first', password });
  expect(response.status).toBe(200);
  return tokenPairSchema.parse(response.body).accessToken;
}

/** Lệnh ghi nên luôn mang `Idempotency-Key` (api.md §3, BR-GEN-08); ca chống trùng truyền khoá cố định. */
export function requestExport(token: string, body: object, key = randomUUID()) {
  return http()
    .post('/api/v1/reports/export')
    .set('Authorization', `Bearer ${token}`)
    .set('Idempotency-Key', key)
    .send(body);
}

export function operationStatus(token: string, operationId: string) {
  return http().get(`/api/v1/operations/${operationId}`).set('Authorization', `Bearer ${token}`);
}

export function downloadArtifact(token: string, url: string) {
  return http().get(url).set('Authorization', `Bearer ${token}`);
}

beforeAll(async () => {
  if (!process.env.REDIS_URL) throw new Error('HB-163 requires Redis7; no skip fallback');
  exportDir = await mkdtemp(join(tmpdir(), 'hb163-api-'));
  const url = new URL(process.env.REDIS_URL);
  url.pathname = '/7';
  redis = new Redis(url.href);
  await redis.ping();
  const module = AppModule.register({
    DATABASE_URL: databaseUrl,
    REDIS_URL: url.href,
    JWT_ACCESS_SECRET: randomBytes(32).toString('hex'),
    JWT_REFRESH_SECRET: randomBytes(32).toString('hex'),
    BUSINESS_TIMEZONE: 'Asia/Ho_Chi_Minh',
    IDEMPOTENCY_TTL_HOURS: 24,
    EXPORT_DIR: exportDir,
    LOG_LEVEL: 'silent',
    HOST: '127.0.0.1',
    PORT: 0,
  });
  app = await NestFactory.create<NestFastifyApplication>(
    {
      ...module,
      providers: [
        ...(module.providers ?? []).filter(
          (p) => typeof p !== 'object' || p === null || !('provide' in p) || p.provide !== CLOCK,
        ),
        { provide: CLOCK, useValue: clock },
      ],
    },
    new FastifyAdapter(),
    { logger: false, abortOnError: false },
  );
  app.setGlobalPrefix('api/v1');
  await app.listen(0, '127.0.0.1');
  queue = new Queue(REPORT_EXPORT_QUEUE, {
    connection: { host: url.hostname, port: Number(url.port) || 6379, db: 7 },
  });
}, 60000);

beforeEach(async () => {
  await redis.flushdb();
  await rows('DELETE FROM operations');
});

afterAll(async () => {
  await queue?.close();
  await app?.close();
  await redis?.quit();
}, 30000);
