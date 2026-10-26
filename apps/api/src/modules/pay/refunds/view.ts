/** Dựng hợp đồng trả về của hồ sơ hoàn (api.md §2.6, HB-110 read facts): tính hết ở server. */
import { refundRequestSchema, type RefundRequest } from '@pinehill/contracts';
import {
  MANUAL_TRANSFER_AWAITING_CONFIRMATION,
  settlementNet,
  thresholdAmount,
  type RefundRow,
  type Tx,
} from './writes.js';
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

/** Sự kiện tính sẵn cho một hồ sơ: nguồn giữ, NET toàn sự kiện và ngưỡng kiểm soát. */
interface ViewFacts {
  readonly paymentId: string;
  readonly eventNet: bigint;
  readonly threshold: bigint;
  /** HB-215: có leg chuyển khoản tay chờ kế toán xác nhận. */
  readonly awaitingTransfer: boolean;
}

/**
 * HB-215 — một truy vấn cho **cả trang**: hồ sơ nào có operation `UNKNOWN` mang mã chờ xác nhận
 * chuyển khoản tay. Không N+1 ở danh sách; cờ chỉ đúng khi hồ sơ còn `APPROVED` (do `render` quyết).
 */
async function awaitingTransfers(tx: Tx, ids: readonly string[]): Promise<Set<string>> {
  if (ids.length === 0) return new Set();
  const rows = await tx.$queryRaw<{ refund_request_id: string }[]>`
    SELECT DISTINCT refund_request_id FROM refund_payout_operations
     WHERE refund_request_id = ANY(${ids}::uuid[]) AND status = 'UNKNOWN'
       AND last_error = ${MANUAL_TRANSFER_AWAITING_CONFIRMATION}`;
  return new Set(rows.map((row) => row.refund_request_id));
}

/**
 * Hợp đồng đòi `paymentId`/`appliedTierId`/`requestedBy` khác rỗng nên nguồn giữ đầu tiên và token
 * bậc (vì `applied_tier_id` rỗng cho quyết định ngoài bảng bậc) được chọn như hàm trên; thiếu dữ
 * liệu là hồ sơ lỗi → `E_GEN_NOT_FOUND`, không tự chế giá trị tiền.
 */
function render(row: RefundRow, facts: ViewFacts): RefundRequest {
  return refundRequestSchema.parse({
    id: row.id,
    bookingId: row.booking_id,
    paymentId: facts.paymentId,
    policyId: row.policy_id,
    hoursBeforeCheckIn: Math.round(Number(row.hours_before_check_in) * 100) / 100,
    appliedTierId: tierToken(row),
    refundPercent: Math.round(Number(row.refund_percent)),
    requestedAmount: vnd(row.requested_amount),
    approvedAmount: row.approved_amount === null ? null : vnd(row.approved_amount),
    refundFee: vnd(row.refund_fee),
    netRefund: vnd(row.net_refund),
    eventNetRefund: vnd(facts.eventNet),
    requiresThresholdControl: facts.eventNet > facts.threshold,
    awaitingTransferConfirmation: row.status === 'APPROVED' && facts.awaitingTransfer,
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

/** Một hồ sơ: bốn lượt đọc (nguồn giữ, NET toàn sự kiện, ngưỡng, leg chờ xác nhận) rồi dựng hợp đồng. */
export async function requestView(tx: Tx, row: RefundRow): Promise<RefundRequest> {
  const [paymentId, eventNet, threshold, transfers] = await Promise.all([
    sourcePayment(tx, row),
    settlementNet(tx, row.booking_id),
    thresholdAmount(tx),
    awaitingTransfers(tx, [row.id]),
  ]);
  if (!paymentId) throw refundError('missing');
  return render(row, {
    paymentId,
    eventNet,
    threshold,
    awaitingTransfer: transfers.has(row.id),
  });
}

/**
 * Cùng projection cho cả trang danh sách (HB-213): gom NET theo booking và nguồn giữ theo lô để
 * không N+1. Trường trả về **không** khác `requestView` vì UI decode cùng `refundRequestSchema`.
 */
export async function requestViews(tx: Tx, rows: readonly RefundRow[]): Promise<RefundRequest[]> {
  if (rows.length === 0) return [];
  const bookingIds = [...new Set(rows.map((row) => row.booking_id))];
  const missing = rows.filter((row) => !row.payment_id).map((row) => row.id);
  const threshold = await thresholdAmount(tx);
  // Một truy vấn cho cả trang (HB-215) — không N+1 trên danh sách SCR-38.
  const transfers = await awaitingTransfers(
    tx,
    rows.map((row) => row.id),
  );
  const settlement = await tx.refund_requests.groupBy({
    by: ['booking_id'],
    where: { booking_id: { in: bookingIds }, status: { in: ['PENDING', 'APPROVED', 'PAID'] } },
    _sum: { net_refund: true },
  });
  const legs =
    missing.length === 0
      ? []
      : await tx.refund_allocations.findMany({
          where: { refund_request_id: { in: missing } },
          orderBy: [{ refund_request_id: 'asc' }, { id: 'asc' }],
          select: { refund_request_id: true, original_payment_id: true },
        });
  const nets = new Map(settlement.map((row) => [row.booking_id, row._sum.net_refund ?? 0n]));
  // Hồ sơ nhiều nguồn: nguồn giữ **đầu tiên** (id nhỏ nhất) là nguồn gốc, giống `sourcePayment`.
  const sources = new Map<string, string>();
  for (const leg of legs)
    if (!sources.has(leg.refund_request_id))
      sources.set(leg.refund_request_id, leg.original_payment_id);
  return rows.map((row) => {
    const paymentId = row.payment_id ?? sources.get(row.id);
    if (!paymentId) throw refundError('missing');
    return render(row, {
      paymentId,
      eventNet: nets.get(row.booking_id) ?? 0n,
      threshold,
      awaitingTransfer: transfers.has(row.id),
    });
  });
}

/** Thời hạn chi (BR-CANCEL-12): tối đa 7 ngày kể từ khi duyệt (cam kết xử lý trong 3 ngày làm việc). */
export function payoutDeadline(now: Date): string {
  return new Date(now.getTime() + 7 * DAY).toISOString();
}
