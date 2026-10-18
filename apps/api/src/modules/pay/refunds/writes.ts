/** Ghi trạng thái hồ sơ hoàn (HB-099). Tất cả lệnh chạy **trong transaction của caller**. */
import { Prisma } from '@prisma/client';
import type { Prisma as PrismaTypes } from '@prisma/client';
import { DomainError } from '@pinehill/domain';
import type { AuthorizedActor } from '../../../common/actor/authorized-actor.js';
import { AppError } from '../../../common/app-error.js';
import { RetryTransaction } from '../../../common/idempotency/transaction-retry.js';
import { LedgerError } from '../ledger/projection.js';
import type { CancelDecision } from '../../book/cancel/context.js';
import { refundError } from './validation.js';

export type Tx = PrismaTypes.TransactionClient;

/** `SELECT *` trên `refund_requests`; cột `numeric` được đổi kiểu số trước khi trả hợp đồng. */
export interface RefundRow {
  id: string;
  booking_id: string;
  version: bigint;
  status: string;
  payment_id: string | null;
  policy_id: string;
  applied_tier_id: string | null;
  hours_before_check_in: number;
  refund_percent: number;
  requested_amount: bigint;
  approved_amount: bigint | null;
  refund_fee: bigint;
  net_refund: bigint;
  is_force_majeure: boolean;
  evidence_refs: string[];
  reason: string;
  requested_by: string | null;
  requester_type: string;
  requester_id: string;
  approved_by: string | null;
  decided_at: Date | null;
  paid_at: Date | null;
  created_at: Date;
}

/** BR-CANCEL-17: các mã này nghĩa là hạn mức hoàn vượt tiền thực thu đủ điều kiện. */
const overPaid = ['LEDGER_SOURCE_CAP', 'LEDGER_BOOKING_CAP', 'LEDGER_REFUND_NET'];

function prismaFailure(error: Prisma.PrismaClientKnownRequestError): AppError | RetryTransaction {
  const raw = String(error.meta?.code ?? '');
  // Khoá trễ/deadlock là lỗi hạ tầng tạm thời; còn ràng buộc/trigger từ chối là dữ liệu đã đổi.
  if (
    error.code === 'P2034' ||
    (error.code === 'P2010' && ['55P03', '40P01', '40001'].includes(raw))
  )
    return new RetryTransaction(
      new AppError(409, 'E_SYS_REQUEST_IN_PROGRESS', 'Hồ sơ hoàn đang được cập nhật.', 1),
    );
  return refundError('invalid', 'Dữ liệu hoàn tiền đã thay đổi; hãy tải lại và thử lại.');
}

/** Đổi lỗi hạ tầng thành lỗi hợp đồng; lỗi chưa biết thì ném tiếp cho filter. */
export function refundFailure(error: unknown): never {
  if (error instanceof AppError || error instanceof RetryTransaction) throw error;
  if (error instanceof LedgerError)
    throw overPaid.includes(error.reason)
      ? refundError('exceedsPaid')
      : refundError('notEligible', 'Sổ tiền của booking không cho phép giữ hạn mức này.');
  if (error instanceof DomainError)
    throw refundError('notEligible', 'Không tính được quyền hoàn theo chính sách đã chốt.');
  if (error instanceof Prisma.PrismaClientKnownRequestError) throw prismaFailure(error);
  throw error;
}

/** Khoá hồ sơ bằng `FOR UPDATE` sau khi `loadLocked` đã khoá booking/payment/refund cùng booking. */
export async function lockRefund(tx: Tx, refundId: string): Promise<RefundRow> {
  const rows = await tx.$queryRaw<RefundRow[]>`
    SELECT * FROM refund_requests WHERE id = ${refundId}::uuid FOR UPDATE`;
  if (!rows.length) throw refundError('missing');
  return rows[0]!;
}

/** `event_key` ghép nguồn thu + khoá chống trùng: hai yêu cầu cùng nguồn vẫn tạo được hai hồ sơ. */
export function eventKeyOf(paymentId: string, key: string): string {
  return `refund-request:${paymentId}:${key}`;
}

export async function insertRequest(
  tx: Tx,
  bookingId: string,
  eventKey: string,
  decision: CancelDecision,
  input: { paymentId: string; reason: string; isForceMajeure: boolean; evidenceRefs?: string[] },
  actor: AuthorizedActor,
  now: Date,
): Promise<string> {
  const rows = await tx.$queryRaw<{ id: string }[]>`
    INSERT INTO refund_requests(booking_id, event_key, payment_id, policy_id, hours_before_check_in,
      applied_tier_id, refund_percent, requested_amount, refund_fee, status, is_force_majeure,
      evidence_refs, reason, requested_by, requester_type, requester_id, created_at, updated_at)
    VALUES(${bookingId}::uuid, ${eventKey}, ${input.paymentId}::uuid, ${decision.policyId}::uuid,
      ${decision.hours.toFixed(2)}::numeric, ${decision.tierId}::uuid, ${decision.refundPercent}::numeric,
      ${decision.requested}, ${decision.fee}, 'PENDING', ${input.isForceMajeure},
      ${input.evidenceRefs ?? []}::text[], ${input.reason}, ${actor.id}::uuid, 'USER', ${actor.id},
      ${now}::timestamptz, ${now}::timestamptz)
    RETURNING id`;
  return rows[0]!.id;
}

