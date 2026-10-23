/**
 * Hợp đồng FO — tiền sảnh (api.md §2.9): check-in, check-out, no-show. HB-140.
 * Check-out là lệnh 🔒 (`pinToken`); số tiền do máy chủ quyết (BR-FO-03,05,06, BR-CANCEL-09).
 */
import { z } from 'zod';
import { isoUtcTimestampSchema } from './common.js';
import { bookingStatusSchema } from './enums.js';

/** `POST /front-office/check-in` — FRONT_DESK; gán phòng thực tế và ghi nhận check-in sớm (BR-FO-04). */
export const checkInRequestSchema = z.strictObject({
  bookingId: z.string().min(1),
  idNumber: z.string().min(1).max(50).optional(),
  actualRoomIds: z.array(z.string().min(1)).min(1),
  earlyCheckIn: z.boolean(),
  note: z.string().max(500).optional(),
});

export const checkInResponseSchema = z.object({
  bookingId: z.string().min(1),
  status: bookingStatusSchema,
  roomIds: z.array(z.string().min(1)),
  checkedInAt: isoUtcTimestampSchema,
  /** Phụ thu check-in sớm do máy chủ tính (BR-FO-04); 0 khi không áp dụng. */
  earlyCheckInFee: z.number().int().min(0),
});

/** Một khoản phát sinh khi trả phòng; tiền VND nguyên (BR-GEN-01). */
export const checkoutExtraSchema = z.strictObject({
  description: z.string().min(1).max(200),
  amount: z.number().int().positive(),
  quantity: z.number().int().min(1).max(99).optional(),
});

/** `POST /front-office/check-out` — 🔒 PIN; thu phát sinh, ghi nhận trả sớm/muộn (BR-FO-03,05,06). */
export const checkOutRequestSchema = z.strictObject({
  bookingId: z.string().min(1),
  extras: z.array(checkoutExtraSchema).max(50).optional(),
  lateCheckOut: z.boolean(),
  earlyCheckOut: z.boolean(),
  note: z.string().max(500).optional(),
  pinToken: z.string().min(16).optional(),
});

export const checkOutResponseSchema = z.object({
  bookingId: z.string().min(1),
  status: bookingStatusSchema,
  checkedOutAt: isoUtcTimestampSchema,
  extrasAmount: z.number().int().min(0),
  /** Phụ thu trả muộn/sớm theo `CancellationPolicy.earlyCheckout*` (BR-FO-05, BR-CANCEL-09). */
  feeAmount: z.number().int().min(0),
  balanceDue: z.number().int().min(0),
  /** Nhiệm vụ buồng phòng sinh ra trong cùng transaction (BR-FO-06). */
  housekeepingTaskIds: z.array(z.string().min(1)),
});

/** `POST /front-office/no-show` — FRONT_DESK; áp bậc bắt tất của chính sách (BR-CANCEL-10). */
export const noShowRequestSchema = z.strictObject({
  bookingId: z.string().min(1),
  reason: z.string().min(1).max(500),
});

export const noShowResponseSchema = z.object({
  bookingId: z.string().min(1),
  status: bookingStatusSchema,
  markedAt: isoUtcTimestampSchema,
  /** Phụ thu đêm đầu cùng tiền hoàn dự kiến (nếu có) do máy chủ quyết. */
  penaltyAmount: z.number().int().min(0),
  refundRequestId: z.string().min(1).nullable(),
});

/**
 * `POST /front-office/no-show/preview` — HB-204. Xem trước tiền no-show, **không ghi**, không PIN, không
 * `Idempotency-Key`; số do cùng engine với lệnh ghi (BR-CANCEL-06, BR-CANCEL-10) và không ràng buộc:
 * lệnh ghi tính lại sau khoá (ADR-014).
 */
export const noShowPreviewRequestSchema = z.strictObject({
  bookingId: z.string().min(1),
});

export const noShowPreviewSchema = z.object({
  bookingId: z.string().min(1),
  /** Phụ thu đêm đầu theo bậc bắt tất; 0 khi không áp dụng. */
  penaltyAmount: z.number().int().min(0),
  /** Tiền hoàn dự kiến sau khi trừ phạt; 0 khi không có. */
  expectedRefundAmount: z.number().int().min(0),
  /** Mốc sớm nhất được ghi no-show: 23:59 giờ VN ngày nhận phòng (BR-FO-02). */
  markableFrom: isoUtcTimestampSchema,
  computedAt: isoUtcTimestampSchema,
});

/**
 * `POST /front-office/check-out/preview` — HB-204. Cùng ràng buộc thân lệnh với check-out nhưng **không**
 * có `pinToken` (không ghi, không tiền ra); số không ràng buộc (BR-FO-03, BR-FO-05, BR-CANCEL-09).
 */
export const checkOutPreviewRequestSchema = checkOutRequestSchema.omit({ pinToken: true });

export const checkOutPreviewSchema = z.object({
  bookingId: z.string().min(1),
  /** Phụ thu trả muộn/sớm do máy chủ tính. */
  feeAmount: z.number().int().min(0),
  extrasAmount: z.number().int().min(0),
  /** Số dư dự kiến phải thu sau phụ thu và phát sinh. */
  balanceDue: z.number().int().min(0),
  computedAt: isoUtcTimestampSchema,
});

export type CheckInRequest = z.infer<typeof checkInRequestSchema>;
export type CheckInResponse = z.infer<typeof checkInResponseSchema>;
export type CheckOutRequest = z.infer<typeof checkOutRequestSchema>;
export type CheckOutResponse = z.infer<typeof checkOutResponseSchema>;
export type NoShowRequest = z.infer<typeof noShowRequestSchema>;
export type NoShowResponse = z.infer<typeof noShowResponseSchema>;
export type NoShowPreviewRequest = z.infer<typeof noShowPreviewRequestSchema>;
export type NoShowPreview = z.infer<typeof noShowPreviewSchema>;
export type CheckOutPreviewRequest = z.infer<typeof checkOutPreviewRequestSchema>;
export type CheckOutPreview = z.infer<typeof checkOutPreviewSchema>;
