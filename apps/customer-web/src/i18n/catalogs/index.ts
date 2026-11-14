/**
 * Registry danh mục theo locale. Danh mục `vi` định nghĩa bộ khoá; locale khác phải có đủ đúng bộ khoá đó
 * (kiểu `Record<Key, string>` báo thiếu khi biên dịch, test `catalogs.spec.ts` chặn chuỗi rỗng).
 */
import type { Locale } from '../locales';
import { viAccount, type AccountMessageKey } from './vi/account';
import { viCustomer, type CustomerMessageKey } from './vi/customer';
import { viPayment, type PaymentMessageKey } from './vi/payment';

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
};
