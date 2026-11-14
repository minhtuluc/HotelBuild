'use client';
/**
 * Ràng buộc React cho locale: `LocaleProvider` đặt ở layout, client component đọc translator qua hook.
 * Bọc luôn `I18nProvider` của `ui-web` để các trạng thái dùng chung (`StatePanel`…) nói cùng ngôn ngữ.
 */
import { createContext, useContext, type ReactElement, type ReactNode } from 'react';
import { I18nProvider } from '@pinehill/ui-web';
import { CATALOGS, type PaymentCatalog } from './catalogs';
import { DEFAULT_LOCALE, type Locale } from './locales';
import {
  translatorsFor,
  type AccountTranslate,
  type CustomerTranslate,
  type PaymentTranslate,
  type Translators,
} from './translate';

const LocaleContext = createContext<Locale>(DEFAULT_LOCALE);

export function LocaleProvider({
  locale,
  children,
}: {
  locale: Locale;
  children: ReactNode;
}): ReactElement {
  return (
    <LocaleContext.Provider value={locale}>
      <I18nProvider catalog={CATALOGS[locale].customer}>{children}</I18nProvider>
    </LocaleContext.Provider>
  );
}

export function useLocale(): Locale {
  return useContext(LocaleContext);
}

/** Cả bộ translator + locale, cho hàm phụ cần định dạng ngày và câu chữ cùng lúc. */
export function useTranslators(): Translators {
  return translatorsFor(useLocale());
}

export function useT(): CustomerTranslate {
  return translatorsFor(useLocale()).t;
}

export function useAccountText(): AccountTranslate {
  return translatorsFor(useLocale()).account;
}

export function usePaymentText(): PaymentTranslate {
  return translatorsFor(useLocale()).payment;
}

/** Danh mục SCR-06 dạng bản ghi, cho chỗ đọc thẳng câu không nội suy (`m.title`). */
export function usePaymentCatalog(): PaymentCatalog {
  return CATALOGS[useLocale()].payment;
}
