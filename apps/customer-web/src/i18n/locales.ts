/**
 * Nguồn chân lý về locale của Customer Web (kế hoạch đa ngôn ngữ §3, quyết định Q2).
 *
 * URL: `/` và mọi đường dẫn hiện có là tiếng Việt; locale khác có tiền tố (`/en/...`). `middleware.ts` ghi
 * đè đường dẫn có tiền tố về route hiện có và gắn locale vào header; máy chủ đọc qua `requestLocale()`.
 * Thêm locale = thêm vào `LOCALES` + `LOCALE_META` + danh mục đủ khoá trong `catalogs/`.
 */

export const LOCALES = ['vi', 'en'] as const;

export type Locale = (typeof LOCALES)[number];

export const DEFAULT_LOCALE: Locale = 'vi';

export interface LocaleMeta {
  /** Thẻ BCP 47 cho `Intl` (định dạng tiền, ngày, thứ). */
  readonly intl: string;
  /** Giá trị `<html lang>` và `hreflang`. */
  readonly htmlLang: string;
  /** Giá trị `og:locale`. */
  readonly ogLocale: string;
  /** Tên ngôn ngữ viết bằng chính ngôn ngữ đó (nút chọn ngôn ngữ). */
  readonly label: string;
  /** Tiền tố đường dẫn; locale mặc định không có tiền tố. */
  readonly prefix: string;
}

export const LOCALE_META: Readonly<Record<Locale, LocaleMeta>> = {
  vi: { intl: 'vi-VN', htmlLang: 'vi', ogLocale: 'vi_VN', label: 'Tiếng Việt', prefix: '' },
  // en-GB: ngày trước tháng (24/12/2026) như tiếng Việt, tránh khách đọc nhầm ngày/tháng.
  en: { intl: 'en-GB', htmlLang: 'en', ogLocale: 'en_GB', label: 'English', prefix: '/en' },
};

export function isLocale(value: string): value is Locale {
  return LOCALES.some((locale) => locale === value);
}

/** Đường dẫn không đổi theo locale: API BFF, tệp tĩnh, nội bộ Next. */
const UNLOCALIZED = /^\/(api|_next|images|fonts|__test)(\/|$)|^\/[^/]+\.[a-z0-9]+$/i;

/** Tách tiền tố locale: `/en/stays/da-lat` → `{ locale: 'en', path: '/stays/da-lat' }`. */
export function splitLocale(pathname: string): { readonly locale: Locale; readonly path: string } {
  for (const locale of LOCALES) {
    const { prefix } = LOCALE_META[locale];
    if (prefix === '') continue;
    if (pathname === prefix) return { locale, path: '/' };
    if (pathname.startsWith(`${prefix}/`)) return { locale, path: pathname.slice(prefix.length) };
  }
  return { locale: DEFAULT_LOCALE, path: pathname };
}

/**
 * Đường dẫn nội bộ theo locale: thêm tiền tố cho đường dẫn tuyệt đối trong site, giữ query và hash.
 * Link ngoài, neo cùng trang (`#...`) và đường dẫn API/tệp tĩnh giữ nguyên.
 */
export function localizePath(href: string, locale: Locale): string {
  if (!href.startsWith('/') || href.startsWith('//')) return href;
  const cut = href.search(/[?#]/);
  const pathname = cut === -1 ? href : href.slice(0, cut);
  const rest = cut === -1 ? '' : href.slice(cut);
  if (UNLOCALIZED.test(pathname)) return href;
  const bare = splitLocale(pathname).path;
  const { prefix } = LOCALE_META[locale];
  if (prefix === '') return `${bare}${rest}`;
  return `${bare === '/' ? prefix : `${prefix}${bare}`}${rest}`;
}
