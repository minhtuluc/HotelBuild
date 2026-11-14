import { webEnv } from './index';

/**
 * Origin công khai của web khách (canonical, Open Graph, JSON-LD) — HB-310.
 *
 * Cùng biến `SESSION_APP_ORIGIN` mà BFF dùng để chặn yêu cầu khác origin. Ở đây sai cấu trúc thì
 * trả `null` (trang dùng đường dẫn tương đối) thay vì dừng trang: đây là dữ liệu hiển thị, không phải
 * cấu hình phiên. Chỉ thư mục `config` của app được đọc `process.env` (kiến trúc §7.5).
 */
export function siteOrigin(): string | null {
  const value = process.env.SESSION_APP_ORIGIN;
  if (value === undefined || value === '') return null;
  try {
    return new URL(value).origin;
  } catch {
    return null;
  }
}

export function sessionConfig() {
  const configured = process.env.SESSION_APP_ORIGIN;
  if (configured && new URL(configured).origin !== configured) {
    throw new Error('SESSION_APP_ORIGIN must be an exact HTTP(S) origin');
  }
  if (configured && !['http:', 'https:'].includes(new URL(configured).protocol)) {
    throw new Error('SESSION_APP_ORIGIN must use HTTP(S)');
  }
  return {
    baseUrl: webEnv().NEXT_PUBLIC_API_BASE_URL,
    development: process.env.NODE_ENV === 'development',
    ...(configured ? { origin: configured } : {}),
  };
}
