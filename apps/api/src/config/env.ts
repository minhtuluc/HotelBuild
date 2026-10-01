import { z } from 'zod';

export const CONFIG = Symbol('CONFIG');

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

const apiEnvSchema = z.object({
  DATABASE_URL: urlWithProtocol('postgres:', 'postgresql:'),
  REDIS_URL: urlWithProtocol('redis:', 'rediss:'),
  JWT_ACCESS_SECRET: z.string().min(1),
  JWT_REFRESH_SECRET: z.string().min(1),
  BUSINESS_TIMEZONE: z.string().refine((value) => {
    try {
      new Intl.DateTimeFormat('en-US', { timeZone: value });
      return true;
    } catch {
      return false;
    }
  }),
  IDEMPOTENCY_TTL_HOURS: z.coerce.number().int().positive().default(24),
  LOG_LEVEL: z.enum(logLevels).default('info'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  // Mặc định chỉ nghe loopback (dev); container đặt HOST=0.0.0.0 (AC6).
  HOST: z.string().min(1).default('127.0.0.1'),
});

export type ApiConfig = z.output<typeof apiEnvSchema>;

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConfigError';
  }
}

/** Nơi DUY NHẤT trong apps/api đọc process.env; lỗi chỉ nêu tên biến, không in giá trị. */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): ApiConfig {
  const parsed = apiEnvSchema.safeParse(env);
  if (!parsed.success) {
    const names = [...new Set(parsed.error.issues.map((issue) => issue.path.join('.')))].join(', ');
    throw new ConfigError(`Cấu hình thiếu/sai: ${names}`);
  }
  return parsed.data;
}
