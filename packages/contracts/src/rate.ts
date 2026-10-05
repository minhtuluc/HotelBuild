/** Hợp đồng RATE — api.md §2.4; csdl §3 (rate_calendars, seasons, channels, channel_property_settings, promotions, rate_plans). */
import { z } from 'zod';
import { businessDateSchema, isoUtcTimestampSchema } from './common.js';
import {
  channelCodeSchema,
  ratePlanCodeSchema,
  rateSourceSchema,
  promotionTypeSchema,
} from './enums.js';

/** Hệ số giá: chặn hình thức theo động giá §2 (0,10–5,00) để lỗi cấu hình thật do backend quyết. */
const multiplier = z.number().min(0.1).max(5);
const percent = z.number().min(0).max(100);

export const rateCalendarQuerySchema = z.strictObject({
  from: businessDateSchema,
  to: businessDateSchema,
  source: rateSourceSchema.optional(),
});

export const rateCalendarEntrySchema = z.object({
  date: businessDateSchema,
  basePrice: z.number().int().positive(),
  seasonMultiplier: multiplier,
  weekendMultiplier: multiplier,
  occupancyMultiplier: multiplier,
  losMultiplier: multiplier,
  channelMultiplier: multiplier,
  clamped: z.boolean(),
  nightlyPrice: z.number().int().positive(),
  /**
   * Nguồn giá đang thắng của ngày (BR-RATE-02: OVERRIDE → RATE_PLAN → SEASON → BASE) và tên mùa
   * đang thắng, cùng lấy từ hàm phân giải của engine giá (HB-054 AC1) — giao diện **không** tự suy.
   */
  source: rateSourceSchema.optional(),
  seasonName: z.string().min(1).max(120).optional(),
});

export const rateCalendarSchema = z.object({
  roomTypeId: z.string().min(1),
  from: businessDateSchema,
  to: businessDateSchema,
  entries: z.array(rateCalendarEntrySchema),
  /** Cảnh báo nghiệp vụ của máy chủ (vd. `LONGSTAY14` chưa có giá riêng — BR-RATE-19, HB-054 AC2). */
  warnings: z.array(z.string().min(1)).optional(),
});

/** `PUT /room-types/{roomTypeId}/rate-calendar` — ghi đè `source = OVERRIDE`; vượt ±20% cần OWNER xác nhận (BR-RBAC-04). */
export const rateCalendarOverrideRequestSchema = z.strictObject({
  items: z
    .array(z.strictObject({ date: businessDateSchema, price: z.number().int().positive() }))
    .min(1),
  channelCode: channelCodeSchema.optional(),
  priority: z.number().int().min(0),
  reason: z.string().min(1).max(500),
  confirmOwnerOverride: z.boolean().optional(),
});

/** Bộ lọc `GET /seasons` — danh sách mùa của một cơ sở (SCR-27, chủ dự án duyệt 05/10/2026). */
export const seasonQuerySchema = z.strictObject({
  propertyId: z.string().min(1).optional(),
  from: businessDateSchema.optional(),
  to: businessDateSchema.optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  cursor: z.string().min(1).optional(),
});

/** Một mùa đang cấu hình; `version` để màn hình dùng `If-Match` khi sửa (BR-RATE-05,06). */
export const seasonSummarySchema = z.object({
  id: z.string().min(1),
  propertyId: z.string().min(1),
  name: z.string().min(1).max(120),
  startDate: businessDateSchema,
  endDate: businessDateSchema,
  multiplier,
  priority: z.number().int().min(0),
  weekendSurchargeEnabled: z.boolean(),
  version: z.number().int().min(0),
});

export const seasonCreateRequestSchema = z.strictObject({
  propertyId: z.string().min(1),
  name: z.string().min(1).max(120),
  startDate: businessDateSchema,
  endDate: businessDateSchema,
  multiplier,
  priority: z.number().int().min(0),
  weekendSurchargeEnabled: z.boolean(),
});

