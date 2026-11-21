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

/** Chế độ demo chỉ bật khi có cờ `EXPO_PUBLIC_DEMO_MODE=true` và không ở bản production (TD-44). */
export function readDemoEnabled(source: Readonly<Record<string, string | undefined>>): boolean {
  return source.EXPO_PUBLIC_DEMO_MODE === 'true' && source.EXPO_PUBLIC_APP_VARIANT !== 'production';
}

export function isDemoEnabled(): boolean {
  return readDemoEnabled(process.env);
}

/**
 * HB-277: origin công khai của web khách, nơi app tải ảnh trang nội dung (`/images/pine-hill/...`).
 * Không bắt buộc: thiếu hoặc sai dạng thì màn nội dung vẫn hiện chữ, chỉ ẩn ảnh (giống web khi chưa có ảnh).
 */
export function readWebOrigin(source: Readonly<Record<string, string | undefined>>): string | null {
  const raw = source.EXPO_PUBLIC_WEB_ORIGIN;
  if (raw === undefined || raw === '') return null;
  try {
    const url = new URL(raw);
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.origin : null;
  } catch {
    return null;
  }
}

export function webOrigin(): string | null {
  return readWebOrigin(process.env);
}
