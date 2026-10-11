/** Hợp đồng INV — api.md §2.3; csdl §3 (channel_allotments). `inventory/availability` thuộc HB-070. */
import { z } from 'zod';
import { businessDateSchema } from './common.js';
import { channelCodeSchema } from './enums.js';

/** Số ngày giữa hai ngày `YYYY-MM-DD` (UTC) — dùng cho giới hạn khoảng lưới tồn. */
function daysBetween(from: string, to: string): number {
  const start = Date.parse(`${from}T00:00:00Z`);
  const end = Date.parse(`${to}T00:00:00Z`);
  return Math.round((end - start) / 86_400_000);
}

/** Lưới tồn theo ngày × loại phòng; trần 31 ngày để giữ payload gọn (NFR-PERF-05). */
export const inventoryGridQuerySchema = z
  .strictObject({
    propertyId: z.string().min(1),
    from: businessDateSchema,
    to: businessDateSchema,
    roomTypeId: z.string().min(1).optional(),
    channelCode: channelCodeSchema.optional(),
  })
  .refine((value) => daysBetween(value.from, value.to) >= 0, {
    message: '`to` phải không trước `from`',
    path: ['to'],
  })
  .refine((value) => daysBetween(value.from, value.to) <= 30, {
    message: 'Khoảng lưới tồn tối đa 31 ngày',
    path: ['to'],
  });

export const inventoryGridCellSchema = z.object({
  date: businessDateSchema,
  supply: z.number().int().min(0),
  demand: z.number().int().min(0),
  pool: z.number().int(),
  blocked: z.number().int().min(0),
  published: z.number().int().min(0).optional(),
  channelAvailable: z.number().int().min(0).optional(),
});

export const inventoryRoomTypeGridSchema = z.object({
  propertyId: z.string().min(1),
  roomTypeId: z.string().min(1),
  from: businessDateSchema,
  to: businessDateSchema,
  cells: z.array(inventoryGridCellSchema),
});

/** Root remains the first room type projection; grids includes every type when no filter is supplied. */
export const inventoryGridSchema = inventoryRoomTypeGridSchema.extend({
  grids: z.array(inventoryRoomTypeGridSchema).optional(),
});

export const allotmentQuerySchema = z.strictObject({
  channelId: z.string().min(1),
  roomTypeId: z.string().min(1),
  from: businessDateSchema,
  to: businessDateSchema,
});

export const allotmentRowSchema = z.object({
  date: businessDateSchema,
  allotment: z.number().int().min(0),
  used: z.number().int().min(0),
});

/** `PUT /channel-allotments` — đặt lại theo lô trong **một** transaction (BR-INV-05, BR-CHAN-01,06). */
export const allotmentPutRequestSchema = z.strictObject({
  channelId: z.string().min(1),
  roomTypeId: z.string().min(1),
  items: z
    .array(z.strictObject({ date: businessDateSchema, allotment: z.number().int().min(0) }))
    .min(1)
    .max(31),
  reason: z.string().min(1).max(500).optional(),
});

/**
 * `GET /inventory/availability` — tìm phòng trống (api.md §2.3, §3.8); **chỉ đọc**, không khoá phòng.
 * `availableCount` là min trên mọi đêm riêng biệt (BR-INV-07); `roomCount` vượt → `409 E_INV_NO_AVAILABILITY`.
 */
export const availabilityQuerySchema = z
  .strictObject({
    propertyId: z.string().min(1),
    roomTypeId: z.string().min(1).optional(),
    checkIn: businessDateSchema,
    checkOut: businessDateSchema,
    adults: z.coerce.number().int().min(1).max(20),
    children: z.coerce.number().int().min(0).max(20),
    roomCount: z.coerce.number().int().min(1).max(10),
    channelCode: channelCodeSchema.optional(),
    limit: z.coerce.number().int().min(1).max(100).default(20),
    cursor: z.string().min(1).optional(),
  })
  .refine((value) => daysBetween(value.checkIn, value.checkOut) >= 1, {
    message: '`checkOut` phải sau `checkIn` ít nhất một đêm',
    path: ['checkOut'],
  });

/** Một loại phòng còn chỗ cho cả kỳ; `availableCount` đã là min toàn kỳ (api.md §3.8). */
export const availabilityItemSchema = z.object({
  propertyId: z.string().min(1),
  roomTypeId: z.string().min(1),
  roomTypeCode: z.string().min(1),
  roomTypeName: z.string().min(1),
  capacityAdults: z.number().int().min(1),
  availableCount: z.number().int().min(0),
  soldOut: z.boolean(),
  minNights: z.number().int().min(1),
  maxNights: z.number().int().min(1),
  nightlyFrom: z.number().int().positive(),
  totalFrom: z.number().int().positive(),
});

/** Phản hồi `200`: kỳ, số đêm và danh sách loại phòng kèm phân trang con trỏ (api.md §3.8). */
export const availabilitySchema = z.object({
  checkIn: businessDateSchema,
  checkOut: businessDateSchema,
  nights: z.number().int().min(1),
  channelCode: channelCodeSchema.optional(),
  data: z.array(availabilityItemSchema),
  // Ví dụ api.md §3.8 chỉ khai limit/nextCursor/hasMore; `total` là tuỳ chọn để khớp tài liệu.
  meta: z.strictObject({
    limit: z.number().int().min(1).max(100),
    nextCursor: z.string().nullable(),
    hasMore: z.boolean(),
    total: z.number().int().min(0).optional(),
  }),
});

export type InventoryRoomTypeGrid = z.infer<typeof inventoryRoomTypeGridSchema>;
export type InventoryGrid = z.infer<typeof inventoryGridSchema>;
export type AllotmentRow = z.infer<typeof allotmentRowSchema>;
export type AllotmentPutRequest = z.infer<typeof allotmentPutRequestSchema>;
export type Availability = z.infer<typeof availabilitySchema>;
export type AvailabilityItem = z.infer<typeof availabilityItemSchema>;
