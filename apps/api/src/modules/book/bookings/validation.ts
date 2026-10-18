/**
 * Chuẩn hoá đầu vào tuyến BOOK của journey khách (HB-077; api.md §2.5, §3.2):
 * `POST /bookings`, `POST /bookings/{bookingId}/confirm`, `GET /bookings`, `GET /bookings/{bookingId}`.
 *
 * Hình dạng thân lệnh do `bookingCreateRequestSchema`/`bookingConfirmRequestSchema` (HB-070) chốt; ở
 * đây kiểm thêm những gì schema không kiểm được: trường **thiếu** (⇒ `400 E_BOOK_MISSING_FIELD` kèm
 * `details[].field`), ngày lịch thật, UUID và kỳ lưu trú nửa mở `[checkIn, checkOut)`.
 *
 * `quoteId` **không** hạ chuẩn thành UUID (cùng quy ước `book/holds/validation.ts` HB-076):
 * `POST /quotes` là nguồn phát hành duy nhất, nên mã lạ phải đi tới `RateQuoteService.consume` để trả
 * đúng `410 E_RATE_QUOTE_EXPIRED` (mất cache) thay vì bị chặn sớm bằng `400`.
 */
import {
  bookingConfirmRequestSchema,
  bookingCreateRequestSchema,
  bookingsQuerySchema,
} from '@pinehill/contracts';
import type { BookingsQuery, ChannelCode, RatePlanCode } from '@pinehill/contracts';
import { z } from 'zod';
import { AppError } from '../../../common/app-error.js';
import { normalizePhone } from '../../crm/guests/phone.js';
import { civilDay, isCivilDate, uuid } from '../../rate/calendar/support.js';

/** Sai kiểu/giá trị, hoặc mã tài nguyên không phải UUID ⇒ `400 E_GEN_VALIDATION_FAILED` (api.md §5). */
export const invalid = () =>
  new AppError(400, 'E_GEN_VALIDATION_FAILED', 'Yêu cầu đặt phòng không hợp lệ.');

export const unauthorized = () =>
  new AppError(401, 'E_AUTH_INVALID_CREDENTIALS', 'Chưa xác thực hoặc phiên đã kết thúc.');

export const forbidden = () =>
  new AppError(403, 'E_RBAC_FORBIDDEN', 'Bạn không có quyền thực hiện thao tác này.');

export const outOfScope = () =>
  new AppError(403, 'E_AUTH_OUT_OF_SCOPE', 'Bạn không được truy cập dữ liệu của cơ sở này.');

/** Không tồn tại, hoặc khách không sở hữu đối tượng: **không** lộ sự tồn tại tài nguyên người khác. */
export const missing = () => new AppError(404, 'E_GEN_NOT_FOUND', 'Không tìm thấy tài nguyên.');

/** BR-BOOK-06/18: trạng thái/hạn không cho phép thao tác (xác nhận khi hold hết hạn, trạng thái khác). */
export const invalidState = (message: string) => new AppError(409, 'E_BOOK_INVALID_STATE', message);

/** BR-BOOK-02: `checkIn` ở quá khứ (theo ngày nghiệp vụ) hoặc xa hơn 365 ngày. */
export const invalidDates = () =>
  new AppError(422, 'E_BOOK_INVALID_DATES', 'Ngày nhận/trả phòng không hợp lệ.');

/** BR-INV-02/07: hết phòng ở **bất kỳ** đêm nào, hoặc không đủ đơn vị cho cả kỳ. */
export const noAvailability = () =>
  new AppError(409, 'E_INV_NO_AVAILABILITY', 'Kỳ lưu trú không còn đủ phòng cho số phòng đã chọn.');

/** BR-BOOK-04: `adults + children ≤ capacityAdults × roomCount`. */
export const overCapacity = () =>
  new AppError(422, 'E_BOOK_OVER_CAPACITY', 'Số khách vượt sức chứa của loại phòng.');

/**
 * AC1/ADR-015 §3: một quote chỉ nhận vào **một** booking (`price_snapshots.quote_id` UNIQUE). Lần hai
 * — kể cả khi bản ghi quote còn trong Redis — không tạo booking mới; client phải lấy báo giá mới.
 * Catalogue chưa có mã riêng cho "quote đã tiêu thụ", nên dùng `409 E_RATE_QUOTE_MISMATCH`: cùng họ
 * lỗi của đường nhận quote (api.md §5) và cùng việc cần làm ở client ("lấy báo giá mới cho đầu vào
 * hiện tại").
 */
export const quoteAlreadyAccepted = () =>
  new AppError(409, 'E_RATE_QUOTE_MISMATCH', 'Báo giá đã được dùng cho một đặt phòng khác.');

/**
 * BR-BOOK-16: có booking trùng SĐT/kỳ/loại phòng **của người khác** ⇒ không lộ nội dung/mã của họ và
 * yêu cầu nhân viên xác minh. Trạng thái hiện có không cho phép tạo bản mới một cách tự động nên trả
 * `409 E_BOOK_INVALID_STATE` (mã 409 duy nhất của nhóm tạo booking trong catalogue api.md §5).
 */
export const duplicateUnverified = () =>
  new AppError(
    409,
    'E_BOOK_INVALID_STATE',
    'Đã có đặt phòng trùng số điện thoại/kỳ/loại phòng; cần nhân viên xác minh.',
  );

