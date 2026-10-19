/** Dựng hợp đồng trả về của hồ sơ hoàn (api.md §2.6, HB-110 read facts): tính hết ở server. */
import { refundRequestSchema, type RefundRequest } from '@pinehill/contracts';
import { settlementNet, thresholdAmount, type RefundRow, type Tx } from './writes.js';
import { refundError } from './validation.js';

const DAY = 24 * 3_600_000;

/** Số nguyên VND an toàn cho hợp đồng JSON (api.md §4.2: tiền là number nguyên). */
export function vnd(value: bigint): number {
  if (value > BigInt(Number.MAX_SAFE_INTEGER))
    throw refundError('invalid', 'Số tiền vượt giới hạn an toàn.');
  return Number(value);
}

/** `applied_tier_id` rỗng nghĩa là quyết định ngoài bảng bậc (bất khả kháng/chưa xác nhận). */
function tierToken(row: RefundRow): string {
  if (row.applied_tier_id) return row.applied_tier_id;
  return row.is_force_majeure ? 'FORCE_MAJEURE' : 'PRECONFIRMATION';
}

/** Trường hợp `payment_id` rỗng: hồ sơ hoàn nhiều nguồn — lấy nguồn giữ đầu tiên làm nguồn gốc. */
async function sourcePayment(tx: Tx, row: RefundRow): Promise<string | null> {
  if (row.payment_id) return row.payment_id;
  const first = await tx.refund_allocations.findFirst({
    where: { refund_request_id: row.id },
    orderBy: { id: 'asc' },
    select: { original_payment_id: true },
  });
  return first?.original_payment_id ?? null;
}

/**
 * Hợp đồng đòi `paymentId`/`appliedTierId`/`requestedBy` khác rỗng nên nguồn giữ đầu tiên và token
 * bậc (vì `applied_tier_id` rỗng cho quyết định ngoài bảng bậc) được chọn như hàm trên; thiếu dữ
 * liệu là hồ sơ lỗi → `E_GEN_NOT_FOUND`, không tự chế giá trị tiền.
 */
export async function requestView(tx: Tx, row: RefundRow): Promise<RefundRequest> {
  const [paymentId, eventNet, threshold] = await Promise.all([
    sourcePayment(tx, row),
    settlementNet(tx, row.booking_id),
    thresholdAmount(tx),
  ]);
  if (!paymentId) throw refundError('missing');
  return refundRequestSchema.parse({
    id: row.id,
    bookingId: row.booking_id,
    paymentId,
    policyId: row.policy_id,
    hoursBeforeCheckIn: Math.round(Number(row.hours_before_check_in) * 100) / 100,
    appliedTierId: tierToken(row),
    refundPercent: Math.round(Number(row.refund_percent)),
    requestedAmount: vnd(row.requested_amount),
    approvedAmount: row.approved_amount === null ? null : vnd(row.approved_amount),
    refundFee: vnd(row.refund_fee),
    netRefund: vnd(row.net_refund),
    eventNetRefund: vnd(eventNet),
    requiresThresholdControl: eventNet > threshold,
    status: row.status,
    isForceMajeure: row.is_force_majeure,
    reason: row.reason,
    evidenceRefs: row.evidence_refs,
    requestedBy: row.requested_by ?? row.requester_id,
    approvedBy: row.approved_by,
    decidedAt: row.decided_at?.toISOString() ?? null,
    paidAt: row.paid_at?.toISOString() ?? null,
    createdAt: row.created_at.toISOString(),
  });
}

/** Thời hạn chi (BR-CANCEL-12): tối đa 7 ngày kể từ khi duyệt (cam kết xử lý trong 3 ngày làm việc). */
export function payoutDeadline(now: Date): string {
  return new Date(now.getTime() + 7 * DAY).toISOString();
}
