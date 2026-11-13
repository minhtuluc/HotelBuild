/** Hợp đồng PROP — api.md §2.2; csdl §3 (properties, room_types, rooms, room_blocks). */
import { z } from 'zod';
import { businessDateSchema } from './common.js';
import { propertyStatusSchema, roomBlockReasonSchema, roomStatusSchema } from './enums.js';

const clockTime = z.string().regex(/^\d{2}:\d{2}$/, 'Giờ phải có dạng HH:mm');

/**
 * HB-244: một ảnh công khai. Chưa có kho tệp (HB-138) nên `url` là URL `https://` tuyệt đối hoặc đường dẫn
 * tĩnh `/images/…` của web khách (cùng CHECK của csdl §3.2.10). `width`/`height` là kích thước thật (px)
 * để giao diện giữ tỉ lệ khung khi chưa tải xong ảnh.
 */
export const publicPhotoSchema = z.object({
  url: z
    .string()
    .max(2048)
    // Mỗi đoạn sau `/images/` không bắt đầu bằng `.` ⇒ chặn `..` và tệp ẩn (cùng CHECK csdl §3.2.10).
    .regex(
      /^(https:\/\/\S+|\/images\/([A-Za-z0-9_-][A-Za-z0-9._-]*\/)*[A-Za-z0-9_-][A-Za-z0-9._-]*)$/,
      'URL https:// hoặc đường dẫn /images/…',
    ),
  alt: z.string().trim().min(1).max(300),
  width: z.number().int().min(1).max(10000),
  height: z.number().int().min(1).max(10000),
});

/** `GET /properties/{id}/photos`, `GET /room-types/{id}/photos`: danh sách theo thứ tự + ETag cho `PUT`. */
export const photoListSchema = z.object({
  photos: z.array(publicPhotoSchema),
  /** Băm danh sách hiện tại; gửi lại trong `If-Match` khi thay (412 nếu đã đổi). */
  etag: z.string().min(1),
});

/** `PUT …/photos`: thay **cả** danh sách (tối đa 20, thứ tự mảng = thứ tự hiển thị); mảng rỗng = gỡ hết. */
export const photoReplaceRequestSchema = z.strictObject({
  photos: z.array(publicPhotoSchema.strict()).max(20),
  reason: z.string().trim().min(1).max(500),
});

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
  /** HB-244: ảnh cơ sở theo thứ tự hiển thị; optional để phản hồi cũ vẫn đọc được. */
  photos: z.array(publicPhotoSchema).optional(),
});

/**
 * HB-244: `GET /public/room-types/{roomTypeId}` — thông tin công khai của một loại phòng cho màn chi tiết
 * (SCR-03), kể cả khi chưa có báo giá. Chỉ loại phòng `ACTIVE` của cơ sở `ACTIVE`; còn lại 404.
 */
export const roomTypePublicSchema = z.object({
  id: z.string().min(1),
  propertyId: z.string().min(1),
  code: z.string().min(1),
  name: z.string().min(1).max(120),
  capacityAdults: z.number().int().min(1),
  capacityChildren: z.number().int().min(0),
  photos: z.array(publicPhotoSchema),
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
  /** Admin status, additive for HB033; legacy readers may omit it. */
  status: propertyStatusSchema.optional(),
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

/** HB033 additive admin commands; create has no If-Match (§1.3). */
export const roomTypeUpdateRequestSchema = z.strictObject({
  capacityAdults: z.number().int().min(1).max(20).optional(),
  capacityChildren: z.number().int().min(0).max(20).optional(),
  basePrice: z.number().int().positive().optional(),
  minPrice: z.number().int().positive().optional(),
  maxPrice: z.number().int().positive().optional(),
  status: propertyStatusSchema.optional(),
  reason: z.string().min(1).max(500),
});
export const roomCreateRequestSchema = z.strictObject({
  propertyId: z.string().min(1),
  roomTypeId: z.string().min(1),
  code: z.string().min(1).max(20),
  floor: z.number().int().min(-32768).max(32767),
  status: roomStatusSchema.optional(),
  note: z.string().min(1).max(500).optional(),
  reason: z.string().min(1).max(500).optional(),
});
export const roomUpdateRequestSchema = z.strictObject({
  floor: z.number().int().min(-32768).max(32767).optional(),
  status: roomStatusSchema.optional(),
  note: z.string().max(500).nullable().optional(),
  reason: z.string().min(1).max(500).optional(),
});
export type RoomTypeUpdateRequest = z.infer<typeof roomTypeUpdateRequestSchema>;
export type RoomCreateRequest = z.infer<typeof roomCreateRequestSchema>;
export type RoomUpdateRequest = z.infer<typeof roomUpdateRequestSchema>;

export type PublicPhoto = z.infer<typeof publicPhotoSchema>;
export type PhotoList = z.infer<typeof photoListSchema>;
export type PhotoReplaceRequest = z.infer<typeof photoReplaceRequestSchema>;
export type RoomTypePublic = z.infer<typeof roomTypePublicSchema>;
