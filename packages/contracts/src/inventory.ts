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
  .refine((value) => daysBetween(value.from, value.to) <= 31, {
    message: 'Khoảng lưới tồn tối đa 31 ngày',
    path: ['to'],
  });

export const inventoryGridCellSchema = z.object({
  date: businessDateSchema,
  supply: z.number().int().min(0),
  demand: z.number().int().min(0),
  pool: z.number().int(),
  blocked: z.number().int().min(0),
});

export const inventoryGridSchema = z.object({
  propertyId: z.string().min(1),
  roomTypeId: z.string().min(1),
  from: businessDateSchema,
  to: businessDateSchema,
  cells: z.array(inventoryGridCellSchema),
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

export type InventoryGrid = z.infer<typeof inventoryGridSchema>;
export type AllotmentRow = z.infer<typeof allotmentRowSchema>;
export type AllotmentPutRequest = z.infer<typeof allotmentPutRequestSchema>;
