/**
 * Lệnh thu tiền tại quầy (HB-096; api.md §2.6, §3.5; BR-PAY-01,02,06; BR-RBAC-05).
 *
 * Một transaction với khoá booking lấy đúng thứ tự ADR-014 (`lockBooking` của HB-077), rồi:
 * 1. đọc lại quyền/phạm vi trên booking đã khoá (HB-093: caller khoá rồi kiểm lại);
 * 2. chỉ thu khi booking đang thu được (HELD/PENDING_PAYMENT còn hạn, hoặc CONFIRMED/CHECKED_IN/
 *    CHECKED_OUT cho số dư & phụ thu) — BR-PAY-02;
 * 3. tính nghĩa vụ hiện hành từ `BookingLedger.read` + `depositAmount` đã chốt (không tự tính tiền);
 *    lệch mốc nào → `422 E_PAY_AMOUNT_MISMATCH` (api.md §3.5);
 * 4. tiêu thụ `pinToken` một lần gắn đúng booking (HB-015) trong **cùng** transaction — rollback lệnh
 *    thu thì token còn nguyên;
 * 5. ghi `payments` SUCCEEDED + `payment_allocations` rồi `BookingLedger.sync` hạch toán
 *    `paid_amount`/`balance_due`; `CASH` luôn có `created_by` (CHECK CSDL, BR-PAY-06);
 * 6. thu đủ cọc ⇒ `CONFIRMED` **cùng transaction** bằng writer HB-077 (`confirmBooking`), BR-BOOK-09;
 * 7. audit cùng transaction.
 *
 * Outbox cố ý **không** phát: BR-CHAN-06 chỉ buộc outbox khi đổi giá/tồn, lệnh thu không đổi cả hai
 * (HB-077 `confirmBooking` cũng vậy; relay chỉ tiêu thụ loại đã có consumer đăng ký).
 */
