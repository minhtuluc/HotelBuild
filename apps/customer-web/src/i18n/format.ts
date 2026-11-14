/**
 * Định dạng theo locale cho Customer Web (kế hoạch đa ngôn ngữ §4).
 *
 * Ngày nhận/trả là **ngày lịch** `yyyy-mm-dd`: không kéo múi giờ máy vào (NFR-LOC-02). Với `vi` đầu ra giữ
 * nguyên như trước HB-309 (`dd/MM/yyyy`, thứ `CN`/`T2`…), dựng bằng chuỗi; locale khác dùng `Intl` ở múi
 * giờ UTC trên chính ngày lịch đó nên cũng không lệch ngày.
 */
import { formatMoney } from '@pinehill/ui-web';
import { LOCALE_META, type Locale } from './locales';

const CALENDAR_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const VI_WEEKDAYS = ['CN', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7'] as const;

interface CalendarParts {
  readonly year: string;
  readonly month: string;
  readonly day: string;
  readonly utc: Date;
}

function calendarParts(iso: string): CalendarParts | null {
  const match = CALENDAR_DATE.exec(iso);
  if (match === null) return null;
  const [, year = '', month = '', day = ''] = match;
  const utc = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));
  if (Number.isNaN(utc.getTime()) || utc.getUTCDate() !== Number(day)) return null;
  return { year, month, day, utc };
}

function intlDate(locale: Locale, options: Intl.DateTimeFormatOptions, at: Date): string {
  return new Intl.DateTimeFormat(LOCALE_META[locale].intl, { timeZone: 'UTC', ...options }).format(
    at,
  );
}

/** Tiền VND theo dấu phân cách của locale. */
export function money(amountVnd: number, locale: Locale): string {
  return formatMoney(amountVnd, LOCALE_META[locale].intl);
}

/** `2026-10-12` → `12/10/2026` (vi). Chuỗi không phải ngày lịch thì trả nguyên văn để lộ dữ liệu lạ. */
export function calendarDate(iso: string, locale: Locale): string {
  if (locale === 'vi') {
    const match = CALENDAR_DATE.exec(iso);
    return match === null ? iso : `${match[3]}/${match[2]}/${match[1]}`;
  }
  const parts = calendarParts(iso);
  if (parts === null) return iso;
  return intlDate(locale, { day: '2-digit', month: '2-digit', year: 'numeric' }, parts.utc);
}

/** Nhãn thứ ngắn in trên tem đêm: `CN`, `T2`… (vi). */
export function weekdayShort(iso: string, locale: Locale): string | null {
  const parts = calendarParts(iso);
  if (parts === null) return null;
  if (locale === 'vi') return VI_WEEKDAYS[parts.utc.getUTCDay()] ?? '';
  return intlDate(locale, { weekday: 'short' }, parts.utc);
}

/** `24/12` (vi) — ngày/tháng in trên tem đêm. */
export function dayMonth(iso: string, locale: Locale): string | null {
  const parts = calendarParts(iso);
  if (parts === null) return null;
  if (locale === 'vi') return `${parts.day}/${parts.month}`;
  return intlDate(locale, { day: '2-digit', month: '2-digit' }, parts.utc);
}

/**
 * `T5, 24/12/2026` (vi) — dòng ngày đầy đủ in dưới ô `<input type="date">` để khách luôn thấy đúng ngày
 * đã chọn, dù trình duyệt hiển thị ô theo `mm/dd/yyyy`. Chuỗi rỗng / không hợp lệ trả `null`.
 */
export function dateLine(iso: string, locale: Locale): string | null {
  const weekday = weekdayShort(iso, locale);
  if (weekday === null) return null;
  return `${weekday}, ${calendarDate(iso, locale)}`;
}
