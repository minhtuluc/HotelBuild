/**
 * Khoản thu **OTA_COLLECT** qua sổ cái HB-093 (AC1): ghi `payments` SUCCEEDED + `payment_allocations`
 * theo đúng công thức phân bổ dùng chung, rồi `BookingLedger.sync` hạch toán
 * `paid_amount`/`refunded_amount`/`balance_due`. **Không** gán tay `paidAmount`: sổ cái là nguồn duy
 * nhất, nên mọi đường thu (quầy, online, OTA) cùng một phép chiếu.
 *
 * Không phát outbox ở đây: lệnh thu không đổi giá/tồn (BR-CHAN-06 chỉ buộc outbox khi đổi một trong
 * hai); outbox của lần áp inbox do bước ghi booking phát.
 */
import type { Prisma } from '@prisma/client';
import { BookingLedger } from '../../pay/ledger/service.js';
import { planReceiptAllocation } from '../../pay/ledger/receipt-allocation.js';
import type { ReceiptCharge } from '../../pay/ledger/receipt-allocation.js';
import { systemActor } from './actor.js';
import type { OtaInboxDeps } from './types.js';

type Tx = Prisma.TransactionClient;

export interface CollectionInput {
  readonly bookingId: string;
  readonly total: bigint;
  readonly accountKey: string;
  readonly providerBookingCode: string;
  readonly providerUpdatedAt: string;
  readonly now: Date;
  readonly correlationId: string;
}

async function outstandingCharges(tx: Tx, bookingId: string): Promise<readonly ReceiptCharge[]> {
  const rows = await tx.$queryRaw<
    { id: string; kind: string; room_id: string | null; amount: bigint; outstanding: bigint }[]
  >`
    SELECT c.id, c.kind, c.booking_room_id AS room_id, c.amount,
           GREATEST((c.amount - c.voided_amount)
             - COALESCE(SUM(a.amount - a.released_amount), 0), 0)::bigint AS outstanding
      FROM booking_charges c
      LEFT JOIN payment_allocations a ON a.charge_id = c.id
     WHERE c.booking_id = ${bookingId}::uuid
     GROUP BY c.id, c.kind, c.booking_room_id, c.amount, c.voided_amount
     ORDER BY c.id`;
  return rows.map((row) => ({
    id: row.id,
    kind: row.kind,
    roomId: row.room_id,
    weight: row.amount,
    outstanding: row.outstanding,
  }));
}

/** Một khoản thu OTA thu hộ cho toàn bộ nghĩa vụ phòng còn lại của booking. */
export async function recordOtaCollection(
  tx: Tx,
  deps: OtaInboxDeps,
  input: CollectionInput,
): Promise<void> {
  const payment = await tx.payments.create({
    data: {
      booking_id: input.bookingId,
      type: 'BALANCE',
      method: 'OTA_COLLECT',
      amount: input.total,
      status: 'SUCCEEDED',
      idempotency_key: `${input.accountKey}:${input.providerUpdatedAt}`,
      provider_txn_id: `${input.accountKey}/${input.providerBookingCode}/${input.providerUpdatedAt}`,
      paid_at: input.now,
      note: null,
      created_at: input.now,
      updated_at: input.now,
    },
    select: { id: true },
  });
  const plan = planReceiptAllocation(input.total, await outstandingCharges(tx, input.bookingId), [
    'ROOM',
  ]);
  if (plan.length > 0)
    await tx.payment_allocations.createMany({
      data: plan.map((line) => ({
        payment_id: payment.id,
        charge_id: line.chargeId,
        amount: line.amount,
        created_at: input.now,
        updated_at: input.now,
      })),
    });
  await new BookingLedger(deps.clock).sync(tx, input.bookingId, systemActor(input.correlationId));
}

/**
 * Phân bổ **lại** các khoản thu đã có cho nghĩa vụ mới sau `booking.modified`: không tạo khoản thu thứ
 * hai, không sửa số tiền đã thu. Phần thu vượt nghĩa vụ mới (nếu kỳ ngắn lại) ở lại chưa phân bổ —
 * đúng quy ước `planReceiptAllocation`, không sinh tiền ngoài nghĩa vụ.
 */
export async function reallocateCollections(
  tx: Tx,
  deps: OtaInboxDeps,
  input: { readonly bookingId: string; readonly now: Date; readonly correlationId: string },
): Promise<void> {
  const payments = await tx.payments.findMany({
    where: { booking_id: input.bookingId, status: 'SUCCEEDED', type: { not: 'REFUND' } },
    orderBy: { id: 'asc' },
    select: { id: true, amount: true },
  });
  let charges = [...(await outstandingCharges(tx, input.bookingId))];
  for (const payment of payments) {
    const plan = planReceiptAllocation(payment.amount, charges, ['ROOM']);
    if (plan.length === 0) continue;
    await tx.payment_allocations.createMany({
      data: plan.map((line) => ({
        payment_id: payment.id,
        charge_id: line.chargeId,
        amount: line.amount,
        created_at: input.now,
        updated_at: input.now,
      })),
    });
    const applied = new Map(plan.map((line) => [line.chargeId, line.amount]));
    charges = charges.map((charge) => ({
      ...charge,
      outstanding: charge.outstanding - (applied.get(charge.id) ?? 0n),
    }));
  }
  await new BookingLedger(deps.clock).sync(tx, input.bookingId, systemActor(input.correlationId));
}
