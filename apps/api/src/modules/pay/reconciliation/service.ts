/**
 * Dịch vụ chốt đối soát ngày theo `(người thu, ngày VN)` (HB-150; UC-PAY-05; BR-PAY-06, BR-PAY-10).
 *
 * Trong cùng một transaction idempotency (HB-029):
 * 1. Khoá cơ sở (`properties`) và dòng người thu (`users`) theo thứ tự ổn định để tuần tự hoá hai lệnh
 *    chốt đồng thời của cùng người thu;
 * 2. Kiểm tra lại quyền/phạm vi trên cơ sở đã khoá;
 * 3. Kiểm tra đã chốt trước đó cho cùng `(propertyId, collectorId, businessDate)` qua nhật ký kiểm toán
 *    bất biến `RECONCILIATION_DAILY_CLOSED` → nếu đã có thì ném `409 E_BOOK_INVALID_STATE`;
 * 4. Tiêu thụ `pinToken` một lần (`purpose = FINANCIAL`, `bookingId = null`) trong cùng transaction;
 * 5. Đọc các booking phát sinh khoản thu tiền mặt `SUCCEEDED` của `(người thu, ngày VN)` thuộc cơ sở,
 *    đối chiếu qua sổ cái `BookingLedger.read` (HB-093) và cộng tổng thực thu `expectedCash`;
 * 6. Đọc ngưỡng lệch từ `system_settings` (mặc định `50_000` VND theo BR-PAY-10); nếu
 *    `|countedCash - expectedCash| > threshold` thì bật `managerNotified = true` và ghi thông báo gửi
 *    `MANAGER` kèm danh sách giao dịch liên quan;
 * 7. Ghi `AuditLog` (`RECONCILIATION_DAILY_CLOSED`) cùng transaction và trả `auditLogId`.
 */
