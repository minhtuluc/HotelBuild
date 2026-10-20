/**
 * Đầu vào/đầu ra của lệnh điều phối walk-in (HB-151; UC-BOOK-02, FR-BOOK-02; api.md §2.5, §3.2).
 *
 * Thân lệnh **không** có `channelCode`: kênh do cấu hình quyết (bảng `channels`, mã `WALKIN`), client
 * không được tự khai kênh để đổi hệ số giá (BR-RATE-07). Các trường còn lại trùng đúng hợp đồng báo
 * giá/đặt phòng — lớp này chỉ kiểm hình dạng, không tính giá và không quyết trạng thái.
 *
 * `quoteRequestBody`/`bookingRequestBody` là hai hình chiếu thuần của cùng đầu vào: chúng chỉ **chọn
 * trường** cho hai use case F4 (HB-074/HB-077), không thêm/bớt giá trị nào. Nhờ vậy fingerprint quote
 * của bước sau khớp tuyệt đối với bước trước (BR-RATE-17, ADR-015 §2).
 */
import {
  bookingSummarySchema,
  businessDateSchema,
  channelCodeSchema,
  guestContactSchema,
  quoteSchema,
  ratePlanCodeSchema,
} from '@pinehill/contracts';
import type { ChannelCode, RatePlanCode } from '@pinehill/contracts';
import { z } from 'zod';
import { AppError } from '../../../common/app-error.js';
import { uuid } from '../../rate/calendar/support.js';

/** Mã kênh cấu hình cho khách vãng lai (BR-RATE-07, `channels.code` CHECK của CSDL). */
export const WALK_IN_CHANNEL: ChannelCode = channelCodeSchema.parse('WALKIN');

/** Sai kiểu/giá trị, hoặc mã tài nguyên không phải UUID ⇒ `400 E_GEN_VALIDATION_FAILED` (api.md §5). */
export const invalid = () =>
  new AppError(400, 'E_GEN_VALIDATION_FAILED', 'Yêu cầu tạo booking khách vãng lai không hợp lệ.');

export const unauthorized = () =>
  new AppError(401, 'E_AUTH_INVALID_CREDENTIALS', 'Chưa xác thực hoặc phiên đã kết thúc.');

/** BR-RBAC-02/03: nhân viên phải có phạm vi cơ sở của lệnh (OWNER toàn chuỗi, SYSADMIN không dữ liệu). */
export const outOfScope = () =>
  new AppError(403, 'E_AUTH_OUT_OF_SCOPE', 'Bạn không được truy cập dữ liệu của cơ sở này.');

/** Kênh `WALKIN` chưa được tạo trong CSDL (seed lỗi) — không lộ chi tiết cấu hình. */
export const missing = () => new AppError(404, 'E_GEN_NOT_FOUND', 'Không tìm thấy tài nguyên.');

/** BR-BOOK-07 + api.md §2.5: kênh đang `INACTIVE` thì không bán walk-in. */
export const channelInactive = () =>
  new AppError(409, 'E_BOOK_INVALID_STATE', 'Kênh khách vãng lai đang ngừng bán.');

const childAgesSchema = z.array(z.number().int().min(0).max(17));

/**
 * Thân `POST /walk-in` — **strict** (trường lạ, kể cả `channelCode`, là lệnh hỏng). Thiếu/sai trường
 * rơi về `400 E_GEN_VALIDATION_FAILED`; các mã `E_BOOK_*` sâu hơn do use case F4 trả sau khi khoá tồn.
 */
const walkInRequestSchema = z
  .strictObject({
    propertyId: z.string().min(1),
    roomTypeId: z.string().min(1),
    ratePlanCode: ratePlanCodeSchema,
    checkIn: businessDateSchema,
    checkOut: businessDateSchema,
    adults: z.number().int().min(1).max(20),
    children: z.number().int().min(0).max(20),
    childAges: childAgesSchema.optional(),
    roomCount: z.number().int().min(1).max(10),
    promotionCodes: z.array(z.string().min(1).max(40)).optional(),
    guest: guestContactSchema,
    note: z.string().max(500).optional(),
  })
  .refine((value) => value.childAges === undefined || value.childAges.length === value.children, {
    message: '`childAges` phải có đúng `children` phần tử',
    path: ['childAges'],
  });

/** Đầu vào đã chuẩn hoá (UUID hạ chữ thường, mảng luôn có mặt) — dùng cho cả hai bước con F4. */
export interface WalkInInput {
  readonly propertyId: string;
  readonly roomTypeId: string;
  readonly ratePlanCode: RatePlanCode;
  readonly checkIn: string;
  readonly checkOut: string;
  readonly adults: number;
  readonly children: number;
  readonly childAges: readonly number[];
  readonly roomCount: number;
  readonly promotionCodes: readonly string[];
  readonly guest: { readonly fullName: string; readonly phone: string };
  readonly note: string | null;
}

export function walkInInput(value: unknown): WalkInInput {
  const parsed = walkInRequestSchema.safeParse(value);
  if (!parsed.success) throw invalid();
  const request = parsed.data;
  return Object.freeze({
    propertyId: uuid(request.propertyId),
    roomTypeId: uuid(request.roomTypeId),
    ratePlanCode: request.ratePlanCode,
    checkIn: request.checkIn,
    checkOut: request.checkOut,
    adults: request.adults,
    children: request.children,
    childAges: Object.freeze([...(request.childAges ?? [])]),
    roomCount: request.roomCount,
    promotionCodes: Object.freeze([...(request.promotionCodes ?? [])]),
    // SĐT thô được HB-077 chuẩn hoá `+84…` (BR-CRM-01) — không chuẩn hoá lần hai ở đây.
    guest: Object.freeze({ fullName: request.guest.fullName, phone: request.guest.phone }),
    note: request.note ?? null,
  });
}

/** Thân `POST /quotes` (HB-074): chỉ chọn trường, không đổi giá trị. */
export function quoteRequestBody(input: WalkInInput, channelCode: ChannelCode) {
  return {
    propertyId: input.propertyId,
    roomTypeId: input.roomTypeId,
    channelCode,
    ratePlanCode: input.ratePlanCode,
    checkIn: input.checkIn,
    checkOut: input.checkOut,
    adults: input.adults,
    children: input.children,
    ...(input.childAges.length > 0 ? { childAges: [...input.childAges] } : {}),
    roomCount: input.roomCount,
    ...(input.promotionCodes.length > 0 ? { promotionCodes: [...input.promotionCodes] } : {}),
  };
}

/** Thân `POST /bookings` (HB-077): cùng kỳ/đầu vào với quote vừa phát hành + khách + ghi chú. */
export function bookingRequestBody(input: WalkInInput, quoteId: string, channelCode: ChannelCode) {
  return {
    ...quoteRequestBody(input, channelCode),
    quoteId,
    guest: { ...input.guest },
    ...(input.note === null ? {} : { note: input.note }),
  };
}

/** Kết quả điều phối: quote đã phát hành, booking (mới hoặc cũ theo BR-BOOK-16), cờ `created`. */
export const walkInResultSchema = z.object({
  created: z.boolean(),
  quote: quoteSchema,
  booking: bookingSummarySchema,
});
export type WalkInResult = z.infer<typeof walkInResultSchema>;
