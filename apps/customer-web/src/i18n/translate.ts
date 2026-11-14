/**
 * Translator theo locale, thuần (không React) để server component, metadata, hàm phụ và client component
 * dùng chung. Không có translator toàn cục: nơi gọi luôn nói rõ locale (HB-309).
 */
import { makeTranslate } from '@pinehill/ui-web/messages';
import {
  CATALOGS,
  type AccountMessageKey,
  type CustomerMessageKey,
  type PaymentMessageKey,
} from './catalogs';
import type { Locale } from './locales';

export type MessageVars = Readonly<Record<string, string | number>>;
export type CustomerTranslate = (key: CustomerMessageKey, vars?: MessageVars) => string;
export type AccountTranslate = (key: AccountMessageKey, vars?: MessageVars) => string;
export type PaymentTranslate = (key: PaymentMessageKey, vars?: MessageVars) => string;

export interface Translators {
  readonly locale: Locale;
  readonly t: CustomerTranslate;
  readonly account: AccountTranslate;
  readonly payment: PaymentTranslate;
}

const cache = new Map<Locale, Translators>();

export function translatorsFor(locale: Locale): Translators {
  const cached = cache.get(locale);
  if (cached !== undefined) return cached;
  const catalogs = CATALOGS[locale];
  const made: Translators = {
    locale,
    t: makeTranslate(catalogs.customer),
    account: makeTranslate(catalogs.account),
    payment: makeTranslate(catalogs.payment),
  };
  cache.set(locale, made);
  return made;
}
