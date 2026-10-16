/**
 * Định dạng kỳ lưu trú dùng chung cho các màn đơn của khách (SCR-09…SCR-12).
 *
 * Ngày nhận/trả là **ngày lịch** (`yyyy-mm-dd`) nên chỉ cắt chuỗi thành `dd/MM/yyyy` — không dựng `Date`
 * và không kéo múi giờ máy vào (NFR-LOC-02). Câu chữ nằm trong danh mục `lib/i18n.ts`, không viết cứng.
 */
import { t } from '../../../lib/i18n';

const CALENDAR_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** `2026-10-12` → `12/10/2026`; chuỗi không đúng dạng ngày lịch thì trả nguyên văn để lộ dữ liệu lạ. */
export function formatCalendarDate(isoDate: string): string {
  const match = CALENDAR_DATE.exec(isoDate);
  return match === null ? isoDate : `${match[3]}/${match[2]}/${match[1]}`;
}

/** `12/10/2026 → 15/10/2026 · 3 đêm` — kỳ mới của SCR-12. */
export function formatStayNights(checkIn: string, checkOut: string, nights: number): string {
  return t('guest.booking.stay.range', {
    from: formatCalendarDate(checkIn),
    to: formatCalendarDate(checkOut),
    nights,
  });
}

/** `12/10/2026 → 15/10/2026 · 3 đêm · 2 người lớn · 0 trẻ em` — kỳ đang giữ/kết quả. */
export function formatStaySpan(checkIn: string, checkOut: string, stay: string): string {
  return t('guest.booking.stay.summary', {
    from: formatCalendarDate(checkIn),
    to: formatCalendarDate(checkOut),
    stay,
  });
}