/**
 * Bổ sung tuyến đọc kênh (HB-060 SCR-28 + HB-042 SCR-25, chủ dự án duyệt 05/10/2026):
 * api.md chỉ có PATCH theo `{channelId}` nên màn hình không dựng được danh sách kênh.
 */
export const channelQuerySchema = z.strictObject({
  limit: z.coerce.number().int().min(1).max(100).default(50),
  cursor: z.string().min(1).optional(),
});

/** Kênh ở mức mặc định toàn chuỗi; `version` để màn hình gửi `If-Match` khi sửa (BR-RATE-07,18). */
export const channelSummarySchema = z.object({
  id: z.string().min(1),
  code: channelCodeSchema,
  name: z.string().min(1).max(120),
  multiplier,
  commissionPct: percent,
  holdMinutes: z.number().int().min(0).max(1440),
  overbookAllowed: z.boolean(),
  version: z.number().int().min(0),
});

/** Một dòng ghi đè theo cặp (kênh, cơ sở); máy chủ ghi dòng **mới** theo `effectiveFrom`. */
export const channelPropertyOverrideSchema = z.object({
  propertyId: z.string().min(1),
  multiplier: multiplier.optional(),
  commissionPct: percent.optional(),
  effectiveFrom: businessDateSchema,
  version: z.number().int().min(0).optional(),
});

export const channelDetailSchema = channelSummarySchema.extend({
  propertyOverrides: z.array(channelPropertyOverrideSchema),
});

/** `PATCH /channels/{channelId}` — mặc định toàn chuỗi + ghi đè theo cặp (kênh, cơ sở) (BR-RATE-18). */
export const channelUpdateRequestSchema = z.strictObject({
  multiplier: multiplier.optional(),
  commissionPct: percent.optional(),
  holdMinutes: z.number().int().min(0).max(1440).optional(),
  overbookAllowed: z.boolean().optional(),
  propertyOverrides: z
    .array(
      z.strictObject({
        propertyId: z.string().min(1),
        multiplier: multiplier.optional(),
        commissionPct: percent.optional(),
        effectiveFrom: businessDateSchema,
      }),
    )
    .optional(),
  reason: z.string().min(1).max(500).optional(),
});

/**
 * Bổ sung tuyến đọc khuyến mãi (HB-061 SCR-29, chủ dự án duyệt 05/10/2026): api.md §2.4 chỉ có
 * `POST /promotions` nên màn hình không liệt kê được mã hiện có, lượt đã dùng hay trạng thái.
 */
export const promotionQuerySchema = z.strictObject({
  propertyId: z.string().min(1).optional(),
  status: z.enum(['ACTIVE', 'INACTIVE']).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  cursor: z.string().min(1).optional(),
});

/** Một khuyến mãi đang cấu hình; `usedCount`/`status`/`version` để màn hình hiển thị và `If-Match`. */
export const promotionSummarySchema = z.object({
  id: z.string().min(1),
  code: z.string().min(1).max(40),
  type: promotionTypeSchema,
  value: z.number().int().positive(),
  minNights: z.number().int().min(1),
  channelScope: z.array(channelCodeSchema),
  roomTypeScope: z.array(z.string().min(1)),
  validFrom: isoUtcTimestampSchema,
  validTo: isoUtcTimestampSchema,
  maxUses: z.number().int().min(1).nullable(),
  usedCount: z.number().int().min(0),
  stackable: z.boolean(),
  status: z.enum(['ACTIVE', 'INACTIVE']),
  version: z.number().int().min(0),
});

export const promotionCreateRequestSchema = z.strictObject({
  code: z.string().min(1).max(40),
  type: promotionTypeSchema,
  value: z.number().int().positive(),
  minNights: z.number().int().min(1),
  channelScope: z.array(channelCodeSchema),
  roomTypeScope: z.array(z.string().min(1)),
  validFrom: isoUtcTimestampSchema,
  validTo: isoUtcTimestampSchema,
  maxUses: z.number().int().min(1).optional(),
  stackable: z.boolean(),
});

