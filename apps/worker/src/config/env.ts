import { z } from 'zod';
import { DEFAULT_SAMPLE_RATIO } from '../tracing/sampling.js';

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
  // Thư mục tệp xuất tạm (HB-163): worker GHI tệp, API ĐỌC tệp để phục vụ link tải ⇒ hai app phải
  // dùng cùng giá trị (bỏ trống ⇒ `<tmpdir>/pinehill-exports`).
  EXPORT_DIR: z.string().min(1).optional(),
  // Kênh email của thông báo (HB-168). Thiếu ⇒ kênh EMAIL lỗi `EMAIL_NOT_CONFIGURED`, không giả vờ đã gửi;
  // SMS/ZALO_OA/PUSH là adapter giả lập nên không có biến môi trường.
  NOTI_SMTP_URL: urlWithProtocol('smtp:', 'smtps:').optional(),
  NOTI_SMTP_FROM: z.string().min(3).max(200).optional(),
  LOG_LEVEL: z.enum(logLevels).default('info'),
  // Quan sát (HB-181): endpoint OTLP bỏ trống ⇒ không bật exporter (mặc định dev). Tỉ lệ lấy mẫu tối
  // thiểu 10%; việc lỗi và việc chạm tiền luôn được giữ 100% bất kể giá trị này.
  OTEL_EXPORTER_OTLP_ENDPOINT: z
    .string()
    .optional()
    .transform((value) => (value === undefined || value.trim() === '' ? undefined : value))
    .pipe(urlWithProtocol('http:', 'https:').optional()),
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
  WORKER_CONCURRENCY: z.coerce.number().int().min(1).max(64).default(5),
  SHUTDOWN_TIMEOUT_SECONDS: z.coerce.number().positive().default(15),
  ENABLE_REPEATABLE_SCHEDULERS: z
    .enum(['true', 'false'])
    .default('false')
    .transform((value) => value === 'true'),
  HOLD_EXPIRY_INTERVAL_SECONDS: z.coerce.number().positive().default(30),
  // HB-078: trần booking mỗi trang quét hết hạn (nhịp 30 giây phải ngắn) và nhịp đối chiếu 900 giây
  // (`job.holdReconcile.intervalSeconds`, BR-BOOK-18) cùng trần số bản ghi Hold đọc mỗi lượt đối chiếu.
  HOLD_EXPIRY_BATCH_SIZE: z.coerce.number().int().min(1).max(500).default(100),
  HOLD_RECONCILE_INTERVAL_SECONDS: z.coerce.number().positive().default(900),
  HOLD_RECONCILE_MAX_KEYS: z.coerce.number().int().min(1).max(10_000).default(1000),
  OUTBOX_RELAY_INTERVAL_SECONDS: z.coerce.number().positive().default(5),
  // Vận chuyển outbox (HB-130): kích thước lô mỗi lượt, thời gian giữ lease một lượt và backoff thử lại.
  // Trần 5 lượt vận chuyển thất bại trước dead letter là hằng nghiệp vụ BR-CHAN-07 (không cấu hình được).
  OUTBOX_RELAY_BATCH_SIZE: z.coerce.number().int().min(1).max(500).default(50),
  OUTBOX_RELAY_LEASE_SECONDS: z.coerce.number().positive().max(3600).default(30),
  OUTBOX_RELAY_RETRY_BASE_SECONDS: z.coerce.number().positive().max(3600).default(30),
  OUTBOX_RELAY_RETRY_MAX_SECONDS: z.coerce.number().positive().max(86_400).default(900),
  // Chu kỳ dọn tệp xuất hết hạn (HB-163 AC2). Tệp chỉ sống `EXPORT_TTL_SECONDS` = 15 phút nên quét
  // mỗi 15 phút là đủ; đây là chu kỳ chạy, không phải hạn sống của tệp.
  EXPORT_CLEANUP_INTERVAL_SECONDS: z.coerce.number().positive().default(900),
  // HB-100: worker chi hoàn. Nhịp quét, trần lô, thời gian giữ lease (worker chết thì lease hết và
  // lượt sau đối soát lại), thời gian chờ trước khi đối soát lại kết quả không rõ, hẹn đối soát tay
  // cho chuyển khoản, và trần số lần gửi PSP trước FAILED_FINAL.
  REFUND_PAYOUT_INTERVAL_SECONDS: z.coerce.number().positive().default(30),
  REFUND_PAYOUT_BATCH_SIZE: z.coerce.number().int().min(1).max(200).default(20),
  REFUND_PAYOUT_LEASE_SECONDS: z.coerce.number().positive().max(3600).default(60),
  REFUND_PAYOUT_RETRY_SECONDS: z.coerce.number().positive().max(86_400).default(300),
  REFUND_PAYOUT_MANUAL_POLL_SECONDS: z.coerce.number().positive().max(86_400).default(900),
  REFUND_PAYOUT_MAX_ATTEMPTS: z.coerce.number().int().min(1).max(20).default(5),
  // Chỉ bật ở dev/test: chưa có adapter API hoàn tiền của VNPay/MoMo, mặc định KHÔNG tự chi.
  REFUND_PAYOUT_SIMULATOR: z
    .enum(['true', 'false'])
    .default('false')
    .transform((value) => value === 'true'),
  // HB-147: đánh dấu no-show (BR-CANCEL-10, BR-SYS-02 `job.noShow.markTime`). Nhịp quét một phút để
  // trượt mốc 23:59 không quá một phút; mốc giờ VN và trần booking mỗi trang cấu hình được.
  NO_SHOW_MARK_INTERVAL_SECONDS: z.coerce.number().positive().default(60),
  NO_SHOW_MARK_TIME: z
    .string()
    .regex(/^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/)
    .default('23:59'),
  // Cửa sổ bắt sót (ngày): một ngày worker chết/trượt mốc không làm booking đó vĩnh viễn bị bỏ quên.
  NO_SHOW_CATCHUP_DAYS: z.coerce.number().int().min(0).max(30).default(7),
  NO_SHOW_BATCH_SIZE: z.coerce.number().int().min(1).max(500).default(100),
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
