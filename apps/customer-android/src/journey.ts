/**
 * HB-276 — tiện ích hành trình tìm phòng giống vé tìm phòng của web (HB-317): chọn nhanh số đêm và dòng
 * ngày (thứ + ngày) dưới ô ngày để khách luôn thấy đúng ngày đã gõ. Ngày là ngày lịch `YYYY-MM-DD`, cộng
 * ngày ở UTC trên chính ngày lịch nên không lệch múi giờ.
 */
import { dateLine } from '@pinehill/i18n';
import { currentLocale } from './i18n/locale';

export const QUICK_NIGHTS = [2, 3, 5] as const;

const CALENDAR = /^(\d{4})-(\d{2})-(\d{2})$/;
const DAY_MS = 86_400_000;

function toUtc(iso: string): number | null {
  const match = CALENDAR.exec(iso);
  if (match === null) return null;
  const at = Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  return new Date(at).getUTCDate() === Number(match[3]) ? at : null;
}

function fromUtc(at: number): string {
  return new Date(at).toISOString().slice(0, 10);
}

/** Ngày lịch hôm nay theo giờ Việt Nam (UTC+7). */
export function todayVn(nowMs: number): string {
  return fromUtc(nowMs + 7 * 3_600_000);
}

/** Một chạm: giữ ngày nhận đang chọn (hoặc hôm nay nếu chưa hợp lệ) và điền ngày trả theo số đêm. */
export function withNights(
  checkIn: string,
  nights: number,
  today: string,
): { checkIn: string; checkOut: string } {
  const start = toUtc(checkIn) === null ? today : checkIn;
  return { checkIn: start, checkOut: fromUtc((toUtc(start) ?? 0) + nights * DAY_MS) };
}

/** Số đêm hiện tại nếu trùng một nút chọn nhanh, để nút đó hiện là đang chọn. */
export function activeNights(checkIn: string, checkOut: string): number | null {
  const from = toUtc(checkIn);
  const to = toUtc(checkOut);
  if (from === null || to === null) return null;
  const nights = (to - from) / DAY_MS;
  return QUICK_NIGHTS.some((value) => value === nights) ? nights : null;
}

/** `T5, 24/12/2026` (vi) — dòng ngày dưới ô ngày; chưa phải ngày lịch hợp lệ thì `null`. */
export function stayDateLine(iso: string): string | null {
  return toUtc(iso) === null ? null : dateLine(iso, currentLocale());
}
