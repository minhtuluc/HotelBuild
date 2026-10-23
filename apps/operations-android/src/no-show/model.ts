/**
 * SCR-64 (HB-155) — phần thuần của ghi no-show, kiểm bằng vitest.
 *
 * Ranh giới (ADR-018): màn hình **không** tính phụ thu đêm đầu, bậc huỷ hay quyết định "đã tới mốc". Số đếm
 * ngược chỉ là **hiển thị** theo giờ Việt Nam; máy chủ so mốc 23:59 theo múi giờ cơ sở và từ chối bằng
 * `E_BOOK_INVALID_STATE` nếu chưa tới (BR-CANCEL-10, BR-FO-02). Mốc và số tiền hiển thị lấy từ số xem
 * trước của máy chủ (HB-209), không tính ở đây.
 */
import type { NoShowRequest } from '@pinehill/contracts';

export const REASON_MAX = 500;

export type NoShowBody = NoShowRequest;

export type ReasonIssue = 'EMPTY' | 'TOO_LONG';

/** Lỗi biểu mẫu của lý do (hợp đồng: 1–500 ký tự sau khi bỏ khoảng trắng hai đầu). */
export function reasonIssue(raw: string): ReasonIssue | null {
  const reason = raw.trim();
  if (reason === '') return 'EMPTY';
  return reason.length > REASON_MAX ? 'TOO_LONG' : null;
}

export function noShowBody(bookingId: string, reason: string): NoShowBody {
  return { bookingId, reason: reason.trim() };
}

export type Countdown =
  | { readonly kind: 'counting'; readonly remainingMs: number }
  | { readonly kind: 'reached' }
  | { readonly kind: 'unknown' };

/**
 * Đếm ngược tới **mốc máy chủ trả** (`markableFrom` của số xem trước): máy khách không tự dựng mốc 23:59
 * (ADR-018). Chưa có mốc (đang tải, lỗi, offline) thì `unknown` — không bịa hạn. Từ đúng mốc trở đi là
 * "đã tới" (bao gồm mốc, BR-FO-02); máy chủ vẫn là nơi quyết định khi ghi.
 */
export function countdownToMark(markableFrom: string | null, nowMs: number): Countdown {
  const mark = markableFrom === null ? Number.NaN : Date.parse(markableFrom);
  if (!Number.isFinite(mark)) return { kind: 'unknown' };
  return nowMs >= mark ? { kind: 'reached' } : { kind: 'counting', remainingMs: mark - nowMs };
}

const two = (value: number): string => String(value).padStart(2, '0');

/** `HH:mm:ss`, làm tròn lên giây; số giờ không bị chặn ở 24. */
export function formatCountdown(remainingMs: number): string {
  const seconds = Math.max(0, Math.ceil(remainingMs / 1000));
  return `${two(Math.floor(seconds / 3600))}:${two(Math.floor((seconds % 3600) / 60))}:${two(seconds % 60)}`;
}
