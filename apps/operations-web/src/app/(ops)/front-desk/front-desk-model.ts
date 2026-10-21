/**
 * SCR-48 (HB-152) — phần thuần của bàn tiền sảnh, kiểm bằng vitest.
 *
 * Ranh giới trách nhiệm:
 * - Màn hình **không** tự tính nợ, điều kiện phòng sẵn sàng, mốc 23:59 hay bậc no-show. Nút hành động luôn
 *   cho phép gửi; máy chủ là nơi quyết và màn hình chỉ hiển thị mã/lý do máy chủ trả (AC1).
 * - Phân loại đến/đi/ở là **trình bày** dữ liệu `GET /bookings` máy chủ trả, không phải luật nghiệp vụ.
 * - No-show/check-out chưa có nguồn số tiền trước xác nhận: chỉ nêu hệ quả chính sách, không bịa số.
 */
import { isApiError, type ApiError } from '@pinehill/api-client';
import type {
  BookingStatus,
  BookingSummary,
  RoomSummary,
  WalkInRequest,
} from '@pinehill/contracts';
import { addDays, businessDate } from '../../../lib/inventory-grid';

/** `YYYY-MM-DD` hợp lệ và đúng là một ngày lịch (không dựng `Date` cho ngày nghiệp vụ). */
export function validBusinessDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const at = Date.parse(`${value}T00:00:00Z`);
  return Number.isFinite(at) && new Date(at).toISOString().slice(0, 10) === value;
}

/** Ngày nghiệp vụ đang xem: `?date=` hợp lệ khi kiểm thử/đối soát, mặc định hôm nay theo giờ VN. */
export function deskDate(requested: string | null, now: Date): string {
  return requested !== null && validBusinessDate(requested) ? requested : businessDate(now);
}

export interface DeskLists {
  readonly arrivals: readonly BookingSummary[];
  readonly inHouse: readonly BookingSummary[];
  readonly departures: readonly BookingSummary[];
}

const ARRIVAL_STATUSES: readonly BookingStatus[] = ['CONFIRMED', 'PENDING_PAYMENT', 'HELD'];

const byCode = (left: BookingSummary, right: BookingSummary): number =>
  left.code.localeCompare(right.code);

/**
 * Chia dữ liệu máy chủ trả thành ba danh sách của ngày nghiệp vụ.
 * `arrivalsSource` là kết quả `GET /bookings?from=date&to=date`; `checkedInSource` là `status=CHECKED_IN`.
 */
export function splitDesk(
  arrivalsSource: readonly BookingSummary[],
  checkedInSource: readonly BookingSummary[],
  date: string,
): DeskLists {
  const inHouse = checkedInSource.filter((booking) => booking.status === 'CHECKED_IN').sort(byCode);
  const arrivals = arrivalsSource
    .filter((booking) => booking.checkIn === date && ARRIVAL_STATUSES.includes(booking.status))
    .sort(byCode);
  return {
    arrivals,
    inHouse,
    departures: inHouse.filter((booking) => booking.checkOut === date),
  };
}

export function deskEmpty(lists: DeskLists): boolean {
  return lists.arrivals.length === 0 && lists.inHouse.length === 0 && lists.departures.length === 0;
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

/**
 * Phân loại lỗi của một lệnh ghi tại quầy:
 * - 4xx nghiệp vụ rõ ràng → từ chối chắc chắn (hiện mã + lý do máy chủ trả, không đoán tiếp).
 * - 412/428 → xung đột phiên bản; 401/403 → thiếu quyền.
 * - mất mạng/hết giờ/5xx → **chưa xác định kết quả**, không hứa thất bại và không cho gửi lại mù.
 * `E_AUTH_PIN_REQUIRED` là 401 nhưng không phải thiếu quyền — cho nhập PIN lại.
 */
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
    (caught.status ?? 0) >= 500
  );
}

export function actionFailure(caught: unknown): ActionFailure {
  if (!isApiError(caught)) return { kind: 'unknownOutcome', reference: '—' };
  // 401 của lệnh 🔒 khi thiếu/hết hạn pinToken không phải thiếu quyền: cho nhập PIN lại.
  if (caught.code === 'E_AUTH_PIN_REQUIRED') return rejected(caught);
  if (caught.status === 401 || caught.status === 403) return { kind: 'forbidden' };
  if (versionConflict(caught)) return { kind: 'conflict' };
  if (unclearOutcome(caught))
    return { kind: 'unknownOutcome', reference: caught.traceId ?? caught.correlationId ?? '—' };
  return rejected(caught);
}

