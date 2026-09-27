/**
 * Cấu hình của app — nơi duy nhất được đọc `process.env` (kiến trúc §7.5).
 * Thiếu hoặc sai biến thì dừng ngay khi khởi động (NFR-MAIN-05).
 */
import { webEnvSchema, type WebEnv } from '@pinehill/contracts';

export function readWebEnv(source: Readonly<Record<string, string | undefined>>): WebEnv {
  const parsed = webEnvSchema.safeParse({
    NEXT_PUBLIC_API_BASE_URL: source.NEXT_PUBLIC_API_BASE_URL,
  });
  if (!parsed.success) {
    const reasons = parsed.error.issues
      .map((issue) => `${issue.path.join('.') || '(gốc)'}: ${issue.message}`)
      .join('; ');
    throw new Error(`Cấu hình web không hợp lệ — ${reasons}`);
  }
  return parsed.data;
}

let cached: WebEnv | undefined;

export function webEnv(): WebEnv {
  cached ??= readWebEnv(process.env);
  return cached;
}
