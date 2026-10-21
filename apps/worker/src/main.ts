import { fileURLToPath } from 'node:url';
import { ConfigError, loadWorkerConfig, type WorkerConfig } from './config/env.js';
import { createBullmqDeps } from './bullmq.factory.js';
import { createJobRuntime } from './jobs/context.js';
import { JOB_HANDLERS } from './jobs/registry.js';
import { createLogger } from './pino.logger.js';
import { QUEUE_NAMES } from './queues.js';
import { tracingFromConfig } from './tracing/tracing.js';
import { createWorkerApp, installSignalHandlers, type WorkerApp } from './worker-app.js';

/**
 * Tiến trình worker thật: mở kết nối CSDL cho handler, nối handler vào hàng đợi, và đóng Prisma khi tắt.
 * `run` nhận factory để test thay được app mà không cần Redis/CSDL thật — `export` để test dựng được
 * đúng dây nối thật (không đổi hành vi).
 */
export function defaultWorkerApp(config: WorkerConfig): WorkerApp {
  const logger = createLogger(config.LOG_LEVEL);
  // Endpoint trống ⇒ tracing ở chế độ "chỉ lan truyền": vẫn có traceId trong log, không xuất span.
  const tracing = tracingFromConfig(config);
  const runtime = createJobRuntime(config, logger);
  const app = createWorkerApp(
    config,
    createBullmqDeps(config, logger, undefined, {
      handlers: JOB_HANDLERS,
      context: { ...runtime.context, tracing },
      tracing,
    }),
  );
  return {
    start: () => app.start(),
    stop: async () => {
      await app.stop();
      await runtime.close();
      await tracing.shutdown();
    },
  };
}

export async function run(
  env: NodeJS.ProcessEnv | undefined,
  createApp: (config: WorkerConfig) => WorkerApp = defaultWorkerApp,
): Promise<number> {
  let config: WorkerConfig;
  try {
    config = loadWorkerConfig(env);
  } catch (error) {
    process.stderr.write(`${error instanceof ConfigError ? error.message : String(error)}\n`);
    return 1;
  }
  const logger = createLogger(config.LOG_LEVEL);
  const app = createApp(config);
  await app.start();
  logger.info({ queue: 'all' }, `worker đã đăng ký ${QUEUE_NAMES.length} hàng đợi`);
  installSignalHandlers(app, (code) => process.exit(code), logger);
  return 0;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  void run(process.env).then((code) => {
    process.exitCode = code;
  });
}
