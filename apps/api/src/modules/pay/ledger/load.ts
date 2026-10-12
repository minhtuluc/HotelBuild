import type { Prisma } from '@prisma/client';
import { requireLedger } from './projection.js';
import type { LedgerFacts } from './types.js';

/** All monetary writers share this order. Never starts/commits a transaction or performs external I/O. */
export async function loadLocked(
  tx: Prisma.TransactionClient,
  bookingId: string,
): Promise<LedgerFacts> {
  requireLedger(!('$transaction' in tx), 'LEDGER_REQUIRES_TRANSACTION');
  const locked = await tx.$queryRaw<
    { id: string }[]
  >`SELECT id FROM bookings WHERE id=${bookingId}::uuid FOR UPDATE`;
  requireLedger(locked.length === 1, 'LEDGER_BOOKING_MISSING');
  await tx.$queryRaw`SELECT id FROM payments WHERE booking_id=${bookingId}::uuid ORDER BY id FOR UPDATE`;
  await tx.$queryRaw`SELECT id FROM refund_requests WHERE booking_id=${bookingId}::uuid ORDER BY id FOR UPDATE`;
  const booking = await tx.bookings.findUniqueOrThrow({
    where: { id: bookingId },
    select: {
      id: true,
      property_id: true,
      status: true,
      paid_amount: true,
      refunded_amount: true,
      balance_due: true,
      total_amount: true,
      penalty_amount: true,
    },
  });
  const payments = await tx.payments.findMany({
    where: { booking_id: bookingId },
    orderBy: { id: 'asc' },
    select: { id: true, booking_id: true, type: true, status: true, amount: true },
  });
  const charges = await tx.booking_charges.findMany({
    where: { booking_id: bookingId },
    orderBy: { id: 'asc' },
    select: { id: true, booking_id: true, kind: true, amount: true, voided_amount: true },
  });
  const refunds = await tx.refund_requests.findMany({
    where: { booking_id: bookingId },
    orderBy: { id: 'asc' },
    select: { id: true, booking_id: true, status: true, net_refund: true },
  });
  const allocations = await tx.payment_allocations.findMany({
    where: {
      OR: [{ payments: { booking_id: bookingId } }, { booking_charges: { booking_id: bookingId } }],
    },
    orderBy: { id: 'asc' },
    select: { id: true, payment_id: true, charge_id: true, amount: true, released_amount: true },
  });
  const refundAllocations = await tx.refund_allocations.findMany({
    where: {
      OR: [
        { refund_requests: { booking_id: bookingId } },
        { payments_refund_allocations_original_payment_idTopayments: { booking_id: bookingId } },
        { payments_refund_allocations_refund_payment_idTopayments: { booking_id: bookingId } },
      ],
    },
    orderBy: { id: 'asc' },
    select: {
      id: true,
      refund_request_id: true,
      original_payment_id: true,
      refund_payment_id: true,
      amount: true,
    },
  });
  if (!['CANCELLED', 'NO_SHOW', 'EXPIRED'].includes(booking.status))
    requireLedger(
      charges
        .filter((c) => c.kind === 'ROOM')
        .reduce((sum, c) => sum + c.amount - c.voided_amount, 0n) === booking.total_amount,
      'LEDGER_CHARGES_INCOMPLETE',
    );
  if (booking.status !== 'EXPIRED')
    requireLedger(
      charges
        .filter((c) => c.kind === 'PENALTY')
        .reduce((sum, c) => sum + c.amount - c.voided_amount, 0n) === booking.penalty_amount,
      'LEDGER_CHARGES_INCOMPLETE',
    );
  return { booking, payments, charges, refunds, allocations, refundAllocations };
}
