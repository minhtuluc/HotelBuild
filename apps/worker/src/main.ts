import { fileURLToPath } from 'node:url';
import { ConfigError, loadWorkerConfig, type WorkerConfig } from './config/env.js';
import { createBullmqDeps } from './bullmq.factory.js';
import { createLogger } from './pino.logger.js';
import { createWorkerApp, installSignalHandlers, type WorkerApp } from './worker-app.js';

export async function run(
  env: NodeJS.ProcessEnv | undefined,
  createApp: (config: WorkerConfig) => WorkerApp = (config) =>
    createWorkerApp(config, createBullmqDeps(config, createLogger(config.LOG_LEVEL))),
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
  logger.info({ queue: 'all' }, 'worker đã đăng ký 5 hàng đợi');
  installSignalHandlers(app, (code) => process.exit(code), logger);
  return 0;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  void run(process.env).then((code) => {
    process.exitCode = code;
  });
}
