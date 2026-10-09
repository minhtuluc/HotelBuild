import 'reflect-metadata';
import { Controller, Inject, Post, Get, Req, Param } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { PrismaClient } from '@prisma/client';
import type { FastifyRequest } from 'fastify';
import { hash } from '@node-rs/argon2';
import { randomBytes, randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { Redis } from 'ioredis';
import request from 'supertest';
import { beforeAll, beforeEach, afterAll, expect } from 'vitest';
import { tokenPairSchema } from '@pinehill/contracts';
import { isAuthorizedActor } from '../../src/common/actor/authorized-actor.js';
import { propertyWhere, requireScopedResult } from '../../src/common/rbac/scope.js';
import { PermissionRegistry } from '../../src/common/rbac/permission-registry.js';
import { AppError } from '../../src/common/app-error.js';
import { AppModule } from '../../src/app.module.js';
import { CLOCK } from '../../src/infrastructure/ports.js';
import { PRISMA } from '../../src/infrastructure/prisma/prisma.module.js';
import { Permission, permissionProvider } from '../../src/common/rbac/permissions.js';
import type { ApiConfig } from '../../src/config/env.js';

// Independent, explicit source oracle: api§6.3 and BR-RBAC03, not a numeric role hierarchy.
export const roles = [
  'OWNER',
  'MANAGER',
  'FRONT_DESK',
  'RESERVATION_AGENT',
  'ACCOUNTANT',
  'HOUSEKEEPING',
  'SYSADMIN',
];
export const matrix: Readonly<Record<string, readonly string[]>> = {
  'booking.create': ['FRONT_DESK', 'RESERVATION_AGENT'],
  'payment.collect': ['FRONT_DESK', 'RESERVATION_AGENT', 'ACCOUNTANT'],
  'refund.approve': ['MANAGER', 'OWNER'],
  'refund.pay': ['ACCOUNTANT'],
  'rate.configure': ['OWNER'],
  'housekeeping.update': ['HOUSEKEEPING', 'FRONT_DESK', 'MANAGER'],
  'user.access': ['OWNER', 'SYSADMIN'],
  'system.backup': ['SYSADMIN'],
};
const fixturePermissions = permissionProvider('fixture', {
  ...matrix,
  'booking.read': ['FRONT_DESK', 'RESERVATION_AGENT', 'MANAGER', 'OWNER'],
});
export const mutations: string[] = [];
@Controller('rbac')
class MatrixController {
  constructor(@Inject(PRISMA) private readonly prisma: PrismaClient) {}
  private async scopedResource(request: FastifyRequest, id: string) {
    const actor = request.actor;
    if (!isAuthorizedActor(actor))
      throw new AppError(401, 'E_AUTH_INVALID_CREDENTIALS', 'Chưa xác thực.');
    const found = requireScopedResult(
      await this.prisma.rooms.findFirst({ where: propertyWhere(actor, { id }) }),
      actor,
    );
    return { id: found.id, propertyId: found.property_id };
  }
  @Permission('booking.read') @Get('bookings/:id') readBooking(
    @Req() req: FastifyRequest,
    @Param('id') id: string,
  ) {
    return this.scopedResource(req, id);
  }
  @Permission('booking.read') @Get('payments/:id') readPayment(
    @Req() req: FastifyRequest,
    @Param('id') id: string,
  ) {
    return this.scopedResource(req, id);
  }
  @Permission('booking.read') @Get('refunds/:id') readRefund(
    @Req() req: FastifyRequest,
    @Param('id') id: string,
  ) {
    return this.scopedResource(req, id);
  }
  @Permission('booking.read') @Get('holds/:id') readHold(
    @Req() req: FastifyRequest,
    @Param('id') id: string,
  ) {
    return this.scopedResource(req, id);
  }
  @Permission('booking.read') @Get('exports/:id') readExport(
    @Req() req: FastifyRequest,
    @Param('id') id: string,
  ) {
    return this.scopedResource(req, id);
  }
  @Permission('booking.create') @Post('booking.create') booking() {
    mutations.push('booking');
    return { ok: true };
  }
  @Permission('payment.collect') @Post('payment.collect') collect() {
    mutations.push('collect');
    return { ok: true };
  }
  @Permission('refund.approve') @Post('refund.approve') approve() {
    mutations.push('approve');
    return { ok: true };
  }
  @Permission('refund.pay') @Post('refund.pay') pay() {
    mutations.push('pay');
    return { ok: true };
  }
  @Permission('rate.configure') @Post('rate.configure') rate() {
    mutations.push('rate');
    return { ok: true };
  }
  @Permission('housekeeping.update') @Post('housekeeping.update') housekeeping() {
    mutations.push('housekeeping');
    return { ok: true };
  }
  @Permission('user.access') @Post('user.access') access() {
    mutations.push('access');
    return { ok: true };
  }
  @Permission('system.backup') @Post('system.backup') backup() {
    mutations.push('backup');
    return { ok: true };
  }
}
const root = fileURLToPath(new URL('../../../../', import.meta.url));
export const clock = {
  value: Date.UTC(2026, 9, 9),
  now() {
    return new Date(this.value);
  },
};
const password = 'Synthetic-RBAC-password-014!';
const database = `hb014_${randomUUID().replaceAll('-', '')}`;
const role = `hb014_role_${randomUUID().replaceAll('-', '')}`;
let admin: pg.Client, db: pg.Client, redis: Redis, app: NestFastifyApplication;
export let roomId = '',
  otherRoomId = '';
export let propertyId = '',
  otherPropertyId = '',
  userId = '',
  guestId = '',
  otherGuestId = '';
let config: ApiConfig;
export async function rows(sql: string, values: unknown[] = []) {
  return (await db.query<Record<string, unknown>>(sql, values)).rows;
}
export async function initExtra(
  controllers: (typeof MatrixController)[] = [],
  providers: ReturnType<typeof permissionProvider>[] = [],
) {
  const registered = AppModule.register(config);
  const kept = (registered.providers ?? []).filter(
    (p) => typeof p !== 'object' || p === null || !('provide' in p) || p.provide !== CLOCK,
  );
  const next = await NestFactory.create<NestFastifyApplication>(
    {
      ...registered,
      controllers: [MatrixController, ...controllers],
      providers: [...kept, { provide: CLOCK, useValue: clock }, fixturePermissions, ...providers],
    },
    new FastifyAdapter(),
    { logger: false, abortOnError: false },
  );
  next.setGlobalPrefix('api/v1');
  try {
    await next.init();
    await next.listen(0, '127.0.0.1');
    return next;
  } catch (error) {
    await next.close();
    throw error;
  }
}
export const application = () => app;
export const businessDb = () => app.get<PrismaClient>(PRISMA);
export const registry = () => app.get(PermissionRegistry);
export const http = () => request(app.getHttpServer());
export async function login(roleName = 'FRONT_DESK') {
  await rows('UPDATE users SET role=$1 WHERE id=$2::uuid', [roleName, userId]);
  const result = await http()
    .post('/api/v1/auth/login')
    .send({ username: 'synthetic-rbac', password });
  expect(result.status).toBe(200);
  return tokenPairSchema.parse(result.body).accessToken;
}
beforeAll(async () => {
  const owner = process.env.DATABASE_MIGRATION_URL;
  if (!owner || !process.env.REDIS_URL)
    throw new Error('HB014 requires real PG16/Redis7; no skip fallback');
  admin = new pg.Client({ connectionString: owner });
  await admin.connect();
  await admin.query(`CREATE DATABASE "${database}"`);
  const ownerUrl = new URL(owner);
  ownerUrl.pathname = `/${database}`;
  const migration = spawnSync(process.execPath, [`${root}scripts/migrate.mjs`], {
    cwd: root,
    env: { ...process.env, DATABASE_MIGRATION_URL: ownerUrl.href, DATABASE_URL: '' },
    encoding: 'utf8',
  });
  expect(migration.status).toBe(0);
  db = new pg.Client({ connectionString: ownerUrl.href });
  await db.connect();
  const runtimePassword = randomBytes(24).toString('hex');
  const quoted = (
    await admin.query<{ literal: string }>('SELECT quote_literal($1) AS literal', [runtimePassword])
  ).rows[0]!.literal;
  await admin.query(`CREATE ROLE "${role}" LOGIN INHERIT PASSWORD ${quoted}`);
  await admin.query(`GRANT app_rw TO "${role}"`);
  const runtime = new URL(ownerUrl);
  runtime.username = role;
  runtime.password = runtimePassword;
  const redisUrl = new URL(process.env.REDIS_URL);
  redisUrl.pathname = '/12';
  redis = new Redis(redisUrl.href);
  config = {
    DATABASE_URL: runtime.href,
    REDIS_URL: redisUrl.href,
    JWT_ACCESS_SECRET: randomBytes(32).toString('hex'),
    JWT_REFRESH_SECRET: randomBytes(32).toString('hex'),
    BUSINESS_TIMEZONE: 'Asia/Ho_Chi_Minh',
    IDEMPOTENCY_TTL_HOURS: 24,
    LOG_LEVEL: 'silent',
    PORT: 0,
    HOST: '127.0.0.1',
  };
  for (const code of ['H014-A', 'H014-B']) {
    const id = String(
      (
        await rows(
          'INSERT INTO properties(code,name,address,phone,latitude,longitude) VALUES($1,$1,$1,$1,0,0) RETURNING id',
          [code],
        )
      )[0]!.id,
    );
    if (code.endsWith('A')) propertyId = id;
    else otherPropertyId = id;
  }
  for (const prop of [propertyId, otherPropertyId]) {
    const type = String(
      (
        await rows(
          "INSERT INTO room_types(property_id,code,name,capacity_adults,base_price,min_price,max_price) VALUES($1,'STD','Synthetic',2,100000,100000,200000) RETURNING id",
          [prop],
        )
      )[0]!.id,
    );
    const room = String(
      (
        await rows(
          "INSERT INTO rooms(property_id,room_type_id,code,name) VALUES($1,$2,'R1','Synthetic') RETURNING id",
          [prop, type],
        )
      )[0]!.id,
    );
    if (prop === propertyId) roomId = room;
    else otherRoomId = room;
  }
  userId = String(
    (
      await rows(
        "INSERT INTO users(username,password_hash,full_name,role) VALUES('synthetic-rbac',$1,'Synthetic','FRONT_DESK') RETURNING id",
        [await hash(password, { memoryCost: 19456, timeCost: 2, parallelism: 1 })],
      )
    )[0]!.id,
  );
  await rows('INSERT INTO user_property_scopes(user_id,property_id) VALUES($1::uuid,$2::uuid)', [
    userId,
    propertyId,
  ]);
  guestId = String(
    (
      await rows(
        "INSERT INTO guests(full_name,phone) VALUES('Synthetic A','+84900000014') RETURNING id",
      )
    )[0]!.id,
  );
  otherGuestId = String(
    (
      await rows(
        "INSERT INTO guests(full_name,phone) VALUES('Synthetic B','+84900000015') RETURNING id",
      )
    )[0]!.id,
  );
  app = await initExtra();
}, 60000);
beforeEach(async () => {
  clock.value += 61000;
  mutations.length = 0;
  await redis.flushdb();
  await rows('DELETE FROM user_property_scopes WHERE user_id=$1::uuid', [userId]);
  await rows('INSERT INTO user_property_scopes(user_id,property_id) VALUES($1::uuid,$2::uuid)', [
    userId,
    propertyId,
  ]);
  await rows("UPDATE users SET role='FRONT_DESK',is_active=true WHERE id=$1::uuid", [userId]);
});
afterAll(async () => {
  await app?.close();
  await redis?.quit();
  await db?.end();
  if (admin) {
    await admin.query(`DROP DATABASE IF EXISTS "${database}" WITH (FORCE)`);
    await admin.query(`DROP ROLE IF EXISTS "${role}"`);
    await admin.end();
  }
}, 30000);
