/**
 * SCR-57/58 (HB-153) — phần thuần của danh sách khách đến và check-in, kiểm bằng vitest.
 *
 * Ranh giới (ADR-018): màn hình **không** tự tính nợ, ngưỡng duyệt nợ, mốc 08:00/14:00/23:59 hay độ sẵn
 * sàng của phòng. Danh sách đến là **trình bày** dữ liệu `GET /bookings` máy chủ trả; nút xác nhận luôn
 * gửi được và máy chủ (engine HB-141) là nơi quyết, màn hình chỉ hiển thị mã/lý do máy chủ trả.
 */
import { isApiError, type ApiError } from '@pinehill/api-client';
import type { BookingStatus, BookingSummary, RoomSummary } from '@pinehill/contracts';

/** Trạng thái được liệt kê là "đến hôm nay"; có bước check-in hay không là việc của máy chủ. */
const ARRIVAL_STATUSES: readonly BookingStatus[] = ['CONFIRMED', 'PENDING_PAYMENT', 'HELD'];

const byCode = (left: BookingSummary, right: BookingSummary): number =>
  left.code.localeCompare(right.code);

/** Khách đến của ngày nghiệp vụ trong kết quả `GET /bookings?from=date&to=date`. */
export function arrivalsOf(source: readonly BookingSummary[], date: string): BookingSummary[] {
  return source
    .filter((booking) => booking.checkIn === date && ARRIVAL_STATUSES.includes(booking.status))
    .sort(byCode);
}

const squeeze = (value: string): string => value.replaceAll(/[\s-]/g, '').toUpperCase();

/** Lọc cục bộ theo mảnh mã booking (bỏ dấu gạch/khoảng trắng, không phân biệt hoa thường). */
export function filterArrivals(
  rows: readonly BookingSummary[],
  term: string,
): readonly BookingSummary[] {
  const needle = squeeze(term);
  if (needle === '') return rows;
  return rows.filter((booking) => squeeze(booking.code).includes(needle));
}

const SCAN_LIMIT = 2048;
const SCAN_CODE = /PH-\d{6}-[A-Z0-9]{1,8}/i;

/**
 * Mã booking trong nội dung QR: chấp nhận mã trần hoặc URL/chuỗi có chứa mã dạng `PH-YYMMDD-XXXXX`.
 * Định dạng nội dung QR chưa được đặc tả ở docs; phần này chỉ trích mã, việc khớp booking do danh sách
 * máy chủ trả quyết định.
 */
export function parseBookingCodeFromScan(payload: string): string | null {
  if (payload.length === 0 || payload.length > SCAN_LIMIT) return null;
  const match = SCAN_CODE.exec(payload);
  return match === null ? null : match[0].toUpperCase();
}

/** Phòng có thể gán: ACTIVE, cùng cơ sở và loại phòng với booking; máy chủ vẫn kiểm sẵn sàng. */
export function roomChoices(
  rooms: readonly RoomSummary[],
  booking: Pick<BookingSummary, 'propertyId' | 'roomTypeId'>,
): readonly RoomSummary[] {
  return rooms
    .filter(
      (room) =>
        room.status === 'ACTIVE' &&
        room.propertyId === booking.propertyId &&
        room.roomTypeId === booking.roomTypeId,
    )
    .sort((left, right) => left.code.localeCompare(right.code));
}

/**
 * Gợi ý chọn sẵn `roomCount` phòng đầu theo mã để check-in một phòng đủ ≤ 3 chạm (mở thẻ → xác nhận).
 * Đây chỉ là giá trị khởi tạo của biểu mẫu: lễ tân đổi được, và máy chủ từ chối nếu phòng chưa sẵn sàng.
 */
export function suggestRooms(
  choices: readonly RoomSummary[],
  booking: Pick<BookingSummary, 'roomCount'>,
): string[] {
  return choices.slice(0, booking.roomCount).map((room) => room.id);
}

export type RoomIssue = 'COUNT' | 'TYPE';

/** Lỗi biểu mẫu khi chọn phòng; không thay cho kiểm tra giao phòng của máy chủ. */
export function roomSelectionIssue(
  selected: readonly string[],
  booking: Pick<BookingSummary, 'roomCount'>,
  choices: readonly RoomSummary[],
): RoomIssue | null {
  const allowed = new Set(choices.map((room) => room.id));
  if (new Set(selected).size !== selected.length) return 'TYPE';
  if (selected.some((id) => !allowed.has(id))) return 'TYPE';
  return selected.length === booking.roomCount ? null : 'COUNT';
}

export interface CheckInDraft {
  readonly roomIds: readonly string[];
  readonly earlyCheckIn: boolean;
  readonly idNumber: string;
  readonly note: string;
}

export interface CheckInBody {
  bookingId: string;
  actualRoomIds: string[];
  earlyCheckIn: boolean;
  idNumber?: string;
  note?: string;
}

export function checkInBody(bookingId: string, draft: CheckInDraft): CheckInBody {
  const idNumber = draft.idNumber.trim();
  const note = draft.note.trim();
  return {
    bookingId,
    actualRoomIds: [...draft.roomIds],
    earlyCheckIn: draft.earlyCheckIn,
    ...(idNumber === '' ? {} : { idNumber }),
    ...(note === '' ? {} : { note }),
  };
}

export type ActionFailure =
  | {
      readonly kind: 'rejected';
      readonly code: string;
      readonly status: number | null;
      readonly reason: string;
    }
  | { readonly kind: 'conflict' }
  | { readonly kind: 'forbidden' }
  | { readonly kind: 'unknownOutcome'; readonly reference: string };

const CONFLICT_CODES: readonly string[] = [
  'E_GEN_VERSION_CONFLICT',
  'E_GEN_PRECONDITION_REQUIRED',
  'E_SYS_IDEMPOTENCY_KEY_REUSED',
];

function rejected(caught: ApiError): ActionFailure {
  return {
    kind: 'rejected',
    code: caught.code ?? String(caught.status ?? 'UNKNOWN'),
    status: caught.status ?? null,
    reason: caught.message,
  };
}

function versionConflict(caught: ApiError): boolean {
  return (
    caught.status === 412 ||
    caught.status === 428 ||
    (caught.code !== undefined && CONFLICT_CODES.includes(caught.code))
  );
}

function unclearOutcome(caught: ApiError): boolean {
  return (
    caught.kind === 'network' ||
    caught.kind === 'timeout' ||
    caught.kind === 'protocol' ||
    caught.kind === 'aborted' ||
    (caught.status ?? 0) >= 500
  );
}

/**
 * Phân loại lỗi của lệnh ghi (design §8.1): 4xx nghiệp vụ rõ ràng → từ chối chắc chắn; 412/428 và khoá
 * idempotency tái dùng → xung đột; 401/403 → thiếu quyền; mất mạng/hết giờ/5xx → **chưa xác định kết quả**
 * (không hứa thất bại, thử lại bằng cùng khoá).
 */
export function actionFailure(caught: unknown): ActionFailure {
  if (!isApiError(caught)) return { kind: 'unknownOutcome', reference: '—' };
  if (caught.status === 401 || caught.status === 403) return { kind: 'forbidden' };
  if (versionConflict(caught)) return { kind: 'conflict' };
  if (unclearOutcome(caught))
    return { kind: 'unknownOutcome', reference: caught.traceId ?? caught.correlationId ?? '—' };
  return rejected(caught);
}
