/**
 * Cấu hình app Android — nơi duy nhất đọc `process.env` (kiến trúc §7.5).
 * Biến lấy từ EAS Environment Variables (NFR-SEC-06); thiếu thì dừng ngay.
 */
import { mobileEnvSchema, type MobileEnv } from '@pinehill/contracts';

export function readMobileEnv(source: Readonly<Record<string, string | undefined>>): MobileEnv {
  const parsed = mobileEnvSchema.safeParse({
    EXPO_PUBLIC_API_BASE_URL: source.EXPO_PUBLIC_API_BASE_URL,
    EXPO_PUBLIC_APP_VARIANT: source.EXPO_PUBLIC_APP_VARIANT,
  });
  if (!parsed.success) {
    const reasons = parsed.error.issues
      .map((issue) => `${issue.path.join('.') || '(gốc)'}: ${issue.message}`)
      .join('; ');
    throw new Error(`Cấu hình Android không hợp lệ — ${reasons}`);
  }
  return parsed.data;
}

let cached: MobileEnv | undefined;

export function mobileEnv(): MobileEnv {
  cached ??= readMobileEnv(process.env);
  return cached;
}