/** NET của toàn sự kiện hoàn (BR-CANCEL-15): tổng NET của mọi hồ sơ chưa kết thúc/đã chi. */
export async function settlementNet(tx: Tx, bookingId: string): Promise<bigint> {
  const rows = await tx.$queryRaw<{ net: bigint }[]>`
    SELECT coalesce(sum(net_refund),0)::bigint AS net FROM refund_requests
     WHERE booking_id = ${bookingId}::uuid AND status IN ('PENDING','APPROVED','PAID')`;
  return BigInt(rows[0]!.net);
}

/** Ngưỡng kiểm soát lớn (`deal.threshold.minor`, BR-SYS-02) — không hardcode ở tầng chữ. */
export async function thresholdAmount(tx: Tx): Promise<bigint> {
  const row = await tx.system_settings.findUnique({
    where: { key: 'deal.threshold.minor' },
    select: { value: true },
  });
  const threshold = BigInt(row?.value ?? '5000000');
  return threshold < 0n ? 5000000n : threshold;
}

export async function auditLogId(tx: Tx, refundId: string, action: string): Promise<string> {
  const row = await tx.audit_logs.findFirst({
    where: { entity_type: 'RefundRequest', entity_id: refundId, action },
    orderBy: { chain_seq: 'desc' },
    select: { id: true },
  });
  if (!row) throw refundError('forbidden', 'Không ghi được nhật ký duyệt hoàn.');
  return row.id;
}

/**
 * Chuẩn hoá hạn mức đã giữ sang NET của quyết định duyệt (BR-CANCEL-17: "trả phần giảm NET").
 * Chỉ diễn ra khi hồ sơ **còn PENDING** nên trigger `refund_allocations` vẫn cho sửa; giảm xuống
 * dưới số dòng đã giữ nghĩa là quyết định không phân bổ nổi — trả `E_PAY_AMOUNT_MISMATCH`.
 */
export async function reallocate(tx: Tx, requestId: string, net: bigint, now: Date): Promise<void> {
  const legs = await tx.refund_allocations.findMany({
    where: { refund_request_id: requestId },
    orderBy: { id: 'asc' },
    select: { id: true, amount: true },
  });
  const total = legs.reduce((sum, leg) => sum + leg.amount, 0n);
  if (net <= 0n || total <= net) return;
  let left = net;
  const next = legs.map((leg, index) => {
    const amount = index + 1 < legs.length ? (net * leg.amount) / total : left;
    left -= amount;
    return { ...leg, amount };
  });
  for (const leg of next) {
    if (leg.amount <= 0n) throw refundError('amountMismatch', 'Số duyệt quá nhỏ so với nguồn giữ.');
    await tx.$executeRaw`
      UPDATE refund_allocations SET amount = ${leg.amount}, updated_at = ${now}::timestamptz
       WHERE id = ${leg.id}::uuid AND amount <> ${leg.amount}`;
  }
}

/** Ghi quyết định hai cấp vào `refund_approvals` rồi mới đổi trạng thái (trigger bắt buộc bảng này). */
export async function recordDecision(
  tx: Tx,
  row: RefundRow,
  actor: { id: string; role: string },
  decision: 'APPROVED' | 'REJECTED',
  approvedAmount: bigint,
  reason: string,
  now: Date,
): Promise<void> {
  await tx.$queryRaw`
    INSERT INTO refund_approvals(refund_request_id, request_version, approver_id, approver_role,
      decision, approved_amount, refund_fee, reason, created_at, updated_at)
    VALUES(${row.id}::uuid, ${row.version}, ${actor.id}::uuid, ${actor.role}, ${decision},
      ${approvedAmount}, ${row.refund_fee}, ${reason}, ${now}::timestamptz, ${now}::timestamptz)`;
  await tx.$queryRaw`
    UPDATE refund_requests SET status = ${decision}, approved_amount = ${approvedAmount},
      approved_by = ${actor.id}::uuid, decided_at = ${now}::timestamptz, updated_at = ${now}::timestamptz
     WHERE id = ${row.id}::uuid`;
}

export async function withdraw(tx: Tx, row: RefundRow, now: Date): Promise<void> {
  await tx.$queryRaw`
    UPDATE refund_requests SET status = 'CANCELLED', cancelled_at = ${now}::timestamptz,
      updated_at = ${now}::timestamptz WHERE id = ${row.id}::uuid`;
}
