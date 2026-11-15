/**
 * Dựng translator từ danh mục của **một** locale, không import registry `CATALOGS` (HB-313): client chỉ nhận
 * danh mục của locale đang xem qua `LocaleProvider`, nên bundle trình duyệt không chứa cả sáu ngôn ngữ.
 * Máy chủ dùng `translatorsFor` (`translate.ts`), cùng hàm này với danh mục lấy từ registry.
 */
import { makeTranslate } from '@pinehill/ui-web/messages';
import type {
  AccountMessageKey,
  CustomerMessageKey,
  LocaleCatalogs,
  PaymentMessageKey,
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

export function makeTranslators(locale: Locale, catalogs: LocaleCatalogs): Translators {
  return {
    locale,
    t: makeTranslate(catalogs.customer),
    account: makeTranslate(catalogs.account),
    payment: makeTranslate(catalogs.payment),
  };
}
