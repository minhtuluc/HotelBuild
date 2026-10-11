import 'reflect-metadata';
import { randomBytes, randomUUID } from 'node:crypto';
import { beforeAll, beforeEach, afterAll, expect } from 'vitest';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { Redis } from 'ioredis';
import request from 'supertest';
import { tokenPairSchema } from '@pinehill/contracts';
import { AppModule } from '../../src/app.module.js';
import { CLOCK } from '../../src/infrastructure/ports.js';
import {
  databaseUrl,
  password,
  rows,
  clock,
  userId,
  propertyId,
  otherPropertyId,
  db,
} from '../idempotency/database.js';
export { rows, clock, userId, propertyId, otherPropertyId, db, databaseUrl };
let app: NestFastifyApplication, redis: Redis;
export const http = () => request(app.getHttpServer());
export const application = () => app;
export let action = '';
beforeAll(async () => {
  if (!process.env.REDIS_URL) throw new Error('HB036 requires Redis7; no skip fallback');
  const url = new URL(process.env.REDIS_URL);
  url.pathname = '/13';
  redis = new Redis(url.href);
  await redis.ping();
  const module = AppModule.register({
    DATABASE_URL: databaseUrl,
    REDIS_URL: url.href,
    JWT_ACCESS_SECRET: randomBytes(32).toString('hex'),
    JWT_REFRESH_SECRET: randomBytes(32).toString('hex'),
    BUSINESS_TIMEZONE: 'Asia/Ho_Chi_Minh',
    IDEMPOTENCY_TTL_HOURS: 24,
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
}, 60000);
beforeEach(async () => {
  await redis.flushdb();
  action = `HB036_${randomUUID()}`;
  await rows("DELETE FROM system_settings WHERE key <> 'H029'");
  await rows(`INSERT INTO system_settings(key,value,value_type,description) VALUES
    ('refund.feeAmount','0','NUMBER','Synthetic fee'),('test.enabled','false','BOOLEAN','Synthetic flag'),
    ('test.json','{}','JSON','Synthetic JSON'),('test.label','Synthetic','STRING',NULL)`);
});
afterAll(async () => {
  await app?.close();
  await redis?.quit();
}, 30000);
export async function login(role = 'OWNER') {
  await rows('UPDATE users SET role=$1 WHERE id=$2', [role, userId]);
  const response = await http()
    .post('/api/v1/auth/login')
    .send({ username: 'h029-first', password });
  expect(response.status).toBe(200);
  return tokenPairSchema.parse(response.body).accessToken;
}
export const settings = (token: string, query: Record<string, string | number> = {}) =>
  http().get('/api/v1/system-settings').set('Authorization', `Bearer ${token}`).query(query);
export const logs = (token: string, query: Record<string, string | number> = {}) =>
  http()
    .get('/api/v1/audit-logs')
    .set('Authorization', `Bearer ${token}`)
    .query({ action, ...query });
export const put = (
  token: string,
  value = '1000',
  key = 'refund.feeAmount',
  version: string | null = '"1"',
  requestKey = randomUUID(),
) => {
  const request = http()
    .put(`/api/v1/system-settings/${key}`)
    .set('Authorization', `Bearer ${token}`)
    .set('Idempotency-Key', requestKey);
  if (version !== null) request.set('If-Match', version);
  return request.send({ value, reason: 'Synthetic setting change' });
};
export async function audit(
  before: unknown,
  after: unknown,
  entityType = 'RoomBlock',
  entityId: string = randomUUID(),
  at = '2026-10-11T01:00:00Z',
) {
  return String(
    (
      await rows(
        `INSERT INTO audit_logs(chain_seq,row_hash,actor_id,actor_role,action,entity_type,entity_id,before_json,after_json,reason,at)
    VALUES(0,'pending',$1,'MANAGER',$2,$3,$4,$5::jsonb,$6::jsonb,'Synthetic audit',$7) RETURNING id`,
        [userId, action, entityType, entityId, JSON.stringify(before), JSON.stringify(after), at],
      )
    )[0]!.id,
  );
}
