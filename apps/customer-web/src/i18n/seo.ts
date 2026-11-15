/**
 * Canonical và `hreflang` theo locale (HB-312, kế hoạch đa ngôn ngữ §7). `x-default` trỏ bản không tiền tố
 * (tiếng Việt, quyết định Q2). URL tương đối được Next ghép với `metadataBase` (origin công khai).
 */
import { LOCALES, LOCALE_META, localizePath, type Locale } from './locales';

export interface LocaleAlternates {
  readonly canonical: string;
  readonly languages: Readonly<Record<string, string>>;
}

export function localeAlternates(path: string, locale: Locale): LocaleAlternates {
  const languages: Record<string, string> = {};
  for (const each of LOCALES) languages[LOCALE_META[each].htmlLang] = localizePath(path, each);
  languages['x-default'] = localizePath(path, 'vi');
  return { canonical: localizePath(path, locale), languages };
}
