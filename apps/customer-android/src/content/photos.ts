/**
 * HB-277 — ảnh trang nội dung tải từ web khách (`/images/pine-hill/<ô>-640w.webp`, bản do
 * `scripts/photo-variants.mjs` của web sinh), không đóng gói 8 MB ảnh vào app. Ô chưa có file thì ảnh
 * báo lỗi tải và component ẩn ô, như web.
 */
import { propertyPageByStation } from '@pinehill/content/property-pages';
import { webOrigin } from '../config';

const SLOT_ID = /^[a-z0-9-]+$/i;

export function photoUri(id: string, origin: string | null = webOrigin()): string | null {
  if (origin === null || !SLOT_ID.test(id)) return null;
  return `${origin}/images/pine-hill/${id}-640w.webp`;
}

/** Mã ga (`DL`) → slug trang ga (`da-lat`). */
export function stationSlug(stationCode: string): string | null {
  return propertyPageByStation(stationCode)?.slug ?? null;
}
