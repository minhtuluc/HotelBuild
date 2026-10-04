/**
 * Hợp đồng BOOK — api.md §2.5, §3.2 (`POST /bookings` + `confirm`), §3.4 (holds); csdl §3.
 * Trạng thái/tiền do máy chủ quyết; `owedAmount`/`paidAmount` không tin client (BR-BOOK-09, BR-PAY-01).
 */
import { z } from 'zod';
import { businessDateSchema, isoUtcTimestampSchema, listQuerySchema } from './common.js';
import {
  bookingStatusSchema,
  channelCodeSchema,
  holdStatusSchema,
  ratePlanCodeSchema,
} from './enums.js';

/**
 * Liên hệ khách trên booking: SĐT dạng khách tự nhập (`0XXXXXXXXX`) hoặc đã chuẩn hoá `+84…`
 * (chuẩn hoá khoá nhận diện là việc của HB-149, BR-CRM-01).
 */
export const guestContactSchema = z.object({
  fullName: z.string().min(1).max(120),
  phone: z
    .string()
    .regex(/^(?:\+84|0)\d{9}$/, 'Số điện thoại phải là 0XXXXXXXXX hoặc +84XXXXXXXXX'),
});

const childAgesSchema = z.array(z.number().int().min(0).max(17));

/** `POST /bookings` — web/quầy/điện thoại; một quote ↔ một booking (api.md §3.2, BR-BOOK-16). */
export const bookingCreateRequestSchema = z
  .strictObject({
    propertyId: z.string().min(1),
    roomTypeId: z.string().min(1),
    ratePlanCode: ratePlanCodeSchema,
    channelCode: channelCodeSchema,
    quoteId: z.string().min(1),
    guest: guestContactSchema,
    checkIn: businessDateSchema,
    checkOut: businessDateSchema,
    adults: z.number().int().min(1).max(20),
    children: z.number().int().min(0).max(20),
    childAges: childAgesSchema.optional(),
    roomCount: z.number().int().min(1).max(10),
    promotionCodes: z.array(z.string().min(1).max(40)).optional(),
    note: z.string().max(500).optional(),
  })
  .refine((value) => value.childAges === undefined || value.childAges.length === value.children, {
    message: '`childAges` phải có đúng `children` phần tử',
    path: ['childAges'],
  });

/** Bản tóm tắt booking (api.md §3.2); `version` chỉ có ở chi tiết `GET /bookings/{id}`. */
export const bookingSummarySchema = z.object({
  id: z.string().min(1),
  code: z.string().min(1),
  seq: z.number().int().min(0),
  status: bookingStatusSchema,
  guestId: z.string().min(1),
  propertyId: z.string().min(1),
  roomTypeId: z.string().min(1),
  ratePlanId: z.string().min(1),
  channelId: z.string().min(1),
  checkIn: businessDateSchema,
  checkOut: businessDateSchema,
  nights: z.number().int().min(1),
  adults: z.number().int().min(1),
  children: z.number().int().min(0),
  roomCount: z.number().int().min(1),
  totalAmount: z.number().int().min(0),
  depositPercent: z.number().int().min(0).max(100),
  depositAmount: z.number().int().min(0),
  paidAmount: z.number().int().min(0),
  refundedAmount: z.number().int().min(0),
  balanceDue: z.number().int().min(0),
  penaltyAmount: z.number().int().min(0),
  currency: z.literal('VND'),
  rescheduleCount: z.number().int().min(0),
  holdExpiresAt: isoUtcTimestampSchema.nullable(),
  oversold: z.boolean(),
  priceLocked: z.boolean(),
  duplicateSuspected: z.boolean(),
  channelPolicyCode: z.string().min(1).nullable(),
  note: z.string().max(500).nullable(),
  createdBy: z.string().min(1),
  createdAt: isoUtcTimestampSchema,
  version: z.number().int().min(0).optional(),
});

/** Bộ lọc `GET /bookings`: khách chỉ thấy booking của mình, nhân viên lọc theo phạm vi cơ sở (§6.3). */
export const bookingsQuerySchema = listQuerySchema.extend({
  propertyId: z.string().min(1).optional(),
  status: bookingStatusSchema.optional(),
  channelCode: channelCodeSchema.optional(),
});

/** `POST /bookings/{bookingId}/confirm` — chỉ CONFIRMED khi đã đủ cọc theo BR-BOOK-09. */
export const bookingConfirmRequestSchema = z.strictObject({
  paymentId: z.string().min(1),
});

/** `POST /holds` — giữ chỗ có thời hạn; kênh `holdMinutes = 0` không dùng được (api.md §3.4). */
export const holdCreateRequestSchema = z
  .strictObject({
    propertyId: z.string().min(1),
    roomTypeId: z.string().min(1),
    channelCode: channelCodeSchema,
    checkIn: businessDateSchema,
    checkOut: businessDateSchema,
    adults: z.number().int().min(1).max(20),
    children: z.number().int().min(0).max(20),
    childAges: childAgesSchema.optional(),
    roomCount: z.number().int().min(1).max(10),
    quoteId: z.string().min(1),
  })
  .refine((value) => value.childAges === undefined || value.childAges.length === value.children, {
    message: '`childAges` phải có đúng `children` phần tử',
    path: ['childAges'],
  });

/** Phản hồi `201` của `POST /holds` (api.md §3.4). */
export const holdSchema = z.object({
  holdId: z.string().min(1),
  bookingId: z.string().min(1),
  bookingCode: z.string().min(1),
  bookingStatus: bookingStatusSchema,
  status: holdStatusSchema,
  channelId: z.string().min(1),
  releasedAt: isoUtcTimestampSchema.nullable(),
  expiresAt: isoUtcTimestampSchema,
  holdExpiresAt: isoUtcTimestampSchema,
  quotedTotal: z.number().int().min(0),
  createdAt: isoUtcTimestampSchema,
});

/** `DELETE /holds/{holdId}` buộc có lý do giải phóng (api.md §2.5, BR-INV-04). */
export const holdReleaseQuerySchema = z.strictObject({
  reason: z.string().min(1).max(500),
});

export type BookingCreateRequest = z.infer<typeof bookingCreateRequestSchema>;
export type BookingSummary = z.infer<typeof bookingSummarySchema>;
export type BookingsQuery = z.infer<typeof bookingsQuerySchema>;
export type BookingConfirmRequest = z.infer<typeof bookingConfirmRequestSchema>;
export type Hold = z.infer<typeof holdSchema>;
export type HoldCreateRequest = z.infer<typeof holdCreateRequestSchema>;
export type GuestContact = z.infer<typeof guestContactSchema>;
