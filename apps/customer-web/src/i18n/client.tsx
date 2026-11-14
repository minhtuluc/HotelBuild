'use client';
/**
 * Ràng buộc React cho locale: `LocaleProvider` đặt ở layout, client component đọc translator qua hook.
 * Bọc luôn `I18nProvider` của `ui-web` để các trạng thái dùng chung (`StatePanel`…) nói cùng ngôn ngữ.
 *
 * Layout (máy chủ) truyền danh mục của đúng locale đang xem (HB-313); module này không import registry
 * `CATALOGS`, nên bundle trình duyệt chỉ mang sẵn bản `vi` (mặc định), không mang cả sáu ngôn ngữ. Đổi ngôn
 * ngữ tải lại trang (`LanguageSelect`).
 */
import { createContext, useContext, useMemo, type ReactElement, type ReactNode } from 'react';
import { I18nProvider } from '@pinehill/ui-web';
import type { LocaleCatalogs, PaymentCatalog } from './catalogs';
import { dateTimeVn, money } from './format';
import { viAccount } from './catalogs/vi/account';
import { viCustomer } from './catalogs/vi/customer';
import { viPayment } from './catalogs/vi/payment';
import { DEFAULT_LOCALE, localizePath, type Locale } from './locales';
import {
  makeTranslators,
  type AccountTranslate,
  type CustomerTranslate,
  type PaymentTranslate,
  type Translators,
} from './translators';

interface LocaleValue {
  readonly translators: Translators;
  readonly catalogs: LocaleCatalogs;
}

/**
 * Ngoài provider (test render component đơn lẻ) vẫn là tiếng Việt như trước HB-313. Đây là danh mục duy nhất
 * client mang sẵn; locale khác chỉ đến qua prop của `LocaleProvider`.
 */
const VI_CATALOGS: LocaleCatalogs = {
  customer: viCustomer,
  account: viAccount,
  payment: viPayment,
};
const DEFAULT_VALUE: LocaleValue = {
  translators: makeTranslators(DEFAULT_LOCALE, VI_CATALOGS),
  catalogs: VI_CATALOGS,
};

const LocaleContext = createContext<LocaleValue>(DEFAULT_VALUE);

export function LocaleProvider({
  locale,
  catalogs,
  children,
}: {
  locale: Locale;
  catalogs: LocaleCatalogs;
  children: ReactNode;
}): ReactElement {
  const value = useMemo(
    () => ({ translators: makeTranslators(locale, catalogs), catalogs }),
    [locale, catalogs],
  );
  return (
    <LocaleContext.Provider value={value}>
      <I18nProvider catalog={catalogs.customer}>{children}</I18nProvider>
    </LocaleContext.Provider>
  );
}

function useLocaleValue(): LocaleValue {
  return useContext(LocaleContext);
}

export function useLocale(): Locale {
  return useLocaleValue().translators.locale;
}

/** Tiền VND theo dấu phân cách của locale đang xem (`1.222.000 ₫` / `1,222,000 ₫`). */
export function useMoney(): (amountVnd: number) => string {
  const locale = useLocale();
  return (amountVnd) => money(amountVnd, locale);
}

/** Mốc thời gian theo giờ Việt Nam, nhãn giờ theo locale. */
export function useDateTimeVn(): (isoUtc: string) => string {
  const { locale, t } = useLocaleValue().translators;
  return (isoUtc) => dateTimeVn(isoUtc, locale, t('guest.time.vn'));
}

/** Hàm thêm tiền tố locale cho đường dẫn nội bộ (`router.push`, `<a href>`, `next` sau đăng nhập). */
export function useLocalePath(): (href: string) => string {
  const locale = useLocale();
  return (href) => localizePath(href, locale);
}

/** Cả bộ translator + locale, cho hàm phụ cần định dạng ngày và câu chữ cùng lúc. */
export function useTranslators(): Translators {
  return useLocaleValue().translators;
}

export function useT(): CustomerTranslate {
  return useLocaleValue().translators.t;
}

export function useAccountText(): AccountTranslate {
  return useLocaleValue().translators.account;
}

export function usePaymentText(): PaymentTranslate {
  return useLocaleValue().translators.payment;
}

/** Danh mục SCR-06 dạng bản ghi, cho chỗ đọc thẳng câu không nội suy (`m.title`). */
export function usePaymentCatalog(): PaymentCatalog {
  return useLocaleValue().catalogs.payment;
}
