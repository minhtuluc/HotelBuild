/** Hợp đồng PROP — api.md §2.2; csdl §3 (properties, room_types, rooms, room_blocks). */
import { z } from 'zod';
import { businessDateSchema } from './common.js';
import { propertyStatusSchema, roomBlockReasonSchema, roomStatusSchema } from './enums.js';

const clockTime = z.string().regex(/^\d{2}:\d{2}$/, 'Giờ phải có dạng HH:mm');

export const propertySummarySchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1).max(120),
  status: propertyStatusSchema,
  activeRoomCount: z.number().int().min(0),
  overbookLimitPct: z.number().int().min(0).max(100),
  checkInTime: clockTime,
  checkOutTime: clockTime,
  version: z.number().int().min(0),
});

/**
 * `GET /api/v1/public/properties` cho journey khách: **chỉ** trường công khai (mã, tên, giờ nhận/trả).
 * Không lộ số phòng, trần bán vượt, phiên bản hay cấu hình nội bộ (BR-PROP-01,02; api.md §2.14).
 */
export const propertyPublicSummarySchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1).max(120),
  checkInTime: clockTime,
  checkOutTime: clockTime,
});

/** `PATCH /properties/{propertyId}` — sửa cơ sở, đổi trần bán vượt và giờ nhận/trả (BR-OVER-01,02). */
export const propertyUpdateRequestSchema = z.strictObject({
  name: z.string().min(1).max(120).optional(),
  overbookLimitPct: z.number().int().min(0).max(100).optional(),
  checkInTime: clockTime.optional(),
  checkOutTime: clockTime.optional(),
  status: propertyStatusSchema.optional(),
  reason: z.string().min(1).max(500).optional(),
});

export const roomTypeCreateRequestSchema = z.strictObject({
  propertyId: z.string().min(1),
  code: z.string().min(1).max(20),
  capacityAdults: z.number().int().min(1).max(20),
  capacityChildren: z.number().int().min(0).max(20),
  /** Tiền VND nguyên (BR-GEN-01); sàn ≤ giá cơ bản ≤ trần (BR-RATE-03,04). */
  basePrice: z.number().int().positive(),
  minPrice: z.number().int().positive(),
  maxPrice: z.number().int().positive(),
  allowShared: z.boolean(),
  bedCount: z.number().int().min(1).max(20).optional(),
});

export const roomSummarySchema = z.object({
  id: z.string().min(1),
  propertyId: z.string().min(1),
  roomTypeId: z.string().min(1),
  code: z.string().min(1).max(20),
  floor: z.number().int(),
  status: roomStatusSchema,
  connectingRoomId: z.string().min(1).nullable(),
  version: z.number().int().min(0),
});

/** Gán/gỡ phòng thông nhau — đối xứng hai chiều (BR-OVER-15). */
export const connectingRoomRequestSchema = z.strictObject({
  connectingRoomId: z.string().min(1).nullable(),
});

export const roomBlockCreateRequestSchema = z.strictObject({
  roomId: z.string().min(1),
  startDate: businessDateSchema,
  endDate: businessDateSchema,
  reason: roomBlockReasonSchema,
  note: z.string().min(1).max(500).optional(),
});

export const roomTypeSummarySchema = z.object({
  id: z.string().min(1),
  propertyId: z.string().min(1),
  code: z.string().min(1).max(20),
  capacityAdults: z.number().int().min(1),
  capacityChildren: z.number().int().min(0),
  basePrice: z.number().int().positive(),
  minPrice: z.number().int().positive(),
  maxPrice: z.number().int().positive(),
  allowShared: z.boolean(),
  bedCount: z.number().int().min(1),
  /**
   * Số đơn vị bán **đang hoạt động** của loại phòng (DOR bán theo giường, BR-PROP-03) — dùng cho
   * hạn mức kênh: `allotment ≤ sellingUnits`, không giới hạn tổng các kênh (BR-INV-05, QĐ-05 mục 2).
   * **Tuỳ chọn**: hợp đồng F1 chưa chốt trường này, nên giao diện chỉ cảnh báo khi máy chủ trả số.
   */
  sellingUnits: z.number().int().min(0).optional(),
  version: z.number().int().min(0),
});

export const roomBlockSchema = z.object({
  id: z.string().min(1),
  roomId: z.string().min(1),
  startDate: businessDateSchema,
  endDate: businessDateSchema,
  reason: roomBlockReasonSchema,
  note: z.string().min(1).nullable(),
});

export type RoomTypeSummary = z.infer<typeof roomTypeSummarySchema>;
export type RoomBlock = z.infer<typeof roomBlockSchema>;

export type PropertySummary = z.infer<typeof propertySummarySchema>;
export type PropertyPublicSummary = z.infer<typeof propertyPublicSummarySchema>;
export type PropertyUpdateRequest = z.infer<typeof propertyUpdateRequestSchema>;
export type RoomTypeCreateRequest = z.infer<typeof roomTypeCreateRequestSchema>;
export type RoomSummary = z.infer<typeof roomSummarySchema>;
export type ConnectingRoomRequest = z.infer<typeof connectingRoomRequestSchema>;
export type RoomBlockCreateRequest = z.infer<typeof roomBlockCreateRequestSchema>;
