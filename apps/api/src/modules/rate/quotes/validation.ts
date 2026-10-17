/**
 * Chuẩn hoá đầu vào báo giá (HB-074). Hình dạng do `quoteRequestSchema` (HB-070) chốt; ở đây kiểm
 * thêm những gì schema không kiểm được: trường **thiếu**, ngày lịch thật, UUID, `checkOut` sau
 * `checkIn` (BR-GEN-02: kỳ lưu trú là khoảng nửa mở) và tuổi trẻ em (BR-BOOK-05).
 */
import { quoteRequestSchema } from '@pinehill/contracts';
import type { QuoteRequest } from '@pinehill/contracts';
import { z } from 'zod';
import { AppError } from '../../../common/app-error.js';
import { civilDay, isCivilDate, uuid } from '../calendar/support.js';

/** Sai kiểu/giá trị ⇒ `400 E_GEN_VALIDATION_FAILED` (api.md §5). */
export const invalid = () =>
  new AppError(400, 'E_GEN_VALIDATION_FAILED', 'Yêu cầu báo giá không hợp lệ.');

/** Trường bắt buộc của `quoteRequestSchema` — thiếu ⇒ `400 E_BOOK_MISSING_FIELD` (api.md §5, BR-BOOK-01). */
const REQUIRED_FIELDS = [
  'propertyId',
  'roomTypeId',
  'channelCode',
  'ratePlanCode',
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
    'Thiếu thông tin bắt buộc để báo giá.',
    undefined,
    fields.map((field) => ({ field, issue: 'required' })),
  );
}

/** Đầu vào đã chuẩn hoá: UUID hạ chữ thường, `childAges`/`promotionCodes` luôn là mảng. */
export interface QuoteInput {
  readonly propertyId: string;
  readonly roomTypeId: string;
  readonly channelCode: QuoteRequest['channelCode'];
  readonly ratePlanCode: QuoteRequest['ratePlanCode'];
  readonly checkIn: string;
  readonly checkOut: string;
  readonly adults: number;
  readonly children: number;
  readonly childAges: readonly number[];
  readonly roomCount: number;
  readonly promotionCodes: readonly string[];
}

function fromRequest(request: QuoteRequest): QuoteInput {
  if (!isCivilDate(request.checkIn) || !isCivilDate(request.checkOut)) throw invalid();
  if (civilDay(request.checkOut) <= civilDay(request.checkIn)) throw invalid();
  return Object.freeze({
    propertyId: uuid(request.propertyId),
    roomTypeId: uuid(request.roomTypeId),
    channelCode: request.channelCode,
    ratePlanCode: request.ratePlanCode,
    checkIn: request.checkIn,
    checkOut: request.checkOut,
    adults: request.adults,
    children: request.children,
    childAges: Object.freeze([...(request.childAges ?? [])]),
    roomCount: request.roomCount,
    promotionCodes: Object.freeze([...(request.promotionCodes ?? [])]),
  });
}

/**
 * Thân `POST /quotes`: schema **strict** (trường lạ là lệnh hỏng). Thiếu trường bắt buộc — kể cả
 * `childAges[]` khi khai `children > 0` (BR-BOOK-05, api.md §6.4: "thiếu tuổi phải yêu cầu bổ sung")
 * — trả `E_BOOK_MISSING_FIELD` kèm `details[].field`, khác với sai kiểu/giá trị trả
 * `E_GEN_VALIDATION_FAILED`.
 */
export function quoteInput(value: unknown): QuoteInput {
  const body = z.record(z.string(), z.unknown()).safeParse(value);
  if (!body.success) throw invalid();
  const missing = REQUIRED_FIELDS.filter((field) => body.data[field] === undefined);
  if (missing.length > 0) throw missingField(missing);
  const parsed = quoteRequestSchema.safeParse(body.data);
  if (!parsed.success) throw invalid();
  const request = parsed.data;
  if (request.children > 0 && request.childAges === undefined) throw missingField(['childAges']);
  return fromRequest(request);
}

/**
 * Hai trường của `POST /quotes` mà **thân lệnh giữ/đặt chỗ không khai**: `holdCreateRequestSchema` là
 * `strictObject` chỉ có các trường của kỳ lưu trú + `quoteId`, nên `ratePlanCode` (gói giá) và
 * `promotionCodes` (mã khuyến mãi) **luôn vắng mặt** trên lệnh — chúng chỉ tồn tại trong bản ghi quote.
 *
 * Kiểu ở đây theo đúng bản ghi (`StoredQuote.input`, chuỗi thô); `quoteInput` bên dưới mới là chỗ đối
 * chiếu hợp đồng `quoteRequestSchema`.
 */
export interface QuoteRecordFields {
  readonly ratePlanCode: string;
  readonly promotionCodes: readonly string[];
}

/**
 * Đầu vào dùng để **đối chiếu** một quote đã phát hành (HB-076/HB-077 truyền thân lệnh giữ/đặt chỗ:
 * có thêm `quoteId`, `guest`, `note`… nên chỉ lấy đúng các trường thuộc fingerprint của api.md §3.1;
 * trường lạ bị bỏ qua chứ không làm lệnh hỏng).
 *
 * `stored` là đầu vào đã lưu của quote: nó cấp giá trị cho các trường **vắng mặt** trên thân lệnh
 * (`QuoteRecordFields`). Bỏ bước này thì fingerprint băm `ratePlanCode = undefined` và
 * `promotionCodes = []` ⇒ quote có khuyến mãi hợp lệ vẫn bị `409 E_RATE_QUOTE_MISMATCH`.
 *
 * Trường nào thân lệnh **có** (HB-077/HB-151 khai đủ gói giá/mã) thì giữ nguyên giá trị người gọi:
 * khác bản ghi ⇒ fingerprint lệch ⇒ `409 E_RATE_QUOTE_MISMATCH` như hợp đồng.
 */
export function consumedInput(value: unknown, stored?: QuoteRecordFields): QuoteInput {
  const body = z.record(z.string(), z.unknown()).safeParse(value);
  if (!body.success) throw invalid();
  const record = body.data;
  const picked: Record<string, unknown> = {};
  for (const field of [...REQUIRED_FIELDS, 'childAges', 'promotionCodes'] as const)
    picked[field] = record[field];
  for (const field of ['ratePlanCode', 'promotionCodes'] as const)
    if (record[field] === undefined && stored !== undefined) picked[field] = stored[field];
  if (typeof record['quoteId'] !== 'string' || record['quoteId'].length === 0)
    throw missingField(['quoteId']);
  return quoteInput(picked);
}
