import 'reflect-metadata';
import { Controller, Get, Post, Res, Module, SetMetadata } from '@nestjs/common';
import type { Type } from '@nestjs/common';
import { DiscoveryModule, NestFactory } from '@nestjs/core';
import { test, expect } from 'vitest';
import { IDEMPOTENT, Idempotent } from '../../src/common/idempotency/decorators.js';
import { IdempotencyValidator } from '../../src/common/idempotency/validator.js';
class Access {
  async authorize() {
    return { type: 'SYSTEM' as const, id: 'validator-test' };
  }
}
@Controller('valid')
class Valid {
  @Post() @Idempotent(Access) command() {
    return {};
  }
}
@Controller('missing')
class Missing {
  @Post() @SetMetadata(IDEMPOTENT, null) command() {
    return {};
  }
}
@Controller('raw')
class Raw {
  @Post() @Idempotent(Access) command(@Res() _reply: unknown) {
    return {};
  }
}
@Controller('read')
class Read {
  @Get() @Idempotent(Access) command() {
    return {};
  }
}
async function boot(controller: Type, registered = true) {
  @Module({
    imports: [DiscoveryModule],
    controllers: [controller],
    providers: [IdempotencyValidator, ...(registered ? [Access] : [])],
  })
  class Fixture {}
  const app = await NestFactory.createApplicationContext(Fixture, {
    logger: false,
    abortOnError: false,
  });
  await app.close();
}
test('valid idempotent JSON command has a registered explicit authorizer', async () => {
  await expect(boot(Valid)).resolves.toBeUndefined();
});
test('missing explicit authorizer fails startup', async () => {
  await expect(boot(Missing)).rejects.toThrow('Idempotency');
});
test('unregistered authorizer fails startup', async () => {
  await expect(boot(Valid, false)).rejects.toThrow('Idempotency');
});
test('manual response command fails startup', async () => {
  await expect(boot(Raw)).rejects.toThrow('Idempotency');
});
test('idempotency on a read method fails startup', async () => {
  await expect(boot(Read)).rejects.toThrow('Idempotency');
});