import { Inject, Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import type { Clock, IdGenerator } from '@pinehill/domain';
import { paymentSchema } from '@pinehill/contracts';
import type { Payment } from '@pinehill/contracts';
import type { AuthorizedActor } from '../../../common/actor/authorized-actor.js';
import { AuditWriter } from '../../../infrastructure/audit/audit-writer.js';
import { CLOCK, ID_GENERATOR } from '../../../infrastructure/ports.js';
import { lockBooking } from '../../book/bookings/lock.js';
import { confirmBooking } from '../../book/bookings/writes.js';
import { PIN_PURPOSE_FINANCIAL, requirePinToken } from '../../auth/pin/consume.js';
import { BookingLedger } from '../ledger/service.js';
import { amountMismatch, invalid, invalidState } from './errors.js';
import { counterCommand, requireCollect } from './principal.js';
import { allocationPlan, dueAmount, isCounterType } from './obligation.js';
import type { ChargeLine, CounterObligationFacts } from './obligation.js';

type Tx = Prisma.TransactionClient;

/** Trạng thái còn thu được; hai trạng thái đầu còn phải trong hạn hold mới thu (BR-BOOK-18). */
const COLLECTIBLE: readonly string[] = [
  'HELD',
  'PENDING_PAYMENT',
  'CONFIRMED',
  'CHECKED_IN',
  'CHECKED_OUT',
];
const HOLDING: readonly string[] = ['HELD', 'PENDING_PAYMENT'];

const paymentSelect = {
  id: true,
  booking_id: true,
  type: true,
  method: true,
  amount: true,
  status: true,
  provider_txn_id: true,
  paid_at: true,
  created_at: true,
  created_by: true,
} as const;

@Injectable()
export class CounterService {
  private readonly ledger: BookingLedger;
  constructor(
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(ID_GENERATOR) private readonly ids: IdGenerator,
    @Inject(AuditWriter) private readonly audit: AuditWriter,
  ) {
    this.ledger = new BookingLedger(clock);
  }

  /** Lệnh thu tại quầy; chạy trong transaction idempotency của HB-029. */
  async collect(tx: Tx, actor: AuthorizedActor, body: unknown): Promise<Payment> {
    const command = counterCommand(body);
    if (!isCounterType(command.type)) throw invalid();
    const now = this.clock.now();
    const booking = await lockBooking(tx, command.bookingId);
    requireCollect(actor, { propertyId: booking.propertyId, type: command.type });
    assertCollectible(booking.status, booking.holdExpiresAt, now);

    // Sổ cái là nguồn số duy nhất: `paidByType['DEPOSIT']` (đúng loại) + `balanceDue` + nghĩa vụ từng kind.
    const projection = await this.ledger.read(tx, booking.id);
    const facts: CounterObligationFacts = {
      status: booking.status,
      depositAmount: booking.depositAmount,
      depositPaid: projection.paidByType['DEPOSIT'] ?? 0n,
      balanceDue: projection.balanceDue,
      holdExpiresAt: booking.holdExpiresAt,
      now,
      outstanding: await outstandingCharges(tx, booking.id),
    };
    const due = dueAmount(command.type, facts);
    if (due === 0n) throw invalidState('Không còn khoản phải thu cho loại này.');
    if (BigInt(command.amount) !== due) throw amountMismatch();

    await requirePinToken(tx, {
      userId: actor.id,
      token: command.pinToken,
      purpose: PIN_PURPOSE_FINANCIAL,
      bookingId: booking.id,
      now,
    });

    const created = await tx.payments.create({
      data: {
        booking_id: booking.id,
        type: command.type,
        method: command.method,
        amount: due,
        status: 'SUCCEEDED',
        // Khoá nghiệp vụ do server sinh — KHÔNG sao chép `Idempotency-Key` HTTP (csdl §3).
        idempotency_key: this.ids.generate(),
        paid_at: now,
        created_by: actor.id,
        note: command.note ?? null,
        created_at: now,
        updated_at: now,
      },
      select: paymentSelect,
    });
    await allocate(tx, created.id, allocationPlan(command.type, due, facts), now);
    await this.ledger.sync(tx, booking.id, actor);
    await this.confirmWhenDepositCovered(
      tx,
      actor,
      booking.id,
      booking.propertyId,
      booking.status,
      booking.depositAmount,
      created.id,
      now,
    );
    await this.audit.record(tx, {
      actor,
      action: 'PAYMENT_COLLECTED',
      entityType: 'Payment',
      entityId: created.id,
      beforeJson: null,
      afterJson: {
        bookingId: booking.id,
        propertyId: booking.propertyId,
        type: command.type,
        method: command.method,
        amount: due.toString(),
        status: 'SUCCEEDED',
      },
      reason: null,
    });
    return project(created);
  }

  /** Thu đủ cọc ⇒ `CONFIRMED` cùng transaction bằng writer HB-077 (BR-BOOK-09, TC-PAY-02). */
  private async confirmWhenDepositCovered(
    tx: Tx,
    actor: AuthorizedActor,
    bookingId: string,
    propertyId: string,
    status: string,
    depositAmount: bigint,
    paymentId: string,
    now: Date,
  ): Promise<void> {
    if (!HOLDING.includes(status)) return;
    const collected = await collectedByTypes(tx, bookingId, ['DEPOSIT', 'BALANCE']);
    if (collected < depositAmount) return;
    await confirmBooking(tx, this.audit, {
      bookingId,
      propertyId,
      fromStatus: status === 'HELD' ? 'HELD' : 'PENDING_PAYMENT',
      paymentId,
      paidAmount: collected,
      caller: {
        type: 'USER',
        id: actor.id,
        role: actor.role,
        propertyScope: actor.propertyScope,
        ip: actor.ip,
        correlationId: actor.correlationId,
        principal: { type: 'USER', id: actor.id },
      },
      now,
    });
  }
}

/** Booking phải đang ở trạng thái thu được; booking đang giữ chỗ còn phải trong hạn (BR-BOOK-18). */
function assertCollectible(status: string, holdExpiresAt: Date | null, now: Date): void {
  if (!COLLECTIBLE.includes(status)) throw invalidState('Booking không ở trạng thái thu được.');
  if (
    HOLDING.includes(status) &&
    (holdExpiresAt === null || holdExpiresAt.getTime() <= now.getTime())
  )
    throw invalidState('Hold đã hết hạn; không thể thu.');
}

/**
 * Nghĩa vụ còn lại của từng dòng `booking_charges` = `amount − voided_amount − đã phân bổ`.
 * `SUM(bigint)` là `numeric` trong PostgreSQL nên ép lại `::bigint` để Prisma trả `BigInt` (không phải
 * `Decimal`) — mọi giá trị đều là số nguyên VND.
 */
async function outstandingCharges(tx: Tx, bookingId: string): Promise<readonly ChargeLine[]> {
  const rows = await tx.$queryRaw<{ id: string; kind: string; outstanding: bigint }[]>`
    SELECT c.id,
           c.kind,
           ((c.amount - c.voided_amount) - COALESCE(SUM(a.amount - a.released_amount), 0))::bigint AS outstanding
      FROM booking_charges c
      LEFT JOIN payment_allocations a ON a.charge_id = c.id
     WHERE c.booking_id = ${bookingId}::uuid
     GROUP BY c.id, c.kind
     ORDER BY c.id`;
  return rows.map((row) => ({ id: row.id, kind: row.kind, outstanding: row.outstanding }));
}

async function collectedByTypes(
  tx: Tx,
  bookingId: string,
  types: readonly string[],
): Promise<bigint> {
  const row = await tx.payments.aggregate({
    where: { booking_id: bookingId, status: 'SUCCEEDED', type: { in: [...types] } },
    _sum: { amount: true },
  });
  return row._sum.amount ?? 0n;
}

async function allocate(
  tx: Tx,
  paymentId: string,
  plan: readonly { readonly chargeId: string; readonly amount: bigint }[],
  now: Date,
): Promise<void> {
  for (const line of plan) {
    await tx.payment_allocations.create({
      data: {
        payment_id: paymentId,
        charge_id: line.chargeId,
        amount: line.amount,
        created_at: now,
        updated_at: now,
      },
    });
  }
}

/** DTO hợp đồng: `paymentUrl`/`expiresAt` là `null` với lệnh tại quầy (không có bước PSP). */
function project(row: {
  id: string;
  booking_id: string;
  type: string;
  method: string;
  amount: bigint;
  status: string;
  provider_txn_id: string | null;
  paid_at: Date | null;
  created_at: Date;
  created_by: string | null;
}): Payment {
  return paymentSchema.parse({
    paymentId: row.id,
    bookingId: row.booking_id,
    type: row.type,
    method: row.method,
    amount: Number(row.amount),
    status: row.status,
    providerTxnId: row.provider_txn_id,
    paymentUrl: null,
    expiresAt: null,
    paidAt: row.paid_at === null ? null : row.paid_at.toISOString(),
    createdAt: row.created_at.toISOString(),
    createdBy: row.created_by,
  });
}
