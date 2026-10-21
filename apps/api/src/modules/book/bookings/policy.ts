/**
 * Bản chính sách huỷ **đã chốt** cho `price_snapshots.policy_snapshot_json` (HB-077 AC1; ADR-015 §4,6;
 * BR-RATE-16, BR-CANCEL-01).
 *
 * Vì sao phải chụp bản policy vào booking: `CancelBookingUseCase` (HB-097) chọn bậc hoàn từ **snapshot**
 * chứ không đọc cấu hình hiện tại (`book/cancel/context.ts#loadSnapshot`), nên hình dạng dưới đây là
 * hợp đồng giữa hai module: `{ id, tiers[] }` với mỗi bậc `{ id, offsetHours, refundPercent,
 * chargeFirstNight }` và `refundPercent` là **số nguyên 0..100**.
 *
 * Cấu hình không biểu diễn được (không có bậc nào, tỷ lệ lẻ như 50,5%) bị **từ chối ngay lúc chốt
 * snapshot** thay vì để booking sống rồi hỏng ở bước huỷ — cùng cách HB-074 xử lý `depositPercent`.
 */
import type { Prisma as PrismaTypes } from '@prisma/client';
import { configuration } from '../../rate/calendar/support.js';

type Tx = PrismaTypes.TransactionClient;

export interface PolicyTier {
  readonly id: string;
  readonly offsetHours: number;
  readonly refundPercent: number;
  readonly chargeFirstNight: boolean;
}

export interface PolicySnapshot {
  readonly id: string;
  readonly code: string;
  readonly name: string;
  /** BR-CANCEL-09: số giờ báo trước tối thiểu; `null` = gói không hoàn (NONREF). */
  readonly earlyCheckoutFreeHours?: number | null;
  /** BR-CANCEL-09: tỷ lệ hoàn phần đêm chưa ở (0..100, số nguyên). */
  readonly earlyCheckoutRefundPct?: number;
  readonly tiers: readonly PolicyTier[];
}

/** Policy của gói giá đã chốt, kèm **mọi** bậc; sai cấu hình ⇒ `422 E_RATE_CONFIGURATION_INVALID`. */
export async function loadPolicySnapshot(tx: Tx, policyId: string): Promise<PolicySnapshot> {
  const policy = await tx.cancellation_policies.findUnique({
    where: { id: policyId },
    select: {
      id: true,
      code: true,
      name: true,
      early_checkout_free_hours: true,
      early_checkout_refund_pct: true,
    },
  });
  if (policy === null) configuration('ratePlan.cancellationPolicyId', 'missing');
  const earlyCheckoutFreeHours = policy.early_checkout_free_hours;
  if (
    earlyCheckoutFreeHours !== null &&
    (!Number.isInteger(earlyCheckoutFreeHours) || earlyCheckoutFreeHours < 0)
  )
    configuration('cancellationPolicy.earlyCheckoutFreeHours', 'invalid');
  const earlyCheckoutRefundPct = Number(policy.early_checkout_refund_pct);
  if (
    !Number.isInteger(earlyCheckoutRefundPct) ||
    earlyCheckoutRefundPct < 0 ||
    earlyCheckoutRefundPct > 100
  )
    configuration('cancellationPolicy.earlyCheckoutRefundPct', 'not-integer');
  const tiers = await tx.cancellation_tiers.findMany({
    where: { policy_id: policyId },
    orderBy: { sort_order: 'asc' },
    select: { id: true, offset_hours: true, refund_percent: true, charge_first_night: true },
  });
  if (tiers.length === 0) configuration('cancellationPolicy.tiers', 'empty');
  const snapshot: PolicyTier[] = tiers.map((tier) => {
    const refundPercent = Number(tier.refund_percent);
    if (!Number.isInteger(refundPercent) || refundPercent < 0 || refundPercent > 100)
      configuration('cancellationPolicy.tiers.refundPercent', 'not-integer');
    return {
      id: tier.id,
      offsetHours: tier.offset_hours,
      refundPercent,
      chargeFirstNight: tier.charge_first_night,
    };
  });
  return {
    id: policy.id,
    code: policy.code,
    name: policy.name,
    earlyCheckoutFreeHours,
    earlyCheckoutRefundPct,
    tiers: snapshot,
  };
}
