import { z } from 'zod';
import { DEFAULT_SAMPLE_RATIO } from '../infrastructure/tracing/sampling.js';

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
  // dev dùng gốc loopback cố định từ `HOST`/`PORT`; production **bắt buộc** (xem `pspSettings`).
  PAYMENT_PSP_CALLBACK_BASE_URL: urlWithProtocol('http:', 'https:').optional(),
  // Danh sách trắng **origin** được phép làm `returnUrl` của khách (phẩy ngăn cách). Bỏ trống ⇒ dùng
  // origin của `PAYMENT_PSP_CALLBACK_BASE_URL`; rỗng cả hai ⇒ chỉ dev/test mới cho qua (production dừng).
  PAYMENT_RETURN_URL_ORIGINS: z.string().min(1).optional(),
  // Cờ **chỉ dùng cho kiểm thử**: cho phép bộ mô phỏng PSP xác minh sự kiện. Thiếu cờ ⇒ `verify` của
  // adapter `mock` từ chối mọi sự kiện (khoá mô phỏng là công khai, không được xác nhận tiền).
  PSP_ALLOW_MOCK: z.enum(['true', 'false']).optional(),
  // Chỉ để quyết định fail-fast (production không được chạy adapter mô phỏng). `loadConfig` đọc từ env.
  NODE_ENV: z.enum(['development', 'test', 'production']).optional(),
  LOG_LEVEL: z.enum(logLevels).default('info'),
  // Thư giao dịch của API (HB-028: đặt lại mật khẩu khách). Thiếu `SMTP_URL` ⇒ API vẫn chạy nhưng việc gửi thư
  // lỗi `MAIL_NOT_CONFIGURED` (được log + audit, phản hồi vẫn 202). `SMTP_FROM` bỏ trống ⇒ địa chỉ dev
  // `no-reply@localhost` — production **phải** đặt. `GUEST_WEB_BASE_URL` là gốc customer web dùng dựng link
  // (`<gốc>/account/reset-password?token=…`); không ghi cứng trong mã. Worker có cặp riêng `NOTI_SMTP_*`.
  SMTP_URL: urlWithProtocol('smtp:', 'smtps:').optional(),
  SMTP_FROM: z.string().min(3).max(200).optional(),
  GUEST_WEB_BASE_URL: urlWithProtocol('http:', 'https:').optional(),
  // Quan sát (HB-181): endpoint OTLP bỏ trống ⇒ **không** bật exporter (mặc định dev); trace vẫn lan
  // truyền qua `traceparent`. Ứng dụng xuất **đủ** span — lấy mẫu (≥ 10%, giữ 100% lỗi/thanh toán) là việc
  // của collector (`infra/observability/otel-collector.yml`). `OTEL_SAMPLE_RATIO` chỉ đặt cờ sampled của
  // W3C cho dịch vụ nhận, **không** bỏ span nào ở đây (đặt mẫu hai nơi làm số liệu SLO sai).
  OTEL_EXPORTER_OTLP_ENDPOINT: z
    .string()
    .optional()
    .transform((value) => (value === undefined || value.trim() === '' ? undefined : value))
    .pipe(urlWithProtocol('http:', 'https:').optional()),
  // Bỏ trống ⇒ `DEFAULT_SAMPLE_RATIO` (cờ W3C, xem ghi chú trên); nơi dùng áp mặc định để kiểu cấu hình
  // vẫn tuỳ chọn (test dựng `ApiConfig` trực tiếp). Giá trị khai báo phải nằm trong `[0.1, 1]`.
  OTEL_SAMPLE_RATIO: z
    .string()
    .optional()
    .transform((value) => (value === undefined || value.trim() === '' ? undefined : Number(value)))
    .refine(
      (value) =>
        value === undefined ||
        (Number.isFinite(value) && value >= DEFAULT_SAMPLE_RATIO && value <= 1),
      { message: 'OTEL_SAMPLE_RATIO phải trong khoảng 0.1..1' },
    )
    // `optional()` ngoài cùng: khoá vắng ⇒ mặc định ở nơi dùng, kiểu cấu hình vẫn dựng được trong test.
    .optional(),
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
