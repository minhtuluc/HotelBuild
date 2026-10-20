/**
 * Hợp đồng lệnh walk-in (HB-151; UC-BOOK-02, FR-BOOK-02; api.md §2.5, §3.2).
 *
 * Một lệnh cho lễ tân gộp báo giá → đặt phòng trên kênh cấu hình `WALKIN`; bước thu cọc kế tiếp là
 * `POST /payments` (HB-096). Thân lệnh **không** có `channelCode` — kênh do cấu hình quyết
 * (BR-RATE-07). Hình dạng dùng lại `guestContactSchema`/`quoteSchema`/`bookingSummarySchema` đã phát
 * hành, không khai lại.
 */
import { z } from 'zod';
import { bookingSummarySchema, guestContactSchema } from './booking.js';
import { businessDateSchema } from './common.js';
import { ratePlanCodeSchema } from './enums.js';
import { quoteSchema } from './quote.js';

const childAgesSchema = z.array(z.number().int().min(0).max(17));

/** `POST /api/v1/walk-in` — strict: trường lạ (kể cả `channelCode`) là lệnh hỏng. */
export const walkInRequestSchema = z
  .strictObject({
    propertyId: z.string().min(1),
    roomTypeId: z.string().min(1),
    ratePlanCode: ratePlanCodeSchema,
    checkIn: businessDateSchema,
    checkOut: businessDateSchema,
    adults: z.number().int().min(1).max(20),
    children: z.number().int().min(0).max(20),
    childAges: childAgesSchema.optional(),
    roomCount: z.number().int().min(1).max(10),
    promotionCodes: z.array(z.string().min(1).max(40)).optional(),
    guest: guestContactSchema,
    note: z.string().max(500).optional(),
  })
  .refine((value) => value.childAges === undefined || value.childAges.length === value.children, {
    message: '`childAges` phải có đúng `children` phần tử',
    path: ['childAges'],
  });

/**
 * Phản hồi `201` (hoặc `200` khi BR-BOOK-16 trả booking đã có): quote đã phát hành, booking, và cờ
 * `created` để giao diện phân biệt nhánh nghi trùng.
 */
export const walkInResultSchema = z.object({
  created: z.boolean(),
  quote: quoteSchema,
  booking: bookingSummarySchema,
});

export type WalkInRequest = z.infer<typeof walkInRequestSchema>;
export type WalkInResult = z.infer<typeof walkInResultSchema>;
