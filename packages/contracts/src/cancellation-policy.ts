/** Hợp đồng gói giá & chính sách huỷ — api.md §2.4; ADR-015 (snapshot bất biến). */
import { z } from 'zod';

const percent = z.number().min(0).max(100);

/** Một bậc huỷ là **dữ liệu** (BR-CANCEL-01); mốc giờ ≥ 0, phần trăm 0–100. */
export const cancellationTierSchema = z.object({
  hoursBeforeCheckIn: z.number().int().min(0),
  refundPercent: percent,
  label: z.string().min(1).max(60).optional(),
});

export const cancellationPolicySchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1).max(120),
  status: z.enum(['ACTIVE', 'INACTIVE']),
  tiers: z.array(cancellationTierSchema).min(1),
  earlyCheckoutFreeHours: z.number().int().min(0),
  earlyCheckoutRefundPct: percent,
  version: z.number().int().min(0),
});

/** `PUT /cancellation-policies/{policyId}` nhận **toàn bộ** danh sách bậc trong một transaction (BR-CANCEL-02). */
export const cancellationPolicyUpdateRequestSchema = z.strictObject({
  tiers: z.array(cancellationTierSchema).min(1),
  earlyCheckoutFreeHours: z.number().int().min(0),
  earlyCheckoutRefundPct: percent,
  reason: z.string().min(1).max(500),
});

export type CancellationTier = z.infer<typeof cancellationTierSchema>;
export type CancellationPolicy = z.infer<typeof cancellationPolicySchema>;
export type CancellationPolicyUpdateRequest = z.infer<typeof cancellationPolicyUpdateRequestSchema>;
