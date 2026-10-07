/**
 * Hợp đồng CRM tại quầy — api.md §2.10 (`GET/POST /guests`); HB-140.
 * Nhận diện khách theo SĐT đã chuẩn hoá `+84…` (BR-CRM-01, NFR-LOC-04). Các tuyến loyalty/blacklist/
 * anonymize thuộc hợp đồng F8 (HB-160/HB-166), không khai ở đây.
 */
import { z } from 'zod';
import { isoUtcTimestampSchema, listQuerySchema } from './common.js';
import { phoneNumberSchema } from './auth.js';
import { guestGenderSchema, loyaltyTierSchema } from './enums.js';

/** `POST /guests` — tạo hồ sơ tại quầy; `consentMarketing` phải kèm phiên bản đồng ý (NFR-COMP-01). */
export const guestCreateRequestSchema = z.strictObject({
  fullName: z.string().min(1).max(120),
  phone: phoneNumberSchema,
  email: z.string().email().optional(),
  idNumber: z.string().min(1).max(50).optional(),
  dob: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'Ngày sinh dạng YYYY-MM-DD')
    .optional(),
  nationality: z.string().min(2).max(2).optional(),
  gender: guestGenderSchema.optional(),
  consentMarketing: z.boolean(),
  consentVersion: z.string().min(1).max(40),
  note: z.string().max(500).optional(),
});

/** Phản hồi hồ sơ khách cho màn tiền sảnh; bỏ qua trường lạ để tương thích tiến (api.md §7.1). */
export const guestSummarySchema = z.object({
  id: z.string().min(1),
  fullName: z.string().min(1).max(120),
  phone: z.string().min(1),
  email: z.string().min(1).nullable(),
  loyaltyTier: loyaltyTierSchema,
  loyaltyPoints: z.number().int().min(0),
  totalStays: z.number().int().min(0),
  blacklisted: z.boolean(),
  consentMarketing: z.boolean(),
  createdAt: isoUtcTimestampSchema,
});

export const guestQuerySchema = listQuerySchema.extend({
  q: z.string().min(1).optional(),
  loyaltyTier: loyaltyTierSchema.optional(),
  blacklisted: z.coerce.boolean().optional(),
  propertyId: z.string().min(1).optional(),
});

/**
 * `POST /guests/{guestId}/anonymize` — MANAGER; ẩn danh hoá theo yêu cầu khách, **không** xoá cứng
 * (BR-CRM-05, NFR-COMP-02). Endpoint `DELETE /guests/{id}` bị cấm (§2.14).
 */
export const guestAnonymizeRequestSchema = z.strictObject({
  reason: z.string().min(1).max(500),
  requestedAt: isoUtcTimestampSchema,
});

/** `GET /guests/{guestId}/loyalty` — hạng, điểm và số đêm tích luỹ 12 tháng (BR-CRM-02,03). */
export const guestLoyaltySchema = z.object({
  guestId: z.string().min(1),
  loyaltyTier: loyaltyTierSchema,
  loyaltyPoints: z.number().int().min(0),
  staysLast12Months: z.number().int().min(0),
  totalStays: z.number().int().min(0),
  updatedAt: isoUtcTimestampSchema,
});

/** `POST /guests/{guestId}/blacklist` — MANAGER; lý do bắt buộc (BR-CRM-04). */
export const guestBlacklistRequestSchema = z.strictObject({
  blacklistReason: z.string().min(1).max(500),
});

/** `DELETE /guests/{guestId}/blacklist` — gỡ khỏi danh sách đen kèm lý do, trả 204 (BR-CRM-04,05). */
export const guestBlacklistReleaseQuerySchema = z.strictObject({
  reason: z.string().min(1).max(500),
});

export type GuestCreateRequest = z.infer<typeof guestCreateRequestSchema>;
export type GuestSummary = z.infer<typeof guestSummarySchema>;
export type GuestQuery = z.infer<typeof guestQuerySchema>;
export type GuestAnonymizeRequest = z.infer<typeof guestAnonymizeRequestSchema>;
export type GuestLoyalty = z.infer<typeof guestLoyaltySchema>;
export type GuestBlacklistRequest = z.infer<typeof guestBlacklistRequestSchema>;
