import { z } from 'zod';

const logLevels = ['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'] as const;

const urlWithProtocol = (...protocols: string[]) =>
  z.string().refine((value) => {
    try {
      const url = new URL(value);
      return protocols.includes(url.protocol) && url.hostname !== '';
    } catch {
      return false;
    }
  });

const workerEnvSchema = z.object({
  DATABASE_URL: urlWithProtocol('postgres:', 'postgresql:'),
  REDIS_URL: urlWithProtocol('redis:', 'rediss:'),
  LOG_LEVEL: z.enum(logLevels).default('info'),
  WORKER_CONCURRENCY: z.coerce.number().int().min(1).max(64).default(5),
  SHUTDOWN_TIMEOUT_SECONDS: z.coerce.number().positive().default(15),
  ENABLE_REPEATABLE_SCHEDULERS: z
    .enum(['true', 'false'])
    .default('false')
    .transform((value) => value === 'true'),
  HOLD_EXPIRY_INTERVAL_SECONDS: z.coerce.number().positive().default(30),
  OUTBOX_RELAY_INTERVAL_SECONDS: z.coerce.number().positive().default(5),
});

export type WorkerConfig = z.output<typeof workerEnvSchema>;

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConfigError';
  }
}

/** Nơi DUY NHẤT trong apps/worker đọc process.env; lỗi chỉ nêu tên biến, không in giá trị. */
export function loadWorkerConfig(env: NodeJS.ProcessEnv = process.env): WorkerConfig {
  const parsed = workerEnvSchema.safeParse(env);
  if (!parsed.success) {
    const names = [...new Set(parsed.error.issues.map((issue) => issue.path.join('.')))].join(', ');
    throw new ConfigError(`Cấu hình thiếu/sai: ${names}`);
  }
  return parsed.data;
}
