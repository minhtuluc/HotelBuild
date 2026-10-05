/**
 * Hợp đồng chốt đối soát ngày — api.md §2.13; HB-140.
 * Chốt theo **(người thu, ngày nghiệp vụ giờ VN)**; chênh lệch vượt ngưỡng phải báo MANAGER (BR-PAY-06,10).
 * Lệnh 🔒: `pinToken` do client chèn (QĐ-01 mục 6); mọi lệnh ghi có `Idempotency-Key`.
 */
import { z } from 'zod';
import { businessDateSchema, isoUtcTimestampSchema } from './common.js';

export const reconciliationCloseRequestSchema = z.strictObject({
  propertyId: z.string().min(1),
  businessDate: businessDateSchema,
  /** Tiền mặt đếm thực tế (VND nguyên, ≥ 0). */
  countedCash: z.number().int().min(0),
  note: z.string().max(500).optional(),
  pinToken: z.string().min(16).optional(),
});

export const reconciliationCloseResponseSchema = z.object({
  propertyId: z.string().min(1),
  businessDate: businessDateSchema,
  expectedCash: z.number().int(),
  countedCash: z.number().int().min(0),
  /** `countedCash − expectedCash`; âm là thiếu, dương là thừa. */
  difference: z.number().int(),
  /** Chênh lệch vượt ngưỡng ⇒ đã thông báo MANAGER (BR-PAY-10). */
  managerNotified: z.boolean(),
  auditLogId: z.string().min(1),
  closedAt: isoUtcTimestampSchema,
});

export type ReconciliationCloseRequest = z.infer<typeof reconciliationCloseRequestSchema>;
export type ReconciliationCloseResponse = z.infer<typeof reconciliationCloseResponseSchema>;
