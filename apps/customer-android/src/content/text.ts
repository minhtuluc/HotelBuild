/**
 * HB-277 — câu chữ trang nội dung theo ngôn ngữ đang chọn, dùng **chính khoá của web khách**
 * (`@pinehill/content/catalogs/*`): không dịch lại, web sửa câu nào thì app đổi theo.
 */
import type { Locale } from '@pinehill/i18n';
import { enContent } from '@pinehill/content/catalogs/en';
import { jaContent } from '@pinehill/content/catalogs/ja';
import { koContent } from '@pinehill/content/catalogs/ko';
import { ruContent } from '@pinehill/content/catalogs/ru';
import { viContent } from '@pinehill/content/catalogs/vi';
import { zhContent } from '@pinehill/content/catalogs/zh-cn';
import { makeTranslate, type TranslateFor } from '@pinehill/ui-native';
import { currentLocale } from '../i18n/locale';

export type ContentKey = keyof typeof viContent;
type ContentCatalog = Readonly<Record<ContentKey, string>>;

const CATALOGS: Readonly<Record<Locale, ContentCatalog>> = {
  vi: viContent,
  en: enContent,
  'zh-CN': zhContent,
  ja: jaContent,
  ko: koContent,
  ru: ruContent,
};

const translators = new Map<Locale, TranslateFor<ContentCatalog>>();

export function ct(key: ContentKey, vars?: Readonly<Record<string, string | number>>): string {
  const locale = currentLocale();
  let translate = translators.get(locale);
  if (translate === undefined) {
    translate = makeTranslate(CATALOGS[locale]);
    translators.set(locale, translate);
  }
  return translate(key, vars);
}
