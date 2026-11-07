/**
 * Hợp đồng CHAN — api.md §2.7, §5.1, §6.3; HB-120.
 *
 * Ba nhóm bề mặt:
 * 1. Bốn tuyến vận hành lõi (sync, mappings, sales-closure, ota-bookings) — AC1/AC14.
 * 2. Đường đọc/retry cho SCR-40/41/42 (sync-status, outbox-deliveries, duplicate-flag) — AC11.
 * 3. Hợp đồng **simulator** webhook OTA (§5.1) — AC8. Đây là hợp đồng do Pine Hill tự định nghĩa,
 *    **KHÔNG** phải API thật của Booking.com/Agoda/Airbnb; adapter đối tác thật phải có contract test riêng.
 *
 * Mọi thời điểm vận chuyển dùng ISO-8601 UTC; ngày nghiệp vụ dùng `YYYY-MM-DD` giờ Việt Nam; khoảng
 * `[from,to)` là nửa mở trên **ngày** (BR-GEN-04). Tiền là số nguyên VND trong miền số nguyên an toàn,
 * không có trường tổng tiền nào để frontend tự quyết.
 */
import { z } from 'zod';
import { businessDateSchema, isoUtcTimestampSchema, listQuerySchema } from './common.js';
import {
  channelSyncStatusSchema,
  outboxDeliveryStatusSchema,
  otaBookingProcessingStatusSchema,
  otaEventTypeSchema,
  paymentMethodSchema,
  salesClosureSourceSchema,
} from './enums.js';

/** Số ngày giữa hai ngày `YYYY-MM-DD` (UTC) — dùng cho ràng buộc khoảng `[from,to)`. */
function daysBetween(from: string, to: string): number {
  const start = Date.parse(`${from}T00:00:00Z`);
  const end = Date.parse(`${to}T00:00:00Z`);
  return Math.round((end - start) / 86_400_000);
}

/** Phạm vi một lệnh đồng bộ: toàn bộ cấu hình hoặc một khoảng ngày xác định. */
export const channelSyncScopeSchema = z.enum(['FULL', 'RANGE']);

/**
 * `POST /channels/{channelId}/sync` — đẩy tồn & giá lên một kênh (202, api.md §2.7).
 * `FULL` không nhận `from`/`to`; `RANGE` bắt buộc đủ hai mốc và `to` không trước `from`.
 * Lệnh chỉ **đề nghị** đồng bộ; quyết định tồn/giá vẫn do máy chủ tính theo BR-CHAN-02/05/08.
 */
export const channelSyncRequestSchema = z
  .strictObject({
    scope: channelSyncScopeSchema,
    from: businessDateSchema.optional(),
    to: businessDateSchema.optional(),
    roomTypeIds: z.array(z.string().min(1)).min(1).max(50).optional(),
  })
  .refine(
    (value) => value.scope === 'FULL' || (value.from !== undefined && value.to !== undefined),
    {
      message: '`scope = RANGE` bắt buộc có đủ `from` và `to`',
      path: ['scope'],
    },
  )
  .refine(
    (value) => value.scope === 'RANGE' || (value.from === undefined && value.to === undefined),
    {
      message: '`scope = FULL` không nhận khoảng ngày',
      path: ['scope'],
    },
  )
  .refine(
    (value) =>
      value.from === undefined || value.to === undefined || daysBetween(value.from, value.to) >= 0,
    {
      message: '`to` phải không trước `from`',
      path: ['to'],
    },
  );

/**
 * `PUT /channels/{channelId}/mappings` — ánh xạ loại phòng ↔ mã phòng OTA (OWNER, api.md §2.7).
 * Khoá tự nhiên là `(channelId, roomTypeId)`; gọi lại với cùng khoá là upsert, không tạo bản sao.
 * `allotmentPct` chỉ là hạn mức phần trăm theo BR-CHAN-01; số đơn vị tuyệt đối do máy chủ tính.
 */
export const channelMappingPutRequestSchema = z.strictObject({
  roomTypeId: z.string().min(1),
  providerRoomTypeCode: z.string().trim().min(1).max(64),
  allotmentPct: z.number().int().min(0).max(100),
  externalRatePlanCode: z.string().trim().min(1).max(64).optional(),
  status: z.enum(['ACTIVE', 'INACTIVE']).optional(),
});

