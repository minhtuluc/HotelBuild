/** Registry gói nội dung của các locale thêm sau `vi`/`en` (HB-313). Locale mới phải có gói ở đây. */
import { JA_PACK } from './ja';
import { KO_PACK } from './ko';
import { RU_PACK } from './ru';
import type { LocaleContentPack, PackLocale } from './types';
import { ZH_CN_PACK } from './zh-cn';

export type { LocaleContentPack, PackLocale };

export const CONTENT_PACKS: Readonly<Record<PackLocale, LocaleContentPack>> = {
  'zh-CN': ZH_CN_PACK,
  ja: JA_PACK,
  ko: KO_PACK,
  ru: RU_PACK,
};
