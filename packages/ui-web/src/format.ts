/**
 * Định dạng hiển thị ở biên giao diện — §7.4 và NFR-LOC-01…NFR-LOC-04.
 * Lưu UTC, hiển thị giờ Việt Nam; tiền là số nguyên VND; không dùng số thực cho tiền.
 */

const LOCALE = 'vi-VN';
const TIME_ZONE = 'Asia/Ho_Chi_Minh';

const moneyFormatter = new Intl.NumberFormat(LOCALE, {
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
});

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

/** `1.222.000 ₫` — số nguyên VND, phân cách nghìn bằng dấu chấm. */
export function formatMoney(amountVnd: number): string {
  if (!Number.isInteger(amountVnd)) throw new RangeError('Tiền phải là số nguyên VND (BR-GEN-01).');
  return `${moneyFormatter.format(amountVnd)} ₫`;
}

/**
 * `12/11/2026 14:00 (giờ VN)`.
 * Thứ tự ngày/tháng/năm rồi giờ:phút được dựng tường minh vì `Intl` của `vi-VN` xếp giờ trước ngày.
 */
export function formatDateTimeVn(isoUtc: string): string {
  const at = new Date(isoUtc);
  if (Number.isNaN(at.getTime())) throw new RangeError(`Mốc thời gian không hợp lệ: ${isoUtc}`);
  const parts = dateTimeFormatter.formatToParts(at);
  const date = `${partValue(parts, 'day')}/${partValue(parts, 'month')}/${partValue(parts, 'year')}`;
  return `${date} ${partValue(parts, 'hour')}:${partValue(parts, 'minute')} (giờ VN)`;
}

/** `3 đêm · 2 người lớn · 0 trẻ em` */
export function formatStayPeriod(nights: number, adults: number, children: number): string {
  return `${nights} đêm · ${adults} người lớn · ${children} trẻ em`;
}

/** `còn 6 giờ 12 phút` · dưới 1 giờ: `còn 47 phút`. Hết hạn trả `null` để màn hình chọn câu chữ. */
export function formatRemaining(msRemaining: number): string | null {
  if (msRemaining <= 0) return null;
  const totalMinutes = Math.floor(msRemaining / 60_000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return hours >= 1 ? `còn ${hours} giờ ${minutes} phút` : `còn ${minutes} phút`;
}

/** `0,85` — hai chữ số thập phân, dấu phẩy (BR-RATE-17). */
export function formatMultiplier(value: number): string {
  return new Intl.NumberFormat(LOCALE, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}

const BOOKING_CODE_PATTERN = /^PH-\d{6}-[A-Z0-9]{5}$/;

/** Mã booking đúng định dạng BR-GEN-06; hiển thị monospace ở tầng giao diện. */
export function isBookingCode(value: string): boolean {
  return BOOKING_CODE_PATTERN.test(value);
}

/**
 * `Đã xác nhận (CONFIRMED)` — nhãn tiếng Việt kèm mã enum cho người dùng nội bộ;
 * nhãn lấy từ danh mục i18n chứ không viết cứng trong component (NFR-LOC-01).
 */
export function formatStatusWithEnum(label: string, enumCode: string): string {
  return `${label} (${enumCode})`;
}
