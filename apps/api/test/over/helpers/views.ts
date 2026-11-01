/**
 * Oracle hình dạng phản hồi OVER của HB-124 (đặc tả trước HB-120/HB-125).
 *
 * Hợp đồng OVER chưa được công bố trong `@pinehill/contracts`; bộ test khoá đọc đúng các trường
 * tối thiểu mà quyết định F6-D01…D06 đòi hỏi. Schema để ở đây để bốn tệp spec dùng chung một Oracle,
 * không tự viết lại theo từng ca.
 */
import { z } from 'zod';

const money = z.number().int().min(0);

export const moveStatusSchema = z.enum([
  'PROPOSED',
  'APPROVED',
  'EXECUTED',
  'REJECTED',
  'CANCELLED',
]);
export const mergeStatusSchema = z.enum(['PENDING_CONSENT', 'APPROVED', 'ACTIVE', 'CANCELLED']);

/** `POST /room-moves` và `GET /room-moves/{id}` (api.md §3.10, HB-120 AC6/AC12). */
export const moveViewSchema = z.object({
  id: z.string().min(1),
  status: moveStatusSchema,
  priceLocked: z.literal(true),
  fromRoomId: z.string().nullable().optional(),
  toRoomId: z.string().nullable().optional(),
  compensationAmount: money,
  transportCost: money,
  approvedBy: z.string().nullable().optional(),
  version: z.number().int().positive().optional(),
  /** Chỉ có ở route đọc: bước kế tiếp mà người gọi được phép thực hiện. */
  allowedActions: z.array(z.string()).optional(),
  /** ID operation bền để tra lại sau timeout (HB-120 AC12). */
  operationId: z.string().min(1).optional(),
});

/** `POST /room-merges` và `GET /room-merges/{id}` (F6-D01: connecting là một booking). */
export const mergeViewSchema = z.object({
  id: z.string().min(1),
  status: mergeStatusSchema,
  discountPct: z.number().min(0).max(100),
  discountAmount: money,
  consentPrimary: z.boolean().optional(),
  consentSecondary: z.boolean().optional(),
  /** F6-D01: connecting dùng `bookingId` + hai `roomId`; cột này phải NULL với connecting. */
  secondaryBookingId: z.string().nullable().optional(),
  secondaryRoomId: z.string().nullable().optional(),
  version: z.number().int().positive().optional(),
  allowedActions: z.array(z.string()).optional(),
  operationId: z.string().min(1).optional(),
});

/** `POST/GET /room-moves/{roomMoveId}/compensation-payments` (F6-D06, HB-120 AC13). */
export const compensationViewSchema = z.object({
  paymentId: z.string().min(1),
  operationId: z.string().min(1),
  amount: money,
  method: z.enum(['CASH', 'BANK_TRANSFER']),
  status: z.enum(['PENDING', 'SUCCEEDED', 'UNKNOWN', 'FAILED']),
});

export type MoveView = z.infer<typeof moveViewSchema>;
export type MergeView = z.infer<typeof mergeViewSchema>;
export type CompensationView = z.infer<typeof compensationViewSchema>;