export const multiChannelQuoteRequestSchema = z.strictObject({
  roomTypeId: z.string().min(1),
  checkIn: businessDateSchema,
  checkOut: businessDateSchema,
  channelCodes: z.array(channelCodeSchema).min(1).max(7),
});

/**
 * Một kênh trong so sánh giá (BR-RATE-07,08): giá gộp, hoa hồng và **giá thuần** đều do máy chủ trả.
 * Hoa hồng/thuần để **tuỳ chọn** vì HB-050 chỉ chốt `nightlyFrom`/`totalFrom`; HB-056 (engine báo giá
 * đa kênh) trả đủ ba con số, nên màn SCR-30 đọc được mà không phải tính lại ở giao diện (BR-RATE-17).
 */
export const multiChannelQuoteOptionSchema = z.object({
  channelCode: channelCodeSchema,
  nightlyFrom: z.number().int().positive(),
  totalFrom: z.number().int().positive(),
  commissionPct: percent.optional(),
  /** Giá gộp = tổng trước hoa hồng; `null` khi kênh không có hoa hồng (kênh trực tiếp). */
  grossTotal: z.number().int().positive().optional(),
  commissionAmount: z.number().int().min(0).optional(),
  /** Giá thuần = gộp − hoa hồng (BR-RATE-08). */
  netTotal: z.number().int().optional(),
  warnings: z.array(z.string().min(1)),
});

export const multiChannelQuoteSchema = z.object({
  roomTypeId: z.string().min(1),
  checkIn: businessDateSchema,
  checkOut: businessDateSchema,
  options: z.array(multiChannelQuoteOptionSchema),
});

/** `GET /rate-plans` cho khách: **chỉ** điều khoản hiển thị, không lộ cấu hình nội bộ (HB-050 AC4). */
export const ratePlanPublicSchema = z.object({
  code: ratePlanCodeSchema,
  name: z.string().min(1).max(120),
  minNights: z.number().int().min(1),
  maxNights: z.number().int().min(1),
  depositPercent: percent,
  freeCancelHours: z.number().int().min(0).optional(),
});

export const ratePlanUpdateRequestSchema = z.strictObject({
  depositPercent: percent.optional(),
  minNights: z.number().int().min(1).optional(),
  maxNights: z.number().int().min(1).optional(),
  cancellationPolicyId: z.string().min(1).optional(),
  status: z.enum(['ACTIVE', 'INACTIVE']).optional(),
  reason: z.string().min(1).max(500),
});

export type RateCalendar = z.infer<typeof rateCalendarSchema>;
export type RateCalendarOverrideRequest = z.infer<typeof rateCalendarOverrideRequestSchema>;
export type SeasonCreateRequest = z.infer<typeof seasonCreateRequestSchema>;
export type SeasonSummary = z.infer<typeof seasonSummarySchema>;
export type SeasonQuery = z.infer<typeof seasonQuerySchema>;
export type ChannelUpdateRequest = z.infer<typeof channelUpdateRequestSchema>;
export type ChannelSummary = z.infer<typeof channelSummarySchema>;
export type ChannelDetail = z.infer<typeof channelDetailSchema>;
export type ChannelPropertyOverride = z.infer<typeof channelPropertyOverrideSchema>;
export type PromotionCreateRequest = z.infer<typeof promotionCreateRequestSchema>;
export type PromotionSummary = z.infer<typeof promotionSummarySchema>;
export type PromotionQuery = z.infer<typeof promotionQuerySchema>;
export type MultiChannelQuote = z.infer<typeof multiChannelQuoteSchema>;
export type MultiChannelQuoteRequest = z.infer<typeof multiChannelQuoteRequestSchema>;
export type RatePlanPublic = z.infer<typeof ratePlanPublicSchema>;
export type RatePlanUpdateRequest = z.infer<typeof ratePlanUpdateRequestSchema>;