/** Phòng có thể gán cho booking: đúng loại phòng và đang ACTIVE; máy chủ vẫn kiểm lại sẵn sàng. */
export function roomChoices(
  rooms: readonly RoomSummary[],
  booking: Pick<BookingSummary, 'roomTypeId'>,
): readonly RoomSummary[] {
  return rooms
    .filter((room) => room.status === 'ACTIVE' && room.roomTypeId === booking.roomTypeId)
    .sort((left, right) => left.code.localeCompare(right.code));
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

export function checkInBody(
  bookingId: string,
  draft: CheckInDraft,
): {
  bookingId: string;
  actualRoomIds: string[];
  earlyCheckIn: boolean;
  idNumber?: string;
  note?: string;
} {
  return {
    bookingId,
    actualRoomIds: [...draft.roomIds],
    earlyCheckIn: draft.earlyCheckIn,
    ...(draft.idNumber.trim() === '' ? {} : { idNumber: draft.idNumber.trim() }),
    ...(draft.note.trim() === '' ? {} : { note: draft.note.trim() }),
  };
}

export interface CheckOutDraft {
  readonly earlyCheckOut: boolean;
  readonly lateCheckOut: boolean;
  readonly note: string;
}

export function checkOutBody(
  bookingId: string,
  draft: CheckOutDraft,
): {
  bookingId: string;
  earlyCheckOut: boolean;
  lateCheckOut: boolean;
  note?: string;
} {
  return {
    bookingId,
    earlyCheckOut: draft.earlyCheckOut,
    lateCheckOut: draft.lateCheckOut,
    ...(draft.note.trim() === '' ? {} : { note: draft.note.trim() }),
  };
}

export const WALK_IN_STEPS = ['stay', 'guest', 'review', 'deposit', 'done'] as const;

export type WalkInStep = (typeof WALK_IN_STEPS)[number];

/** Số bước hiển thị (1..5) — AC3 yêu cầu walk-in ≤ 5 bước. */
export function walkInStepNumber(step: WalkInStep): number {
  return WALK_IN_STEPS.indexOf(step) + 1;
}

export function nextWalkInStep(step: WalkInStep): WalkInStep {
  return WALK_IN_STEPS[Math.min(WALK_IN_STEPS.indexOf(step) + 1, WALK_IN_STEPS.length - 1)]!;
}

export function previousWalkInStep(step: WalkInStep): WalkInStep {
  return WALK_IN_STEPS[Math.max(WALK_IN_STEPS.indexOf(step) - 1, 0)]!;
}

export interface WalkInStay {
  propertyId: string;
  roomTypeId: string;
  ratePlanCode: WalkInRequest['ratePlanCode'];
  checkIn: string;
  checkOut: string;
  adults: string;
  children: string;
  roomCount: string;
}

export interface WalkInGuest {
  fullName: string;
  phone: string;
}

export function walkInDefaults(propertyId: string, date: string): WalkInStay {
  return {
    propertyId,
    roomTypeId: '',
    ratePlanCode: 'FLEX7',
    checkIn: date,
    checkOut: addDays(date, 1),
    adults: '2',
    children: '0',
    roomCount: '1',
  };
}

function wholeInRange(value: string, min: number, max: number): number | null {
  if (!/^\d+$/.test(value.trim())) return null;
  const parsed = Number.parseInt(value, 10);
  return Number.isSafeInteger(parsed) && parsed >= min && parsed <= max ? parsed : null;
}

export type StayIssue = 'PROPERTY' | 'ROOM_TYPE' | 'DATES' | 'COUNTS';

/** Kiểm tra biểu mẫu bước 1 (không phải kiểm tồn/giá — máy chủ quyết). */
export function stayIssue(stay: WalkInStay): StayIssue | null {
  if (stay.propertyId === '') return 'PROPERTY';
  if (stay.roomTypeId === '') return 'ROOM_TYPE';
  if (!validBusinessDate(stay.checkIn) || !validBusinessDate(stay.checkOut)) return 'DATES';
  if (Date.parse(`${stay.checkOut}T00:00:00Z`) <= Date.parse(`${stay.checkIn}T00:00:00Z`))
    return 'DATES';
  if (
    wholeInRange(stay.adults, 1, 20) === null ||
    wholeInRange(stay.children, 0, 20) === null ||
    wholeInRange(stay.roomCount, 1, 10) === null
  )
    return 'COUNTS';
  return null;
}

export interface StepChecks {
  readonly stay: StayIssue | null;
  readonly guest: GuestIssue | null;
}

/** Kiểm biểu mẫu của bước hiện tại; bước xác nhận không có lỗi nhập. */
export function stepChecks(step: WalkInStep, stay: WalkInStay, guest: WalkInGuest): StepChecks {
  return {
    stay: step === 'stay' ? stayIssue(stay) : null,
    guest: step === 'guest' ? guestIssue(guest) : null,
  };
}

export type GuestIssue = 'NAME' | 'PHONE';

export function guestIssue(guest: WalkInGuest): GuestIssue | null {
  if (guest.fullName.trim() === '' || guest.fullName.trim().length > 120) return 'NAME';
  if (!/^(?:\+84|0)\d{9}$/.test(guest.phone.trim())) return 'PHONE';
  return null;
}

/** Tiền cọc là số nguyên VND dương; máy chủ vẫn đối chiếu đúng số cọc của booking. */
export function amountIssue(value: string): 'FORMAT' | null {
  const parsed = wholeInRange(value, 1, Number.MAX_SAFE_INTEGER);
  return parsed === null ? 'FORMAT' : null;
}

/** Dựng đúng `walkInRequestSchema`: không có `channelCode` (kênh do cấu hình máy chủ quyết). */
export function toWalkInRequest(stay: WalkInStay, guest: WalkInGuest, note: string): WalkInRequest {
  const adults = wholeInRange(stay.adults, 1, 20);
  const children = wholeInRange(stay.children, 0, 20);
  const roomCount = wholeInRange(stay.roomCount, 1, 10);
  if (adults === null || children === null || roomCount === null)
    throw new RangeError('Invalid walk-in stay counts');
  return {
    propertyId: stay.propertyId,
    roomTypeId: stay.roomTypeId,
    ratePlanCode: stay.ratePlanCode,
    checkIn: stay.checkIn,
    checkOut: stay.checkOut,
    adults,
    children,
    roomCount,
    guest: { fullName: guest.fullName.trim(), phone: guest.phone.trim() },
    ...(note.trim() === '' ? {} : { note: note.trim() }),
  };
}
