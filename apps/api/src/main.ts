import 'reflect-metadata';
import { fileURLToPath } from 'node:url';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { Logger } from 'nestjs-pino';
import { AppModule } from './app.module.js';
import { ConfigError, loadConfig } from './config/env.js';
import type { ApiConfig } from './config/env.js';
import type { HealthProbe } from './infrastructure/health/health-probe.js';

const ALLOW_METHODS = 'GET, POST, PUT, PATCH, DELETE, OPTIONS';
const ALLOW_HEADERS =
  'Authorization, Content-Type, Idempotency-Key, If-Match, X-Correlation-Id, X-Pin-Token, traceparent, tracestate';
const EXPOSE_HEADERS = 'ETag, Retry-After, X-Trace-Id, X-Correlation-Id';

function toOrigin(raw: string): string | null {
  try {
    const parsed = new URL(raw.trim());
    return parsed.protocol === 'http:' || parsed.protocol === 'https:' ? parsed.origin : null;
  } catch {
    return null;
  }
}

function isAllowedOrigin(origin: string, config: ApiConfig): boolean {
  const configured = [
    config.CORS_ALLOWED_ORIGINS,
    config.GUEST_WEB_BASE_URL,
    config.PAYMENT_RETURN_URL_ORIGINS,
  ]
    .flatMap((entry) => (entry ? entry.split(',') : []))
    .map(toOrigin)
    .filter((item): item is string => item !== null);
  if (configured.includes(origin)) return true;
  if (config.NODE_ENV === 'production') return false;
  return /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);
}

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
  const fastify = app.getHttpAdapter().getInstance();
  fastify.addHook('onRequest', async (req, reply) => {
    const origin = req.headers.origin;
    if (typeof origin !== 'string' || !isAllowedOrigin(origin, config)) return;
    reply
      .header('access-control-allow-origin', origin)
      .header('vary', 'Origin')
      .header('access-control-expose-headers', EXPOSE_HEADERS);
    if (req.method === 'OPTIONS') {
      await reply
        .header('access-control-allow-methods', ALLOW_METHODS)
        .header('access-control-allow-headers', ALLOW_HEADERS)
        .header('access-control-max-age', '600')
        .code(204)
        .send();
    }
  });
  // SIGTERM/SIGINT → đóng server + kết nối rồi thoát 0 (AC7; useProcessExit để log pino kịp flush).
  app.enableShutdownHooks([], { useProcessExit: true });
  await app.init();
  await fastify.ready();
  return app;
}

export async function run(env?: NodeJS.ProcessEnv): Promise<number> {
  let config: ApiConfig;
  try {
    config = loadConfig(env);
  } catch (error) {
    console.error(error instanceof ConfigError ? error.message : String(error));
    return 1;
  }
  const app = await createApp(config);
  await app.listen({ port: config.PORT, host: config.HOST });
  return 0;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  void run().then((code) => {
    process.exitCode = code;
  });
}