/** Ánh xạ đã lưu; `version` để gửi `If-Match` ở lần sửa kế tiếp (api.md §1.3). */
export const channelMappingSchema = z.object({
  id: z.string().min(1),
  channelId: z.string().min(1),
  roomTypeId: z.string().min(1),
  providerRoomTypeCode: z.string().min(1),
  allotmentPct: z.number().int().min(0).max(100),
  externalRatePlanCode: z.string().nullable(),
  status: z.enum(['ACTIVE', 'INACTIVE']),
  version: z.number().int().min(0),
  updatedAt: isoUtcTimestampSchema,
});

/** Phản hồi `PUT /channels/{channelId}/mappings`: ánh xạ vừa ghi + version của cả bộ cấu hình. */
export const channelMappingsViewSchema = z.object({
  channelId: z.string().min(1),
  mapping: channelMappingSchema,
  version: z.number().int().min(0),
});

/**
 * Một nguồn đóng bán trên một ngày. Manual và automatic tách riêng vì lệnh mở thủ công **chỉ** gỡ
 * manual flag, không vượt auto closure/quota (BR-CHAN-05, HB-120 AC14).
 */
export const salesClosureEntrySchema = z.object({
  closed: z.boolean(),
  reason: z.string().nullable(),
  closedAt: isoUtcTimestampSchema.nullable(),
  reopenedAt: isoUtcTimestampSchema.nullable(),
});

/** Dòng projection đóng bán theo `(roomTypeId, date)`; `source` chỉ để UI hiển thị nguồn hiệu lực. */
export const salesClosureRowSchema = z.object({
  roomTypeId: z.string().min(1),
  date: businessDateSchema,
  /** Hiệu lực cuối cùng: đóng khi manual **hoặc** automatic đang đóng. */
  closed: z.boolean(),
  /** Nguồn đang giữ đóng; `null` khi không đóng. `MANUAL` thắng `AUTOMATIC` khi cả hai cùng đóng. */
  closureSource: salesClosureSourceSchema.nullable(),
  manual: salesClosureEntrySchema,
  automatic: salesClosureEntrySchema,
});

export const salesClosureViewSchema = z.object({
  channelId: z.string().min(1),
  rows: z.array(salesClosureRowSchema),
});

/**
 * `POST /channels/{channelId}/sales-closure` — đóng/mở bán loại phòng theo ngày (MANAGER, BR-CHAN-05).
 * `closed` mặc định `true` để **giữ nguyên hành vi đã phát hành** khi client cũ không gửi trường này;
 * `closed = false` chỉ gỡ đóng thủ công, server vẫn áp auto closure và quota.
 */
export const salesClosureRequestSchema = z
  .strictObject({
    roomTypeId: z.string().min(1),
    from: businessDateSchema,
    to: businessDateSchema,
    reason: z.string().trim().min(1).max(500),
    closed: z.boolean().default(true),
  })
  .refine((value) => daysBetween(value.from, value.to) >= 0, {
    message: '`to` phải không trước `from`',
    path: ['to'],
  });

/** Một dòng lịch sử đồng bộ; giữ lỗi cũ làm bằng chứng vận hành (HB-120 AC14). */
export const channelSyncHistoryEntrySchema = z.object({
  at: isoUtcTimestampSchema,
  outcome: z.enum(['SUCCESS', 'FAILURE']),
  error: z.string().nullable(),
});

/**
 * `GET /channels/{channelId}/sync-status` — trạng thái đồng bộ để SCR-41 phân biệt "chưa từng đồng bộ"
 * với "đã hồi phục". Success **xác minh** đưa `syncStatus = OK` và `consecutiveFailures = 0` nhưng
 * `history` vẫn giữ lần lỗi trước đó (BR-CHAN-07).
 */
export const channelSyncStatusViewSchema = z.object({
  channelId: z.string().min(1),
  syncStatus: channelSyncStatusSchema,
  consecutiveFailures: z.number().int().min(0),
  lastSyncAt: isoUtcTimestampSchema.nullable(),
  lastSuccessAt: isoUtcTimestampSchema.nullable(),
  lastVerifiedAt: isoUtcTimestampSchema.nullable(),
  lastError: z.string().nullable(),
  history: z.array(channelSyncHistoryEntrySchema).max(20),
});

/**
 * Một lần giao sự kiện ra kênh (`event_deliveries`). Response **che payload** và credentials: chỉ trả
 * định danh, khoá consumer và lỗi đã làm sạch (HB-120 AC11).
 */
