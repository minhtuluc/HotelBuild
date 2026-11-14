/**
 * Nguồn chân lý về locale của Customer Web (kế hoạch đa ngôn ngữ §3).
 *
 * Đợt 2 (HB-309) chỉ có `vi`. Thêm locale = thêm vào `LOCALES` + `LOCALE_META` + danh mục đủ khoá trong
 * `catalogs/`; kiểu sẽ báo thiếu ở mọi chỗ cần bổ sung.
 */

export const LOCALES = ['vi'] as const;

export type Locale = (typeof LOCALES)[number];

export const DEFAULT_LOCALE: Locale = 'vi';

export interface LocaleMeta {
  /** Thẻ BCP 47 cho `Intl` (định dạng tiền, ngày, thứ). */
  readonly intl: string;
  /** Giá trị `<html lang>`. */
  readonly htmlLang: string;
  /** Tên ngôn ngữ viết bằng chính ngôn ngữ đó (cho nút chọn ngôn ngữ ở đợt 5). */
  readonly label: string;
}

export const LOCALE_META: Readonly<Record<Locale, LocaleMeta>> = {
  vi: { intl: 'vi-VN', htmlLang: 'vi', label: 'Tiếng Việt' },
};

export function isLocale(value: string): value is Locale {
  return LOCALES.some((locale) => locale === value);
}
