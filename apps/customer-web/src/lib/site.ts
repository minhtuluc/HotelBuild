/**
 * Origin công khai của web khách, cho canonical, Open Graph và JSON-LD (HB-310).
 *
 * Dùng lại `SESSION_APP_ORIGIN`, biến môi trường đã bắt buộc khi triển khai: đó chính là origin khách gõ
 * vào trình duyệt (BFF dùng nó để chặn yêu cầu khác origin). Thiếu hoặc sai thì trả `null` và trang dùng
 * đường dẫn tương đối thay vì đoán một tên miền.
 */
import { photoSrc } from './photos';

export function siteOrigin(): string | null {
  const value = process.env.SESSION_APP_ORIGIN;
  if (value === undefined || value === '') return null;
  try {
    return new URL(value).origin;
  } catch {
    return null;
  }
}

/** URL tuyệt đối nếu biết origin, không thì đường dẫn tương đối. */
export function absoluteUrl(path: string): string {
  const origin = siteOrigin();
  return origin === null ? path : `${origin}${path}`;
}

/** Ảnh Open Graph của một ô ảnh (nếu có file). */
export function openGraphImage(
  photoId: string,
  alt: string,
): { readonly url: string; readonly alt: string }[] {
  const src = photoSrc(photoId);
  return src === null ? [] : [{ url: src, alt }];
}