export const outboxDeliverySchema = z.object({
  id: z.string().min(1),
  eventId: z.string().min(1),
  eventType: z.string().min(1),
  consumerKey: z.string().min(1),
  status: outboxDeliveryStatusSchema,
  attempts: z.number().int().min(0),
  lastError: z.string().nullable(),
  nextAttemptAt: isoUtcTimestampSchema.nullable(),
  createdAt: isoUtcTimestampSchema,
  processedAt: isoUtcTimestampSchema.nullable(),
});

export const outboxDeliveriesQuerySchema = listQuerySchema.extend({
  status: outboxDeliveryStatusSchema.optional(),
  consumerKey: z.string().min(1).optional(),
});

/**
 * Booking OTA nhìn từ inbox. Che PII: chỉ có `guestNameMasked`; không có SĐT/email/payload thô hay
 * credentials kênh. `duplicate` là kết quả đối chiếu hash, khác `flagged` (đánh dấu nghi trùng để
 * người vận hành xử lý thủ công).
 */
export const otaBookingSchema = z.object({
  id: z.string().min(1),
  channelId: z.string().min(1),
  /** `null` khi booking của kênh chưa có sự kiện inbox khớp (dòng không do webhook áp). */
  eventType: otaEventTypeSchema.nullable(),
  providerEventId: z.string().min(1).nullable(),
  providerBookingCode: z.string().min(1),
  status: otaBookingProcessingStatusSchema,
  bookingId: z.string().min(1).nullable(),
  duplicate: z.boolean(),
  flagged: z.boolean(),
  flagReason: z.string().nullable(),
  flaggedBy: z.string().nullable(),
  flaggedAt: isoUtcTimestampSchema.nullable(),
  /** Booking OTA đã xác nhận vượt tồn (BR-CHAN-03): chỉ để cảnh báo, không chặn nhận. */
  oversold: z.boolean(),
  guestNameMasked: z.string().min(1).nullable(),
  receivedAt: isoUtcTimestampSchema,
  processedAt: isoUtcTimestampSchema.nullable(),
  errorCode: z.string().nullable(),
  version: z.number().int().min(0),
  /**
   * Phần dưới (F6 gap HB-134) chỉ **thêm**, đều tuỳ chọn: máy chủ đọc từ sổ cái/booking, giao diện chỉ hiển thị.
   * `OTA_COLLECT` khi đã ghi khoản thu hộ của OTA vào sổ cái; `null` khi chưa có.
   */
  paymentMethod: paymentMethodSchema.nullable().optional(),
  /** Tổng `payments` SUCCEEDED `OTA_COLLECT` của booking (VND nguyên); `null` khi chưa có khoản thu. */
  collectedAmount: z.number().int().min(0).nullable().optional(),
  /** Mã chính sách huỷ của kênh đã áp khi OTA huỷ (`bookings.channel_policy_code`); `null` khi chưa huỷ. */
  channelPolicyCode: z.string().nullable().optional(),
  /** Case quá tải sớm nhất phủ đêm lưu trú của booking vượt tồn; `null` khi không có. */
  overbookingCaseId: z.string().min(1).nullable().optional(),
});

export const otaBookingsQuerySchema = listQuerySchema.extend({
  status: otaBookingProcessingStatusSchema.optional(),
});

/**
 * `POST /channels/{channelId}/ota-bookings/{bookingId}/duplicate-flag` — đánh dấu nghi trùng để
 * người vận hành soát. **Không** huỷ booking, không sửa tiền; version hiện hành gửi qua `If-Match`.
 */
export const otaBookingFlagRequestSchema = z.strictObject({
  flagged: z.boolean(),
  reason: z.string().trim().min(1).max(500),
});

/** Kênh simulator trong URL (§5.1): ánh xạ sang `OTA_BOOKING`/`OTA_AGODA`/`OTA_AIRBNB` qua adapter. */
export const otaSimulatorChannelSchema = z.enum(['booking', 'agoda', 'airbnb']);

/** `X-Pinehill-Signature: t=<unix>,v1=<hex(hmac_sha256(secret, t + "." + rawBody))>` (§5.1). */
export const otaWebhookSignatureSchema = z
  .string()
  .regex(/^t=\d{1,12},v1=[0-9a-f]{64}$/, 'Chữ ký phải có dạng `t=<unix>,v1=<hex>`');

/**
 * Header của webhook simulator. `x-pinehill-key-id` chọn khoá bí mật theo tài khoản đối tác;
 * `x-channel-event-id` là khoá chống phát lại giữ 7 ngày. Timestamp nằm trong chữ ký `t`; lệch quá
 * 300 giây bị từ chối `401 E_CHAN_SIGNATURE_INVALID` (NFR-SEC-05).
 */
