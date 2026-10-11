import 'reflect-metadata';
import { z } from 'zod';
import { randomBytes, randomUUID } from 'node:crypto';
import { beforeAll, beforeEach, afterAll, expect } from 'vitest';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { Redis } from 'ioredis';
import request from 'supertest';
import { tokenPairSchema } from '@pinehill/contracts';
import pg from 'pg';
import { seedReferenceData } from '../../prisma/seed/index.js';
import { AppModule } from '../../src/app.module.js';
import { CLOCK } from '../../src/infrastructure/ports.js';
import {
  databaseUrl,
  password,
  rows,
  clock,
  userId,
  propertyId as emptyPropId,
  db,
} from '../idempotency/database.js';
export { rows, clock, userId, db, databaseUrl, emptyPropId };
let app: NestFastifyApplication, redis: Redis;
export const http = () => request(app.getHttpServer());
export const application = () => app;
export let propId = '',
  otherId = '',
  typeId = '',
  dormId = '',
  roomId = '',
  secondRoomId = '',
  otherRoomId = '';
beforeAll(async () => {
  const ownerUrl = new URL(process.env.DATABASE_MIGRATION_URL!);
  ownerUrl.pathname = new URL(databaseUrl).pathname;
  const owner = new pg.Client({ connectionString: ownerUrl.href });
  await owner.connect();
  try {
    await seedReferenceData(owner);
  } finally {
    await owner.end();
  }
  propId = String((await rows("SELECT id FROM properties WHERE code='CS-01'"))[0]!.id);
  otherId = String((await rows("SELECT id FROM properties WHERE code='CS-02'"))[0]!.id);
  typeId = String(
    (await rows("SELECT id FROM room_types WHERE property_id=$1 AND code='STD'", [propId]))[0]!.id,
  );
  dormId = String(
    (await rows("SELECT id FROM room_types WHERE property_id=$1 AND code='DOR'", [propId]))[0]!.id,
  );
  const rooms = await rows('SELECT id FROM rooms WHERE room_type_id=$1 ORDER BY code LIMIT 2', [
    typeId,
  ]);
  roomId = String(rooms[0]!.id);
  secondRoomId = String(rooms[1]!.id);
  otherRoomId = String(
    (await rows('SELECT id FROM rooms WHERE property_id=$1 LIMIT 1', [otherId]))[0]!.id,
  );
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
  await rows("UPDATE rooms SET connecting_room_id=NULL,status='ACTIVE',note=NULL");
  await rows("DELETE FROM rooms WHERE code LIKE 'CS%-9%'");
  await rows(
    "DELETE FROM room_types WHERE property_id IN(SELECT id FROM properties WHERE code LIKE 'H029-%')",
  );
  await rows("UPDATE properties SET status='ACTIVE',overbook_limit_pct=0 WHERE code LIKE 'CS-%'");
  await rows("UPDATE properties SET status='INACTIVE' WHERE code LIKE 'H029-%'");
  await rows('DELETE FROM user_property_scopes WHERE user_id=$1', [userId]);
  await rows('INSERT INTO user_property_scopes(user_id,property_id) VALUES($1,$2)', [
    userId,
    propId,
  ]);
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

export function write(
  method: 'post' | 'patch' | 'put',
  path: string,
  token: string,
  body: object,
  version: string | null = null,
  key = randomUUID(),
) {
  const r = http()
    [method]('/api/v1/' + path)
    .set('Authorization', `Bearer ${token}`)
    .set('Idempotency-Key', key);
  if (version !== null) r.set('If-Match', version);
  return r.send(body);
}
export async function tag(kind: 'properties' | 'room-types' | 'rooms', id: string, token: string) {
  const r = await http()
    .get('/api/v1/' + kind)
    .set('Authorization', `Bearer ${token}`);
  expect(r.status).toBe(200);
  const row = rawPage(r.body).data.find((x) => x.id === id);
  expect(row).toBeDefined();
  return '"' + z.number().parse(row!.version) + '"';
}

export const rawPage = (value: unknown) =>
  z
    .object({
      data: z.array(z.record(z.string(), z.unknown())),
      meta: z.object({
        total: z.number(),
        limit: z.number(),
        hasMore: z.boolean(),
        nextCursor: z.string().nullable(),
      }),
    })
    .parse(value);
