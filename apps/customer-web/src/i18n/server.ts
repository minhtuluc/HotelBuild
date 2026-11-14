/**
 * Locale và translator cho server component, route và metadata (HB-312).
 *
 * `middleware.ts` gắn locale và đường dẫn gốc (bỏ tiền tố) vào header của mọi request trang. Thiếu header
 * (ví dụ khi dựng tĩnh lúc build) thì về locale mặc định.
 */
import { headers } from 'next/headers';
import { DEFAULT_LOCALE, isLocale, localizePath, type Locale } from './locales';
import { translatorsFor, type Translators } from './translate';

const LOCALE_HEADER = 'x-ph-locale';
const PATH_HEADER = 'x-ph-path';

export async function requestLocale(): Promise<Locale> {
  const value = (await headers()).get(LOCALE_HEADER);
  return value !== null && isLocale(value) ? value : DEFAULT_LOCALE;
}

/** Đường dẫn của trang đang dựng, không có tiền tố locale (cho hreflang/canonical). */
export async function requestPath(): Promise<string> {
  return (await headers()).get(PATH_HEADER) ?? '/';
}

export async function serverTranslators(locale?: Locale): Promise<Translators> {
  return translatorsFor(locale ?? (await requestLocale()));
}

/** `href` nội bộ theo locale của request. */
export async function serverHref(href: string): Promise<string> {
  return localizePath(href, await requestLocale());
}
