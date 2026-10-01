import 'reflect-metadata';
import { fileURLToPath } from 'node:url';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { Logger } from 'nestjs-pino';
import { AppModule } from './app.module.js';
import { ConfigError, loadConfig } from './config/env.js';
import type { ApiConfig } from './config/env.js';
import type { HealthProbe } from './infrastructure/health/health-probe.js';

export async function createApp(
  config: ApiConfig,
  probes?: readonly HealthProbe[],
): Promise<NestFastifyApplication> {
  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule.register(config, probes),
    new FastifyAdapter(),
    { bufferLogs: true },
  );
  app.useLogger(app.get(Logger));
  app.flushLogs();
  app.setGlobalPrefix('api/v1');
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
  return app;
}

export async function run(env: NodeJS.ProcessEnv = process.env): Promise<number> {
  let config: ApiConfig;
  try {
    config = loadConfig(env);
  } catch (error) {
    console.error(error instanceof ConfigError ? error.message : String(error));
    return 1;
  }
  const app = await createApp(config);
  await app.listen({ port: config.PORT, host: '127.0.0.1' });
  return 0;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  void run().then((code) => {
    process.exitCode = code;
  });
}
