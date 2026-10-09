import 'reflect-metadata';
import { Controller, Get } from '@nestjs/common';
import type { Provider, Type } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { afterEach, expect, test } from 'vitest';
import { AppModule } from '../../src/app.module.js';
import { Permission, permissionProvider } from '../../src/common/rbac/permissions.js';
import { Public } from '../../src/common/guards/decorators.js';
import type { ApiConfig } from '../../src/config/env.js';

const config: ApiConfig = {
  DATABASE_URL: 'postgresql://unused:unused@127.0.0.1:5432/unused',
  REDIS_URL: process.env.REDIS_URL ?? 'redis://127.0.0.1:6379',
  JWT_ACCESS_SECRET: 'synthetic-bootstrap',
  JWT_REFRESH_SECRET: 'synthetic-bootstrap',
  BUSINESS_TIMEZONE: 'Asia/Ho_Chi_Minh',
  IDEMPOTENCY_TTL_HOURS: 24,
  LOG_LEVEL: 'silent',
  HOST: '127.0.0.1',
  PORT: 0,
};
const opened: NestFastifyApplication[] = [];
async function start(controller: Type, extra: Provider[] = []) {
  const registered = AppModule.register(config, []);
  const app = await NestFactory.create<NestFastifyApplication>(
    {
      ...registered,
      controllers: [controller],
      providers: [...(registered.providers ?? []), ...extra],
    },
    new FastifyAdapter(),
    { logger: false, abortOnError: false },
  );
  opened.push(app);
  await app.init();
}
afterEach(async () => {
  for (const app of opened.splice(0)) await app.close();
});

@Controller('missing-permission')
class MissingPermission {
  @Get() read() {
    return { ok: true };
  }
}
@Controller('misspelled-permission')
class UnknownPermission {
  @Get() read() {
    return { ok: true };
  }
}
Reflect.defineMetadata(
  'pinehill.permission',
  'not.a.published.permission',
  UnknownPermission.prototype.read,
);
@Controller('conflicting-permission')
class ConflictingPermission {
  @Public() @Get() read() {
    return { ok: true };
  }
}
Reflect.defineMetadata('pinehill.permission', 'auth.me', ConflictingPermission.prototype.read);

// Removing the production bootstrap validator must make these tests fail.
test('startup rejects an HTTP handler without Public or Permission', async () => {
  await expect(start(MissingPermission)).rejects.toThrow(/permission/i);
});
test('startup rejects an unknown permission spelling', async () => {
  await expect(start(UnknownPermission)).rejects.toThrow(/permission/i);
});
test('startup rejects contradictory Public plus Permission metadata', async () => {
  await expect(start(ConflictingPermission)).rejects.toThrow(/permission/i);
});

@Controller('mapped')
class MappedPermission {
  @Permission('auth.me') @Get() read() {
    return { ok: true };
  }
}
@Public()
@Controller('public')
class PublicController {
  @Get() read() {
    return { ok: true };
  }
}
test('startup accepts a declared permission and inherited Public class metadata', async () => {
  await expect(start(MappedPermission)).resolves.toBeUndefined();
  await expect(start(PublicController)).resolves.toBeUndefined();
});
test('duplicate permission ownership fails startup even with identical role sets', async () => {
  await expect(
    start(MappedPermission, [permissionProvider('duplicate', { 'auth.me': ['OWNER'] })]),
  ).rejects.toThrow(/Duplicate permission/);
});
test('invalid role in a module permission declaration fails startup', async () => {
  await expect(
    start(MappedPermission, [permissionProvider('invalid', { 'invalid.role': ['SUPERADMIN'] })]),
  ).rejects.toThrow(/permission role/);
});
test('empty role sets and invalid operation names fail startup', async () => {
  await expect(
    start(MappedPermission, [permissionProvider('empty', { 'empty.roles': [] })]),
  ).rejects.toThrow(/permission/);
  await expect(
    start(MappedPermission, [permissionProvider('invalid', { constructor: ['OWNER'] })]),
  ).rejects.toThrow(/permission/);
});
