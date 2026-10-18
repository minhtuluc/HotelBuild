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
  // Thư mục tệp xuất tạm (HB-163). Bỏ trống ⇒ `<tmpdir>/pinehill-exports`; **phải trùng** giá trị với
  // `apps/worker` vì worker ghi tệp còn API đọc tệp để phục vụ link tải.
  EXPORT_DIR: z.string().min(1).optional(),
  // Cổng thanh toán (HB-094). Thiếu bộ khoá ⇒ adapter chạy bộ mô phỏng **cùng hợp đồng** (sandbox chưa
  // có); điền đủ bộ của một cổng ⇒ chuyển sang chế độ thật **chỉ bằng cấu hình**, không sửa mã. Bí mật
  // không bao giờ vào log/nhật ký (BR-PAY-04, NFR-SEC-02) và tên biến đã có trong `.env.example`.
  VNPAY_TMN_CODE: z.string().min(1).optional(),
  VNPAY_HASH_SECRET: z.string().min(1).optional(),
  // Đổi máy chủ cổng (sandbox ↔ production) bằng cấu hình; mặc định là sandbox của tài liệu PSP.
  VNPAY_PAYMENT_URL: urlWithProtocol('https:').optional(),
  MOMO_PARTNER_CODE: z.string().min(1).optional(),
  MOMO_ACCESS_KEY: z.string().min(1).optional(),
  MOMO_SECRET_KEY: z.string().min(1).optional(),
  MOMO_PAYMENT_URL: urlWithProtocol('https:').optional(),
  // Gốc URL công khai mà PSP gọi về (`.../integrations/psp/{vnpay|momo}/callback`, HB-095). Bỏ trống ⇒
  // suy từ `returnUrl` của lệnh khởi tạo (đủ cho local; deploy thật PHẢI khai).
  PAYMENT_PSP_CALLBACK_BASE_URL: urlWithProtocol('http:', 'https:').optional(),
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
