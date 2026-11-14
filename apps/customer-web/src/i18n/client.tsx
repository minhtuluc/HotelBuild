'use client';
/**
 * Ràng buộc React cho locale: `LocaleProvider` đặt ở layout, client component đọc translator qua hook.
 * Bọc luôn `I18nProvider` của `ui-web` để các trạng thái dùng chung (`StatePanel`…) nói cùng ngôn ngữ.
 */
import { createContext, useContext, type ReactElement, type ReactNode } from 'react';
import { I18nProvider } from '@pinehill/ui-web';
import { CATALOGS, type PaymentCatalog } from './catalogs';
import { dateTimeVn, money } from './format';
import { DEFAULT_LOCALE, localizePath, type Locale } from './locales';
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

/** Tiền VND theo dấu phân cách của locale đang xem (`1.222.000 ₫` / `1,222,000 ₫`). */
export function useMoney(): (amountVnd: number) => string {
  const locale = useLocale();
  return (amountVnd) => money(amountVnd, locale);
}

/** Mốc thời gian theo giờ Việt Nam, nhãn giờ theo locale. */
export function useDateTimeVn(): (isoUtc: string) => string {
  const { locale, t } = translatorsFor(useLocale());
  return (isoUtc) => dateTimeVn(isoUtc, locale, t('guest.time.vn'));
}

/** Hàm thêm tiền tố locale cho đường dẫn nội bộ (`router.push`, `<a href>`, `next` sau đăng nhập). */
export function useLocalePath(): (href: string) => string {
  const locale = useLocale();
  return (href) => localizePath(href, locale);
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
