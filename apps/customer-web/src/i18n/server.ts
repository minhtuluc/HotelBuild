/**
 * Locale và translator cho server component, route và metadata.
 *
 * Đợt 2 (HB-309) chỉ có `vi` nên `requestLocale()` trả locale mặc định. Đợt 5 (HB-312) đọc locale từ
 * đoạn URL; mọi nơi gọi đã đi qua hàm này nên chỉ phải sửa một chỗ.
 */
import { DEFAULT_LOCALE, type Locale } from './locales';
import { translatorsFor, type Translators } from './translate';

export function requestLocale(): Locale {
  return DEFAULT_LOCALE;
}

export function serverTranslators(locale: Locale = requestLocale()): Translators {
  return translatorsFor(locale);
}