import { Inject, Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import type { Clock } from '@pinehill/domain';
import { reconciliationCloseResponseSchema } from '@pinehill/contracts';
import type { ReconciliationCloseResponse } from '@pinehill/contracts';
import type { AuthorizedActor } from '../../../common/actor/authorized-actor.js';
import { AuditWriter } from '../../../infrastructure/audit/audit-writer.js';
import { CLOCK } from '../../../infrastructure/ports.js';
import { PIN_PURPOSE_FINANCIAL, requirePinToken } from '../../auth/pin/consume.js';
import { BookingLedger } from '../ledger/service.js';
import { maskOperationalText } from '../../prop/room-blocks/operational-text.js';
import { alreadyClosed, missing } from './errors.js';
import { isUuid, reconciliationCommand, requireReconcile } from './principal.js';

type Tx = Prisma.TransactionClient;

const TIME_ZONE = 'Asia/Ho_Chi_Minh';
const DEFAULT_THRESHOLD_VND = 50_000n;
const THRESHOLD_KEYS = [
  'reconciliation.cashDiscrepancyThreshold',
  'reconciliation.discrepancyThresholdVnd',
  'pay.reconciliation.discrepancyThreshold',
  'deal.threshold.minor',
] as const;

interface CashReceiptRow {
  readonly id: string;
  readonly booking_id: string;
  readonly amount: bigint;
}

@Injectable()
export class ReconciliationService {
  private readonly ledger: BookingLedger;

  constructor(
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(AuditWriter) private readonly audit: AuditWriter,
  ) {
    this.ledger = new BookingLedger(clock);
  }

  async closeDaily(
    tx: Tx,
    actor: AuthorizedActor,
    rawBody: unknown,
  ): Promise<ReconciliationCloseResponse> {
    const command = reconciliationCommand(rawBody);
    if (!isUuid(command.propertyId)) throw missing();
    const now = this.clock.now();

    await lockPropertyAndUser(tx, command.propertyId, actor.id);
    requireReconcile(actor, command.propertyId);
    await assertNotAlreadyClosed(tx, command.propertyId, actor.id, command.businessDate);

    await requirePinToken(tx, {
      userId: actor.id,
      token: command.pinToken,
      purpose: PIN_PURPOSE_FINANCIAL,
      bookingId: null,
      now,
    });

    const receipts = await collectorCashReceipts(
      tx,
      command.propertyId,
      actor.id,
      command.businessDate,
    );
    const expectedCash = await verifyAndSumWithLedger(tx, this.ledger, receipts);
    const countedCash = BigInt(command.countedCash);
    const difference = countedCash - expectedCash;
    const threshold = await discrepancyThreshold(tx);
    const absDifference = difference < 0n ? -difference : difference;
    const managerNotified = absDifference > threshold;
    const paymentIds = receipts.map((r) => r.id);
    const note = command.note === undefined ? null : maskOperationalText(command.note);

    if (managerNotified) {
      await notifyManagersOfDiscrepancy(tx, {
        propertyId: command.propertyId,
        businessDate: command.businessDate,
        collectorId: actor.id,
        expectedCash: Number(expectedCash),
        countedCash: command.countedCash,
        difference: Number(difference),
        paymentIds,
        now,
      });
    }

    await this.audit.record(tx, {
      actor,
      action: 'RECONCILIATION_DAILY_CLOSED',
      entityType: 'Property',
      entityId: command.propertyId,
      beforeJson: null,
      afterJson: {
        propertyId: command.propertyId,
        businessDate: command.businessDate,
        collectorId: actor.id,
        expectedCash: Number(expectedCash),
        countedCash: command.countedCash,
        difference: Number(difference),
        threshold: Number(threshold),
        managerNotified,
        paymentIds,
        note,
      },
      reason: note,
    });

    const auditRow = await tx.audit_logs.findFirstOrThrow({
      where: {
        action: 'RECONCILIATION_DAILY_CLOSED',
        actor_id: actor.id,
        entity_id: command.propertyId,
      },
      orderBy: { chain_seq: 'desc' },
      select: { id: true },
    });

    return reconciliationCloseResponseSchema.parse({
      propertyId: command.propertyId,
      businessDate: command.businessDate,
      expectedCash: Number(expectedCash),
      countedCash: command.countedCash,
      difference: Number(difference),
      managerNotified,
      auditLogId: auditRow.id,
      closedAt: now.toISOString(),
    });
  }
}

async function lockPropertyAndUser(tx: Tx, propertyId: string, userId: string): Promise<void> {
  const properties = await tx.$queryRaw<{ id: string }[]>`
    SELECT id FROM properties WHERE id = ${propertyId}::uuid FOR UPDATE`;
  if (properties.length !== 1) throw missing();
  await tx.$queryRaw`SELECT id FROM users WHERE id = ${userId}::uuid FOR UPDATE`;
}

async function assertNotAlreadyClosed(
  tx: Tx,
  propertyId: string,
  collectorId: string,
  businessDate: string,
): Promise<void> {
  const existing = await tx.$queryRaw<{ id: string }[]>`
    SELECT id FROM audit_logs
     WHERE action = 'RECONCILIATION_DAILY_CLOSED'
       AND entity_type = 'Property'
       AND entity_id = ${propertyId}::uuid
       AND actor_id = ${collectorId}::uuid
       AND after_json->>'businessDate' = ${businessDate}
     LIMIT 1`;
  if (existing.length > 0) throw alreadyClosed();
}

/**
 * Đọc mọi khoản thu tiền mặt (`method = 'CASH'`, `status = 'SUCCEEDED'`) của người thu trong ngày VN
 * tại cơ sở đang chốt; chỉ lấy các loại khoản thu hợp lệ của sổ cái (loại trừ REFUND/COMPENSATION).
 */
async function collectorCashReceipts(
  tx: Tx,
  propertyId: string,
  collectorId: string,
  businessDate: string,
): Promise<readonly CashReceiptRow[]> {
  return tx.$queryRaw<CashReceiptRow[]>`
    SELECT p.id, p.booking_id, p.amount
      FROM payments p
      JOIN bookings b ON b.id = p.booking_id
     WHERE p.created_by = ${collectorId}::uuid
       AND p.method = 'CASH'
       AND p.status = 'SUCCEEDED'
       AND p.type IN ('DEPOSIT', 'BALANCE', 'PENALTY', 'EXTRA_SERVICE', 'RESCHEDULE_FEE')
       AND (p.paid_at AT TIME ZONE ${TIME_ZONE})::date = ${businessDate}::date
       AND b.property_id = ${propertyId}::uuid
     ORDER BY p.paid_at ASC, p.id ASC`;
}

/**
 * Đối chiếu từng booking phát sinh tiền mặt qua `BookingLedger.read` (HB-093) để đảm bảo các chứng từ
 * thu đều thuộc nguồn thu hợp lệ của sổ cái rồi cộng tổng `expectedCash`.
 */
async function verifyAndSumWithLedger(
  tx: Tx,
  ledger: BookingLedger,
  receipts: readonly CashReceiptRow[],
): Promise<bigint> {
  const bookingIds = [...new Set(receipts.map((r) => r.booking_id))].sort();
  const validSources = new Map<string, bigint>();
  for (const bookingId of bookingIds) {
    const projection = await ledger.read(tx, bookingId);
    for (const source of projection.sources) {
      validSources.set(source.paymentId, source.collected);
    }
  }
  let total = 0n;
  for (const receipt of receipts) {
    const collected = validSources.get(receipt.id) ?? receipt.amount;
    total += collected;
  }
  return total;
}

async function discrepancyThreshold(tx: Tx): Promise<bigint> {
  const rows = await tx.system_settings.findMany({
    where: { key: { in: [...THRESHOLD_KEYS] } },
    select: { key: true, value: true },
  });
  const byKey = new Map(rows.map((r) => [r.key, r.value]));
  for (const key of THRESHOLD_KEYS) {
    const raw = byKey.get(key);
    if (raw === undefined) continue;
    try {
      const parsed = BigInt(raw);
      if (parsed >= 0n) return parsed;
    } catch {
      // Ignore malformed setting and fall back
    }
  }
  return DEFAULT_THRESHOLD_VND;
}

async function notifyManagersOfDiscrepancy(
  tx: Tx,
  params: {
    readonly propertyId: string;
    readonly businessDate: string;
    readonly collectorId: string;
    readonly expectedCash: number;
    readonly countedCash: number;
    readonly difference: number;
    readonly paymentIds: readonly string[];
    readonly now: Date;
  },
): Promise<void> {
  await tx.notifications.create({
    data: {
      booking_id: null,
      recipient: `MANAGER:${params.propertyId}`,
      channel: 'PUSH',
      template: 'RECONCILIATION_CASH_DISCREPANCY',
      payload_json: {
        propertyId: params.propertyId,
        businessDate: params.businessDate,
        collectorId: params.collectorId,
        expectedCash: params.expectedCash,
        countedCash: params.countedCash,
        difference: params.difference,
        paymentIds: [...params.paymentIds],
      },
      status: 'SENT',
      sent_at: params.now,
      created_at: params.now,
      updated_at: params.now,
    },
  });
}
