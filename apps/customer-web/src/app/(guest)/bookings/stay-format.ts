/**
 * Định dạng kỳ lưu trú dùng chung cho các màn đơn của khách (SCR-09…SCR-12).
 *
 * Ngày nhận/trả là **ngày lịch** (`yyyy-mm-dd`): định dạng theo locale ở `i18n/format.ts`, không kéo múi giờ
 * máy vào (NFR-LOC-02). Câu chữ lấy từ danh mục của locale đang dùng, không viết cứng.
 */
import { calendarDate } from '../../../i18n/format';
import type { Translators } from '../../../i18n/translate';

/** `12/10/2026 → 15/10/2026 · 3 đêm` — kỳ mới của SCR-12. */
export function formatStayNights(
  text: Translators,
  checkIn: string,
  checkOut: string,
  nights: number,
): string {
  return text.t('guest.booking.stay.range', {
    from: calendarDate(checkIn, text.locale),
    to: calendarDate(checkOut, text.locale),
    nights,
  });
}

/** `12/10/2026 → 15/10/2026 · 3 đêm · 2 người lớn · 0 trẻ em` — kỳ đang giữ/kết quả. */
export function formatStaySpan(
  text: Translators,
  checkIn: string,
  checkOut: string,
  stay: string,
): string {
  return text.t('guest.booking.stay.summary', {
    from: calendarDate(checkIn, text.locale),
    to: calendarDate(checkOut, text.locale),
    stay,
  });
}
