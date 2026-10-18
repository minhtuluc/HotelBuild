import type { LedgerFacts, LedgerProjection, LedgerSource } from './types.js';
import { groupLedger, requireLedger, isCollection, type LedgerGroups } from './validation.js';
import { collectedSources, appliedCharges, settleRefunds } from './allocations.js';
export { LedgerError, requireLedger } from './validation.js';
function totals(
  sources: Map<string, LedgerSource>,
  paidByType: Readonly<Record<string, bigint>>,
): LedgerProjection {
  const projection: LedgerProjection = {
    paidAmount: 0n,
    refundedAmount: 0n,
    refundReserved: 0n,
    balanceDue: 0n,
    paidByType,
    outstandingByKind: {},
    sources: [],
    charges: [],
  };
  for (const source of sources.values()) {
    source.available = source.collected - source.applied - source.refunded - source.reserved;
    requireLedger(source.available >= 0n, 'LEDGER_SOURCE_CAP');
    projection.paidAmount += source.collected;
    projection.refundedAmount += source.refunded;
    projection.refundReserved += source.reserved;
    projection.sources.push(source);
  }
  requireLedger(
    projection.refundedAmount + projection.refundReserved <= projection.paidAmount,
    'LEDGER_BOOKING_CAP',
  );
  return projection;
}
function chargeDebt(charge: LedgerFacts['charges'][number], applied: bigint, status: string) {
  requireLedger(
    charge.amount >= 0n && charge.voided_amount >= 0n && charge.voided_amount <= charge.amount,
    'LEDGER_CHARGE_AMOUNT',
  );
  const outstanding = charge.amount - charge.voided_amount - applied;
  requireLedger(outstanding >= 0n, 'LEDGER_CHARGE_CAP');
  const closedRoom = ['CANCELLED', 'NO_SHOW'].includes(status) && charge.kind === 'ROOM';
  return status === 'EXPIRED' || closedRoom ? 0n : outstanding;
}
function debts(
  groups: LedgerGroups,
  applied: ReadonlyMap<string, bigint>,
  status: string,
  projection: LedgerProjection,
) {
  for (const charge of groups.charges.values()) {
    const due = chargeDebt(charge, applied.get(charge.id) ?? 0n, status);
    projection.charges.push({ id: charge.id, outstanding: due });
    projection.outstandingByKind[charge.kind] =
      (projection.outstandingByKind[charge.kind] ?? 0n) + due;
    projection.balanceDue += due;
  }
}
function paidByType(groups: LedgerGroups): Record<string, bigint> {
  const totals: Record<string, bigint> = {};
  for (const payment of groups.payments.values()) {
    // Chỉ dòng thu SUCCEEDED mới cộng nghĩa vụ (BR-PAY-02); REFUND/COMPENSATION chi ra không thuộc đây.
    if (payment.status !== 'SUCCEEDED' || !isCollection(payment.type)) continue;
    totals[payment.type] = (totals[payment.type] ?? 0n) + payment.amount;
  }
  return totals;
}

/** BR-PAY-02 / ADR-016: integer VND, per-obligation allocation, no global netting or policy evaluation. */
export function projectLedger(facts: LedgerFacts): LedgerProjection {
  const groups = groupLedger(facts),
    sources = collectedSources(groups);
  const applied = appliedCharges(facts, groups, sources);
  settleRefunds(facts, groups, sources);
  const projection = totals(sources, paidByType(groups));
  debts(groups, applied, facts.booking.status, projection);
  return projection;
}
