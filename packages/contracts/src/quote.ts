/** Hợp đồng QUOTE — api.md §2.4 (`POST /quotes`), §3.1; csdl §3 (quotes, price_snapshots). */
import { z } from 'zod';
import { businessDateSchema, isoUtcTimestampSchema } from './common.js';
import { channelCodeSchema, ratePlanCodeSchema } from './enums.js';

/** Hệ số một đêm theo đúng thứ tự pipeline động giá §2 (0,10–5,00). */
const multiplier = z.number().min(0.1).max(5);

/** `childAges[]` phải có đúng `children` phần tử khi khai (api.md §6.4). */
const childAgesSchema = z.array(z.number().int().min(0).max(17));

/**
 * `POST /quotes` — báo giá kỳ lưu trú; đầu vào độc lập, giá do máy chủ quyết (api.md §3.1).
 * Báo giá chưa giữ tồn; `quoteId` gắn principal + fingerprint để phát hiện lệch đầu vào (§3.1).
 */
export const quoteRequestSchema = z
  .strictObject({
    propertyId: z.string().min(1),
    roomTypeId: z.string().min(1),
    channelCode: channelCodeSchema,
    ratePlanCode: ratePlanCodeSchema,
    checkIn: businessDateSchema,
    checkOut: businessDateSchema,
    adults: z.number().int().min(1).max(20),
    children: z.number().int().min(0).max(20),
    childAges: childAgesSchema.optional(),
    roomCount: z.number().int().min(1).max(10),
    promotionCodes: z.array(z.string().min(1).max(40)).optional(),
  })
  .refine((value) => value.childAges === undefined || value.childAges.length === value.children, {
    message: '`childAges` phải có đúng `children` phần tử',
    path: ['childAges'],
  });

/** Một đêm báo giá trả **đủ** hệ số để web/Android/API đối chiếu cùng con số (api.md §3.1). */
export const quoteNightSchema = z.object({
  date: businessDateSchema,
  basePrice: z.number().int().positive(),
  seasonMultiplier: multiplier,
  weekendMultiplier: multiplier,
  occupancyMultiplier: multiplier,
  losMultiplier: multiplier,
  channelMultiplier: multiplier,
  clamped: z.boolean(),
  nightlyPrice: z.number().int().positive(),
});

/** Phản hồi `201`; trường lạ bỏ qua để client cũ đọc được server mới (api.md §7.1). */
export const quoteSchema = z.object({
  quoteId: z.string().min(1),
  channelCode: channelCodeSchema,
  ratePlanCode: ratePlanCodeSchema,
  checkIn: businessDateSchema,
  checkOut: businessDateSchema,
  nights: z.array(quoteNightSchema),
  /** Tiền VND nguyên (BR-GEN-01): tổng tạm tính, tổng giảm, tổng phải trả, tiền cọc. */
  subtotal: z.number().int().min(0),
  discountAmount: z.number().int().min(0),
  total: z.number().int().min(0),
  currency: z.literal('VND'),
  warnings: z.array(z.string()),
  depositPercent: z.number().int().min(0).max(100),
  depositAmount: z.number().int().min(0),
  engineVersion: z.string().min(1),
  quotedAt: isoUtcTimestampSchema,
  expiresAt: isoUtcTimestampSchema,
});

export type Quote = z.infer<typeof quoteSchema>;
export type QuoteRequest = z.infer<typeof quoteRequestSchema>;
export type QuoteNight = z.infer<typeof quoteNightSchema>;