export const otaWebhookHeadersSchema = z.object({
  'x-pinehill-signature': otaWebhookSignatureSchema,
  'x-pinehill-key-id': z.string().trim().min(1).max(64),
  'x-channel-event-id': z.string().trim().min(1).max(128),
});

/**
 * Thân sự kiện OTA (§5.1) — **hợp đồng simulator Pine Hill**, không phải payload thật của đối tác.
 * `providerUpdatedAt` quyết định thứ tự xử lý: sự kiện cũ hơn bị bỏ, `booking.cancelled` luôn thắng.
 * Booking đã thu tiền (`paymentCollected = true`) tạo `CONFIRMED` kể cả khi tồn bằng 0 (BR-CHAN-03).
 */
export const otaWebhookEventSchema = z
  .strictObject({
    eventType: otaEventTypeSchema,
    providerAccountId: z.string().trim().min(1).max(64),
    providerBookingCode: z.string().trim().min(1).max(64),
    providerUpdatedAt: isoUtcTimestampSchema,
    propertyCode: z.string().trim().min(1).max(32),
    roomTypeCode: z.string().trim().min(1).max(32),
    checkIn: businessDateSchema,
    checkOut: businessDateSchema,
    adults: z.number().int().min(1).max(20),
    children: z.number().int().min(0).max(20),
    roomCount: z.number().int().min(1).max(10),
    guest: z.strictObject({
      fullName: z.string().trim().min(1).max(120),
      /** Không bắt buộc: một số kênh không trả SĐT; chuẩn hoá về `+84…` là việc của HB-149. */
      phone: z
        .string()
        .regex(/^(?:\+84|0)\d{9}$/, 'Số điện thoại phải là 0XXXXXXXXX hoặc +84XXXXXXXXX')
        .optional(),
    }),
    /** Tổng tiền OTA báo, VND nguyên; máy chủ vẫn đối chiếu chính sách kênh. */
    amount: z.number().int().safe().min(0),
    currency: z.literal('VND'),
    paymentCollected: z.boolean(),
    note: z.string().max(500).optional(),
  })
  .refine((value) => daysBetween(value.checkIn, value.checkOut) >= 1, {
    message: '`checkOut` phải sau `checkIn` ít nhất một đêm',
    path: ['checkOut'],
  });

/**
 * ACK của inbox OTA (§5.1): `202` khi đã ghi bền (`duplicate = false`), `200` khi trùng cùng hash
 * (`duplicate = true`). `eventId` giúp đối soát mà không phải đoán từ header.
 */
export const otaInboxAckSchema = z.object({
  duplicate: z.boolean(),
  eventId: z.string().min(1),
});

export type ChannelSyncScope = z.infer<typeof channelSyncScopeSchema>;
export type ChannelSyncRequest = z.infer<typeof channelSyncRequestSchema>;
export type ChannelMappingPutRequest = z.infer<typeof channelMappingPutRequestSchema>;
export type ChannelMapping = z.infer<typeof channelMappingSchema>;
export type ChannelMappingsView = z.infer<typeof channelMappingsViewSchema>;
export type SalesClosureEntry = z.infer<typeof salesClosureEntrySchema>;
export type SalesClosureRow = z.infer<typeof salesClosureRowSchema>;
export type SalesClosureView = z.infer<typeof salesClosureViewSchema>;
export type SalesClosureRequest = z.infer<typeof salesClosureRequestSchema>;
export type ChannelSyncHistoryEntry = z.infer<typeof channelSyncHistoryEntrySchema>;
export type ChannelSyncStatusView = z.infer<typeof channelSyncStatusViewSchema>;
export type OutboxDelivery = z.infer<typeof outboxDeliverySchema>;
export type OutboxDeliveriesQuery = z.infer<typeof outboxDeliveriesQuerySchema>;
export type OtaBooking = z.infer<typeof otaBookingSchema>;
export type OtaBookingsQuery = z.infer<typeof otaBookingsQuerySchema>;
export type OtaBookingFlagRequest = z.infer<typeof otaBookingFlagRequestSchema>;
export type OtaSimulatorChannel = z.infer<typeof otaSimulatorChannelSchema>;
export type OtaWebhookSignature = z.infer<typeof otaWebhookSignatureSchema>;
export type OtaWebhookHeaders = z.infer<typeof otaWebhookHeadersSchema>;
export type OtaWebhookEvent = z.infer<typeof otaWebhookEventSchema>;
export type OtaInboxAck = z.infer<typeof otaInboxAckSchema>;
