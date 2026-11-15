/**
 * Registry danh mục theo locale. Danh mục `vi` định nghĩa bộ khoá; locale khác phải có đủ đúng bộ khoá đó
 * (kiểu `Record<Key, string>` báo thiếu khi biên dịch, test `catalogs.spec.ts` chặn chuỗi rỗng).
 */
import type { Locale } from '../locales';
import { enAccount } from './en/account';
import { enCustomer } from './en/customer';
import { enPayment } from './en/payment';
import { jaAccount } from './ja/account';
import { jaCustomer } from './ja/customer';
import { jaPayment } from './ja/payment';
import { koAccount } from './ko/account';
import { koCustomer } from './ko/customer';
import { koPayment } from './ko/payment';
import { ruAccount } from './ru/account';
import { ruCustomer } from './ru/customer';
import { ruPayment } from './ru/payment';
import { viAccount, type AccountMessageKey } from './vi/account';
import { viCustomer, type CustomerMessageKey } from './vi/customer';
import { viPayment, type PaymentMessageKey } from './vi/payment';
import { zhAccount } from './zh-cn/account';
import { zhCustomer } from './zh-cn/customer';
import { zhPayment } from './zh-cn/payment';

export type { AccountMessageKey, CustomerMessageKey, PaymentMessageKey };

export type CustomerCatalog = Readonly<Record<CustomerMessageKey, string>>;
export type AccountCatalog = Readonly<Record<AccountMessageKey, string>>;
export type PaymentCatalog = Readonly<Record<PaymentMessageKey, string>>;

export interface LocaleCatalogs {
  readonly customer: CustomerCatalog;
  readonly account: AccountCatalog;
  readonly payment: PaymentCatalog;
}

export const CATALOGS: Readonly<Record<Locale, LocaleCatalogs>> = {
  vi: { customer: viCustomer, account: viAccount, payment: viPayment },
  en: { customer: enCustomer, account: enAccount, payment: enPayment },
  'zh-CN': { customer: zhCustomer, account: zhAccount, payment: zhPayment },
  ja: { customer: jaCustomer, account: jaAccount, payment: jaPayment },
  ko: { customer: koCustomer, account: koAccount, payment: koPayment },
  ru: { customer: ruCustomer, account: ruAccount, payment: ruPayment },
};
