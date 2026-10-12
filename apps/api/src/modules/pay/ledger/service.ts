import type { Prisma } from '@prisma/client';
import type { Clock } from '@pinehill/domain';
import type { ActorContext } from '../../../common/actor/actor-context.js';
import { AuditWriter } from '../../../infrastructure/audit/audit-writer.js';
import { loadLocked } from './load.js';
import { projectLedger, requireLedger } from './projection.js';
import type { LedgerFacts, RefundLeg, LedgerProjection } from './types.js';

function snapshot(projection: LedgerProjection) {
  return {
    paidAmount: projection.paidAmount.toString(),
    refundedAmount: projection.refundedAmount.toString(),
    refundReserved: projection.refundReserved.toString(),
    balanceDue: projection.balanceDue.toString(),
  };
}
/** Internal PAY port. Caller authenticates/authorizes scope, supplies policy decision and owns the TX. */
export class BookingLedger {
  private readonly audit: AuditWriter;
  constructor(clock: Clock) {
    this.audit = new AuditWriter(clock);
  }

  async read(tx: Prisma.TransactionClient, bookingId: string): Promise<LedgerProjection> {
    return projectLedger(await loadLocked(tx, bookingId));
  }
  async sync(
    tx: Prisma.TransactionClient,
    bookingId: string,
    actor: ActorContext,
  ): Promise<LedgerProjection> {
    return this.persist(tx, await loadLocked(tx, bookingId), actor);
  }
  private async persist(
    tx: Prisma.TransactionClient,
    facts: LedgerFacts,
    actor: ActorContext,
  ): Promise<LedgerProjection> {
    const projection = projectLedger(facts),
      b = facts.booking;
    if (
      b.paid_amount !== projection.paidAmount ||
      b.refunded_amount !== projection.refundedAmount ||
      b.balance_due !== projection.balanceDue
    ) {
      await tx.bookings.update({
        where: { id: b.id },
        data: {
          paid_amount: projection.paidAmount,
          refunded_amount: projection.refundedAmount,
          balance_due: projection.balanceDue,
        },
      });
      await this.audit.record(tx, {
        actor,
        action: 'LEDGER_RECONCILED',
        entityType: 'Booking',
        entityId: b.id,
        beforeJson: {
          propertyId: b.property_id,
          paidAmount: b.paid_amount.toString(),
          refundedAmount: b.refunded_amount.toString(),
          balanceDue: b.balance_due.toString(),
        },
        afterJson: { propertyId: b.property_id, ...snapshot(projection) },
        reason: 'Reconcile committed ledger',
      });
    }
    return projection;
  }
  async reserve(
    tx: Prisma.TransactionClient,
    bookingId: string,
    requestId: string,
    legs: readonly RefundLeg[],
    actor: ActorContext,
  ): Promise<LedgerProjection> {
    const facts = await loadLocked(tx, bookingId),
      before = projectLedger(facts);
    const request = facts.refunds.find((row) => row.id === requestId);
    requireLedger(request?.status === 'PENDING', 'LEDGER_REQUEST_STATE');
    const wanted = new Map<string, bigint>();
    let net = 0n;
    for (const leg of legs) {
      requireLedger(leg.amount > 0n && !wanted.has(leg.paymentId), 'LEDGER_REFUND_LEGS');
      wanted.set(leg.paymentId, leg.amount);
      net += leg.amount;
    }
    requireLedger(net === request.net_refund, 'LEDGER_REFUND_NET');
    const existing = facts.refundAllocations.filter((row) => row.refund_request_id === requestId);
    if (existing.length) {
      requireLedger(
        existing.length === wanted.size &&
          existing.every((row) => wanted.get(row.original_payment_id) === row.amount),
        'LEDGER_RESERVATION_CONFLICT',
      );
      return before;
    }
    for (const leg of legs) {
      const source = before.sources.find((row) => row.paymentId === leg.paymentId);
      requireLedger(!!source && source.available >= leg.amount, 'LEDGER_SOURCE_CAP');
    }
    // All preconditions above run before the first write; stable UUID order also matches SQL receipt locks.
    for (const leg of [...legs].sort((a, b) => a.paymentId.localeCompare(b.paymentId))) {
      await tx.refund_allocations.create({
        data: {
          refund_request_id: requestId,
          original_payment_id: leg.paymentId,
          amount: leg.amount,
        },
      });
    }
    const result = await this.persist(tx, await loadLocked(tx, bookingId), actor);
    if (legs.length)
      await this.audit.record(tx, {
        actor,
        action: 'LEDGER_REFUND_RESERVED',
        entityType: 'Booking',
        entityId: bookingId,
        beforeJson: { propertyId: facts.booking.property_id, ...snapshot(before) },
        afterJson: {
          propertyId: facts.booking.property_id,
          ...snapshot(result),
          refundRequestId: requestId,
          legs: legs.map((leg) => ({ paymentId: leg.paymentId, amount: leg.amount.toString() })),
        },
        reason: 'Reserve decided NET refund',
      });
    return result;
  }
}
