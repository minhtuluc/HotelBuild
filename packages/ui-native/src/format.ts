/**
 * Định dạng hiển thị trên Android — cùng quy tắc với web (§7.4, NFR-LOC-02):
 * thứ tự `dd/MM/yyyy HH:mm` dựng tường minh vì `Intl` của `vi-VN` xếp giờ trước ngày.
 */

const LOCALE = 'vi-VN';
const TIME_ZONE = 'Asia/Ho_Chi_Minh';

const dateTimeFormatter = new Intl.DateTimeFormat(LOCALE, {
  timeZone: TIME_ZONE,
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
  hourCycle: 'h23',
});

function partValue(parts: Intl.DateTimeFormatPart[], type: Intl.DateTimeFormatPartTypes): string {
  return parts.find((part) => part.type === type)?.value ?? '';
}

/** `12/11/2026 14:00 (giờ VN)` — mọi mốc thời gian đều kèm nhãn giờ VN. */
export function formatDateTimeVn(isoUtc: string): string {
  const at = new Date(isoUtc);
  if (Number.isNaN(at.getTime())) throw new RangeError(`Mốc thời gian không hợp lệ: ${isoUtc}`);
  const parts = dateTimeFormatter.formatToParts(at);
  const date = `${partValue(parts, 'day')}/${partValue(parts, 'month')}/${partValue(parts, 'year')}`;
  return `${date} ${partValue(parts, 'hour')}:${partValue(parts, 'minute')} (giờ VN)`;
}
