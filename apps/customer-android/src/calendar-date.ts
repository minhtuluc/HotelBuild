/**
 * Ngày **lịch** (date-only) của API hiển thị theo ngôn ngữ đang chọn (HB-275, `@pinehill/i18n`): tiếng Việt
 * `dd/MM/yyyy` hoán vị thuần chuỗi; ngôn ngữ khác dùng `Intl` ở UTC trên chính ngày lịch nên không lệch ngày.
 * Chuỗi không phải ngày lịch trả nguyên văn.
 */
import { calendarDate } from '@pinehill/i18n';
import { currentLocale } from './i18n/locale';

export function calendarDateLabel(value: string): string {
  return calendarDate(value, currentLocale());
}
