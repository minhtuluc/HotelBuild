import { z } from 'zod';

export const CONFIG = Symbol('CONFIG');

const logLevels = ['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'] as const;

const apiEnvSchema = z.object({
  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().min(1),
  JWT_ACCESS_SECRET: z.string().min(1),
  JWT_REFRESH_SECRET: z.string().min(1),
  BUSINESS_TIMEZONE: z.string().min(1),
  IDEMPOTENCY_TTL_HOURS: z.coerce.number().int().positive().default(24),
  LOG_LEVEL: z.enum(logLevels).default('info'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
});

export type ApiConfig = z.output<typeof apiEnvSchema>;

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConfigError';
  }
}

/** Nơi DUY NHẤT trong apps/api đọc process.env (QĐ-01 mục 7). Nêu TÊN biến, không in giá trị. */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): ApiConfig {
  const parsed = apiEnvSchema.safeParse({
    DATABASE_URL: env.DATABASE_URL,
    REDIS_URL: env.REDIS_URL,
    JWT_ACCESS_SECRET: env.JWT_ACCESS_SECRET,
    JWT_REFRESH_SECRET: env.JWT_REFRESH_SECRET,
    BUSINESS_TIMEZONE: env.BUSINESS_TIMEZONE,
    IDEMPOTENCY_TTL_HOURS: env.IDEMPOTENCY_TTL_HOURS,
    LOG_LEVEL: env.LOG_LEVEL,
    PORT: env.PORT,
  });
  if (!parsed.success) {
    const names = [...new Set(parsed.error.issues.map((issue) => issue.path.join('.')))].join(', ');
    throw new ConfigError(`Cấu hình thiếu/sai: ${names}`);
  }
  return parsed.data;
}
