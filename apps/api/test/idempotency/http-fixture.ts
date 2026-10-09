import 'reflect-metadata';
import { Controller, Inject, Post, Patch, Req, HttpCode, Header, Module } from '@nestjs/common';
import type { ExecutionContext } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import type { FastifyRequest } from 'fastify';
import { Redis } from 'ioredis';
import { randomBytes, randomUUID } from 'node:crypto';
import request from 'supertest';
import { beforeAll, beforeEach, afterAll, expect } from 'vitest';
import { z } from 'zod';
import { tokenPairSchema } from '@pinehill/contracts';
import { AppModule } from '../../src/app.module.js';
import { CLOCK } from '../../src/infrastructure/ports.js';
import { AuditWriter } from '../../src/infrastructure/audit/audit-writer.js';
import { Permission, permissionProvider } from '../../src/common/rbac/permissions.js';
import { requireProperty } from '../../src/common/rbac/scope.js';
import { isAuthorizedActor } from '../../src/common/actor/authorized-actor.js';
import { AppError } from '../../src/common/app-error.js';
import { Idempotent } from '../../src/common/idempotency/decorators.js';
import { IdempotencyContext } from '../../src/common/idempotency/context.js';
import { REDIS } from '../../src/infrastructure/redis/redis.module.js';
import { clock, password, databaseUrl, userId } from './database.js';
let app: NestFastifyApplication, redis: Redis;
export let versionChecks = 0,
  scopeChecks = 0;
