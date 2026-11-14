/**
 * Origin công khai của web khách, cho canonical, Open Graph và JSON-LD (HB-310).
 *
 * Dùng lại `SESSION_APP_ORIGIN`, biến môi trường đã bắt buộc khi triển khai: đó chính là origin khách gõ
 * vào trình duyệt (BFF dùng nó để chặn yêu cầu khác origin). Thiếu hoặc sai thì trả `null` và trang dùng
 * đường dẫn tương đối thay vì đoán một tên miền.
 */
import { photoSrc } from './photos';
import { siteOrigin as configuredOrigin } from '../config/session';

export function siteOrigin(): string | null {
  return configuredOrigin();
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
