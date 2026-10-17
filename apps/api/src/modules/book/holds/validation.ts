/**
 * Chuẩn hoá đầu vào `POST /holds` + `DELETE /holds/{holdId}` (HB-076; api.md §2.5, §3.4).
 *
 * Hình dạng thân lệnh do `holdCreateRequestSchema` (HB-070) chốt; ở đây kiểm thêm những gì schema
 * không kiểm được: trường **thiếu** (⇒ `400 E_BOOK_MISSING_FIELD` kèm `details[].field`), ngày lịch
 * thật, UUID và kỳ lưu trú nửa mở `[checkIn, checkOut)`. Trường lạ là **lệnh hỏng** (schema strict).
 *
 * `quoteId` **không** hạ chuẩn thành UUID: hợp đồng chỉ đòi chuỗi khác rỗng, và `POST /quotes` là nguồn
 * phát hành duy nhất — mã lạ phải đi tới `RateQuoteService.consume` để trả `410 E_RATE_QUOTE_EXPIRED`
 * (mất cache) như journey giả đang chạy, không bị chặn sớm bằng `400`.
 */
import { holdCreateRequestSchema, holdReleaseQuerySchema } from '@pinehill/contracts';
import type { HoldCreateRequest } from '@pinehill/contracts';
import { z } from 'zod';
import { AppError } from '../../../common/app-error.js';
import { civilDay, isCivilDate, uuid } from '../../rate/calendar/support.js';

/** Sai kiểu/giá trị, hoặc mã tài nguyên không phải UUID ⇒ `400 E_GEN_VALIDATION_FAILED` (api.md §5). */
export const invalid = () =>
  new AppError(400, 'E_GEN_VALIDATION_FAILED', 'Yêu cầu giữ chỗ không hợp lệ.');

export const unauthorized = () =>
  new AppError(401, 'E_AUTH_INVALID_CREDENTIALS', 'Chưa xác thực hoặc phiên đã kết thúc.');

export const forbidden = () =>
  new AppError(403, 'E_RBAC_FORBIDDEN', 'Bạn không có quyền thực hiện thao tác này.');

export const outOfScope = () =>
  new AppError(403, 'E_AUTH_OUT_OF_SCOPE', 'Bạn không được truy cập dữ liệu của cơ sở này.');

export const missing = () => new AppError(404, 'E_GEN_NOT_FOUND', 'Không tìm thấy tài nguyên.');

/** Trạng thái không cho phép giữ/giải phóng: kênh `holdMinutes = 0`, hold hết hạn, hold đã kết thúc. */
export const invalidState = (message: string) => new AppError(409, 'E_BOOK_INVALID_STATE', message);

/** BR-INV-02/07: hết phòng ở **bất kỳ** đêm nào, hoặc không đủ đơn vị cho cả kỳ. */
export const noAvailability = () =>
  new AppError(409, 'E_INV_NO_AVAILABILITY', 'Kỳ lưu trú không còn đủ phòng cho số phòng đã chọn.');

/** BR-BOOK-04: `adults + children ≤ capacityAdults × roomCount`. */
export const overCapacity = () =>
  new AppError(422, 'E_BOOK_OVER_CAPACITY', 'Số khách vượt sức chứa của loại phòng.');

/** Trường bắt buộc của `holdCreateRequestSchema`; thiếu ⇒ `400 E_BOOK_MISSING_FIELD` (BR-BOOK-01). */
const REQUIRED_FIELDS = [
  'propertyId',
  'roomTypeId',
  'channelCode',
  'checkIn',
  'checkOut',
  'adults',
  'children',
  'roomCount',
  'quoteId',
] as const;

function missingField(fields: readonly string[]): AppError {
  return new AppError(
    400,
    'E_BOOK_MISSING_FIELD',
    'Thiếu thông tin bắt buộc để giữ chỗ.',
    undefined,
    fields.map((field) => ({ field, issue: 'required' })),
  );
}

/** Đầu vào đã chuẩn hoá: UUID hạ chữ thường, `childAges` luôn là mảng (BR-BOOK-05). */
export interface HoldInput {
  readonly propertyId: string;
  readonly roomTypeId: string;
  readonly channelCode: HoldCreateRequest['channelCode'];
  readonly checkIn: string;
  readonly checkOut: string;
  readonly adults: number;
  readonly children: number;
  readonly childAges: readonly number[];
  readonly roomCount: number;
  readonly quoteId: string;
}

/**
 * Thân `POST /holds`. Thiếu trường bắt buộc — kể cả `childAges[]` khi khai `children > 0`
 * (BR-BOOK-05, api.md §6.4) — trả `E_BOOK_MISSING_FIELD`; sai kiểu/giá trị trả
 * `E_GEN_VALIDATION_FAILED`.
 */
export function holdInput(value: unknown): HoldInput {
  const body = z.record(z.string(), z.unknown()).safeParse(value);
  if (!body.success) throw invalid();
  const absent = REQUIRED_FIELDS.filter((field) => body.data[field] === undefined);
  if (absent.length > 0) throw missingField(absent);
  const parsed = holdCreateRequestSchema.safeParse(body.data);
  if (!parsed.success) throw invalid();
  const request = parsed.data;
  if (request.children > 0 && request.childAges === undefined) throw missingField(['childAges']);
  if (!isCivilDate(request.checkIn) || !isCivilDate(request.checkOut)) throw invalid();
  if (civilDay(request.checkOut) <= civilDay(request.checkIn)) throw invalid();
  return Object.freeze({
    propertyId: uuid(request.propertyId),
    roomTypeId: uuid(request.roomTypeId),
    channelCode: request.channelCode,
    checkIn: request.checkIn,
    checkOut: request.checkOut,
    adults: request.adults,
    children: request.children,
    childAges: Object.freeze([...(request.childAges ?? [])]),
    roomCount: request.roomCount,
    quoteId: request.quoteId,
  });
}

/** `?reason=` bắt buộc khi giải phóng hold (api.md §2.5, BR-INV-04). */
export function releaseReason(query: unknown): string {
  const parsed = holdReleaseQuerySchema.safeParse(query);
  if (!parsed.success) throw invalid();
  return parsed.data.reason;
}