export let failMode: '' | 'handler' | 'audit' | 'secret' = '';
export const setFailure = (value: typeof failMode) => {
  failMode = value;
};
let commandBarrier: (() => Promise<void>) | undefined;
export const setCommandBarrier = (value: typeof commandBarrier) => {
  commandBarrier = value;
};
export const transactions: string[] = [];
let upstreamHeader: { name: string; value: string } | undefined;
export const setUpstreamHeader = (value: typeof upstreamHeader) => {
  upstreamHeader = value;
};
export class PropertyAccess {
  async authorize(context: ExecutionContext) {
    scopeChecks++;
    const req = context.switchToHttp().getRequest<FastifyRequest>();
    const params = z.object({ propertyId: z.uuid() }).parse(req.params);
    if (!isAuthorizedActor(req.actor))
      throw new AppError(401, 'E_AUTH_INVALID_CREDENTIALS', 'Chưa xác thực.');
    requireProperty(req.actor, params.propertyId);
    return { type: 'USER' as const, id: req.actor.id };
  }
}
@Controller('idempotency-probe')
class Commands {
  constructor(@Inject(IdempotencyContext) private readonly context: IdempotencyContext) {}
  @Permission('probe.write')
  @Idempotent(PropertyAccess)
  @Post(':propertyId')
  @HttpCode(201)
  @Header('Location', '/api/v1/idempotency-probe/result')
  async command(@Req() req: FastifyRequest) {
    versionChecks++;
    const tx = this.context.transaction();
    const transactionId = (
      await tx.$queryRaw<{ id: string }[]>`SELECT pg_current_xact_id()::text AS id`
    )[0]!.id;
    transactions.push(transactionId);
    await commandBarrier?.();
    const currentId = (
      await this.context.transaction().$queryRaw<
        { id: string }[]
      >`SELECT pg_current_xact_id()::text AS id`
    )[0]!.id;
    if (currentId !== transactionId)
      throw new Error('Transaction context crossed concurrent requests');
    const found = await tx.system_settings.findUniqueOrThrow({ where: { key: 'H029' } });
    if (req.headers['if-match'] && req.headers['if-match'] !== `"${found.value}"`)
      throw new AppError(412, 'E_GEN_VERSION_CONFLICT', 'Phiên bản đã thay đổi.');
    await tx.$executeRaw`UPDATE system_settings SET value=(value::int+1)::text WHERE key='H029'`;
    await new AuditWriter(clock).record(tx, {
      actor: {
        id: failMode === 'audit' ? randomUUID() : req.actor!.id,
        role: req.actor!.role,
        ip: null,
        correlationId: req.id,
      },
      action: 'H029_COMMAND',
      entityType: 'SystemSetting',
      entityId: userId,
      beforeJson: null,
      afterJson: { increment: 1 },
      reason: null,
    });
    if (failMode === 'handler')
      throw new AppError(412, 'E_GEN_VERSION_CONFLICT', 'Synthetic failure');
    if (failMode === 'secret') return { refreshToken: 'synthetic-token-must-not-persist' };
    return { actorId: req.actor!.id, value: Number(found.value) + 1 };
  }
  @Permission('probe.write')
  @Idempotent(PropertyAccess)
  @Patch(':propertyId')
  @HttpCode(201)
  async patch(@Req() req: FastifyRequest) {
    return this.command(req);
  }
  @Permission('probe.write')
  @Idempotent(PropertyAccess)
  @Post('bad-media/:propertyId')
  @Header('Content-Type', 'text/plain')
  async badMedia(@Req() req: FastifyRequest) {
    return this.command(req);
  }
  @Permission('probe.write')
  @Idempotent(PropertyAccess)
  @Post('bad-header/:propertyId')
  @Header('Location', '/result\ninvalid')
  async badHeader(@Req() req: FastifyRequest) {
    return this.command(req);
  }
  @Permission('probe.write')
  @Idempotent(PropertyAccess)
  @Post('bad-encoding/:propertyId')
  @Header('Content-Encoding', 'gzip')
  async badEncoding(@Req() req: FastifyRequest) {
    return this.command(req);
  }
  @Permission('probe.write')
  @Idempotent(PropertyAccess)
  @Post('scalar/:propertyId')
  @Header('Content-Type', 'application/json')
  async scalar(@Req() req: FastifyRequest) {
    await this.command(req);
    return 'ok';
  }
}
@Module({
  controllers: [Commands],
  providers: [
    PropertyAccess,
    permissionProvider('idempotency-probe', { 'probe.write': ['FRONT_DESK', 'OWNER'] }),
  ],
})
class ProbeModule {}
export const http = () => request(app.getHttpServer());
export const context = () => app.get(IdempotencyContext);
export const appRedis = () => app.get<Redis>(REDIS);
export async function login(username = 'h029-first') {
  const result = await http().post('/api/v1/auth/login').send({ username, password });
  expect(result.status).toBe(200);
  return tokenPairSchema.parse(result.body).accessToken;
}
beforeAll(async () => {
  if (!process.env.REDIS_URL) throw new Error('HB029 HTTP tests require real Redis7');
  const url = new URL(process.env.REDIS_URL);
  url.pathname = '/11';
  redis = new Redis(url.href);
  await redis.ping();
  const registered = AppModule.register({
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
  const adapter = new FastifyAdapter();
  adapter.getInstance().addHook('onRequest', async (_request, reply) => {
    if (upstreamHeader) reply.header(upstreamHeader.name, upstreamHeader.value);
  });
  app = await NestFactory.create<NestFastifyApplication>(
    {
      ...registered,
      imports: [...(registered.imports ?? []), ProbeModule],
      providers: [
        ...(registered.providers ?? []).filter(
          (p) => typeof p !== 'object' || p === null || !('provide' in p) || p.provide !== CLOCK,
        ),
        { provide: CLOCK, useValue: clock },
      ],
    },
    adapter,
    { logger: false, abortOnError: false },
  );
  app.setGlobalPrefix('api/v1');
  await app.listen(0, '127.0.0.1');
}, 60000);
beforeEach(async () => {
  versionChecks = 0;
  scopeChecks = 0;
  failMode = '';
  commandBarrier = undefined;
  upstreamHeader = undefined;
  transactions.length = 0;
  await redis.flushdb();
});
afterAll(async () => {
  await app?.close();
  await redis?.quit();
}, 30000);
