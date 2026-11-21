/**
 * HB-275 — khớp ngôn ngữ của máy (thẻ BCP 47 như `zh-Hans-CN`) về locale có hỗ trợ. Lần đầu mở app khách
 * dùng hàm này; khách đổi ở tab Tài khoản thì lựa chọn được lưu và thắng ngôn ngữ máy.
 * Tiếng Trung phồn thể (`zh-Hant`, `zh-TW`, `zh-HK`) chưa có bản dịch nên về tiếng Việt, không ép sang giản thể.
 */
import { DEFAULT_LOCALE, type Locale } from './locales';

const TRADITIONAL = /^zh-(hant|tw|hk|mo)\b/i;

export function matchLocale(tag: string | undefined): Locale {
  if (tag === undefined || tag === '') return DEFAULT_LOCALE;
  const lower = tag.toLowerCase();
  if (lower.startsWith('zh')) return TRADITIONAL.test(lower) ? DEFAULT_LOCALE : 'zh-CN';
  const language = lower.split(/[-_]/)[0];
  switch (language) {
    case 'vi':
    case 'en':
    case 'ja':
    case 'ko':
    case 'ru':
      return language;
    default:
      return DEFAULT_LOCALE;
  }
}
