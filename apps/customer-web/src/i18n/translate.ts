/**
 * Translator theo locale, thuần (không React) cho server component, metadata và hàm phụ phía máy chủ. Không
 * có translator toàn cục: nơi gọi luôn nói rõ locale (HB-309). Client đọc translator qua hook ở `client.tsx`
 * (chỉ có danh mục của locale đang xem, HB-313).
 */
import { CATALOGS } from './catalogs';
import type { Locale } from './locales';
import { makeTranslators, type Translators } from './translators';

export type {
  AccountTranslate,
  CustomerTranslate,
  MessageVars,
  PaymentTranslate,
  Translators,
} from './translators';

const cache = new Map<Locale, Translators>();

export function translatorsFor(locale: Locale): Translators {
  const cached = cache.get(locale);
  if (cached !== undefined) return cached;
  const made = makeTranslators(locale, CATALOGS[locale]);
  cache.set(locale, made);
  return made;
}
