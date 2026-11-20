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
  /**
   * HB-262: người thu được đối soát (`users.id`). Kế toán chốt quỹ của **lễ tân đã thu**; vắng thì là chính
   * người chốt (tương thích HB-150).
   */
  collectorId: z.string().uuid().optional(),
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

/** `GET /reconciliation/daily` (HB-262, SCR-68): tổng tiền mặt theo người thu trong một ngày VN. */
export const reconciliationDailyQuerySchema = z.strictObject({
  propertyId: z.string().uuid(),
  businessDate: businessDateSchema,
});

export const reconciliationCollectorSchema = z.object({
  collectorId: z.string().min(1),
  collectorName: z.string().min(1),
  /** Số khoản thu tiền mặt `SUCCEEDED` của người thu trong ngày VN tại cơ sở. */
  cashReceiptCount: z.number().int().min(0),
  /** Tổng tiền mặt phải có theo sổ cái (cùng phép tính của lệnh chốt). */
  expectedCash: z.number().int(),
  /** Đã chốt: số đếm thực tế, chênh lệch, đã báo MANAGER; `null` khi chưa chốt. */
  closed: z
    .object({
      countedCash: z.number().int().min(0),
      difference: z.number().int(),
      managerNotified: z.boolean(),
      closedAt: isoUtcTimestampSchema,
    })
    .nullable(),
});

export const reconciliationDailySchema = z.object({
  propertyId: z.string().min(1),
  businessDate: businessDateSchema,
  collectors: z.array(reconciliationCollectorSchema),
});

export type ReconciliationDailyQuery = z.infer<typeof reconciliationDailyQuerySchema>;
export type ReconciliationCollector = z.infer<typeof reconciliationCollectorSchema>;
export type ReconciliationDaily = z.infer<typeof reconciliationDailySchema>;