/** BR-BOOK-09: chưa ghi nhận đủ tiền phòng theo yêu cầu cọc nên chưa được xác nhận. */
export const depositNotCollected = () =>
  new AppError(
    409,
    'E_BOOK_INVALID_STATE',
    'Chưa ghi nhận đủ tiền cọc của đặt phòng này để xác nhận.',
  );

/** Trường bắt buộc của `bookingCreateRequestSchema`; thiếu ⇒ `400 E_BOOK_MISSING_FIELD` (BR-BOOK-01). */
const REQUIRED_FIELDS = [
  'propertyId',
  'roomTypeId',
  'ratePlanCode',
  'channelCode',
  'quoteId',
  'guest',
  'checkIn',
  'checkOut',
  'adults',
  'children',
  'roomCount',
] as const;

function missingField(fields: readonly string[]): AppError {
  return new AppError(
    400,
    'E_BOOK_MISSING_FIELD',
    'Thiếu thông tin bắt buộc để tạo đặt phòng.',
    undefined,
    fields.map((field) => ({ field, issue: 'required' })),
  );
}

/** Liên hệ khách trên booking; `phone` đã chuẩn hoá `+84…` (BR-CRM-01, NFR-LOC-04). */
export interface BookingGuest {
  readonly fullName: string;
  readonly phone: string;
}

/** Đầu vào đã chuẩn hoá: UUID hạ chữ thường, `childAges`/`promotionCodes` luôn là mảng. */
export interface BookingInput {
  readonly propertyId: string;
  readonly roomTypeId: string;
  readonly ratePlanCode: RatePlanCode;
  readonly channelCode: ChannelCode;
  readonly quoteId: string;
  readonly checkIn: string;
  readonly checkOut: string;
  readonly adults: number;
  readonly children: number;
  readonly childAges: readonly number[];
  readonly roomCount: number;
  readonly promotionCodes: readonly string[];
  readonly guest: BookingGuest;
  readonly note: string | null;
}

/** Trường bắt buộc phải có mặt **và** khác `null`; thiếu ⇒ `400 E_BOOK_MISSING_FIELD` (BR-BOOK-01). */
function requireFields(data: Record<string, unknown>): void {
  const absent = REQUIRED_FIELDS.filter(
    (field) => data[field] === undefined || data[field] === null,
  );
  if (absent.length > 0) throw missingField(absent);
}

/** BR-GEN-02: kỳ lưu trú là khoảng nửa mở `[checkIn, checkOut)` trên ngày lịch thật. */
function assertStayWindow(checkIn: string, checkOut: string): void {
  if (!isCivilDate(checkIn) || !isCivilDate(checkOut)) throw invalid();
  if (civilDay(checkOut) <= civilDay(checkIn)) throw invalid();
}

/**
 * Thân `POST /bookings`. Thiếu trường bắt buộc — kể cả `childAges[]` khi khai `children > 0`
 * (BR-BOOK-05, api.md §6.4) — trả `E_BOOK_MISSING_FIELD`; sai kiểu/giá trị trả
 * `E_GEN_VALIDATION_FAILED`.
 */
export function bookingInput(value: unknown): BookingInput {
  const body = z.record(z.string(), z.unknown()).safeParse(value);
  if (!body.success) throw invalid();
  requireFields(body.data);
  const parsed = bookingCreateRequestSchema.safeParse(body.data);
  if (!parsed.success) throw invalid();
  const request = parsed.data;
  if (request.children > 0 && request.childAges === undefined) throw missingField(['childAges']);
  assertStayWindow(request.checkIn, request.checkOut);
  return Object.freeze({
    propertyId: uuid(request.propertyId),
    roomTypeId: uuid(request.roomTypeId),
    ratePlanCode: request.ratePlanCode,
    channelCode: request.channelCode,
    quoteId: request.quoteId,
    checkIn: request.checkIn,
    checkOut: request.checkOut,
    adults: request.adults,
    children: request.children,
    childAges: Object.freeze([...(request.childAges ?? [])]),
    roomCount: request.roomCount,
    promotionCodes: Object.freeze([...(request.promotionCodes ?? [])]),
    // SĐT vào CSDL phải ở dạng chuẩn (ràng buộc `ck_guests_phone_normalized`), còn nhận diện khách
    // dùng chính dạng đã chuẩn hoá này (BR-CRM-01).
    guest: Object.freeze({
      fullName: request.guest.fullName,
      phone: normalizePhone(request.guest.phone),
    }),
    note: request.note ?? null,
  });
}

/** `POST /bookings/{bookingId}/confirm` — bằng chứng thu tiền của chính booking (BR-BOOK-09). */
export function confirmInput(value: unknown): { readonly paymentId: string } {
  const parsed = bookingConfirmRequestSchema.safeParse(value);
  if (!parsed.success) throw invalid();
  return Object.freeze({ paymentId: parsed.data.paymentId });
}

/** `:bookingId` là UUID; sai định dạng ⇒ `400 E_GEN_VALIDATION_FAILED`. */
export function bookingId(value: unknown): string {
  return uuid(value);
}

/**
 * `GET /bookings` — hợp đồng `bookingsQuerySchema` (HB-070). Trần `limit`, kiểu `from`/`to`/`q` và
 * tham số lạ do schema strict quyết (api.md §1.5).
 */
export function listQuery(value: unknown): BookingsQuery {
  const parsed = bookingsQuerySchema.safeParse(value);
  if (!parsed.success) throw invalid();
  return parsed.data;
}
