import type { LedgerFacts } from './types.js';
export class LedgerError extends Error {
  constructor(readonly reason: string) {
    super(reason);
    this.name = 'LedgerError';
  }
}
export function requireLedger(valid: boolean, reason: string): asserts valid {
  if (!valid) throw new LedgerError(reason);
}
function unique<T extends { id: string }>(rows: readonly T[]): Map<string, T> {
  const result = new Map(rows.map((row) => [row.id, row]));
  requireLedger(result.size === rows.length, 'LEDGER_DUPLICATE');
  return result;
}
const collectedTypes = new Set([
  'DEPOSIT',
  'BALANCE',
  'PENALTY',
  'EXTRA_SERVICE',
  'RESCHEDULE_FEE',
]);
export function isCollection(type: string): boolean {
  return collectedTypes.has(type);
}
export function groupLedger(facts: LedgerFacts) {
  const payments = unique(facts.payments),
    charges = unique(facts.charges),
    refunds = unique(facts.refunds);
  unique(facts.allocations);
  unique(facts.refundAllocations);
  for (const row of [...payments.values(), ...charges.values(), ...refunds.values()])
    requireLedger(row.booking_id === facts.booking.id, 'LEDGER_BOOKING_MISMATCH');
  return { payments, charges, refunds };
}
export type LedgerGroups = ReturnType<typeof groupLedger>;
export function validateRefundTotals(groups: LedgerGroups, totals: ReadonlyMap<string, bigint>) {
  for (const request of groups.refunds.values()) {
    const allocated = totals.get(request.id) ?? 0n;
    requireLedger(
      typeof request.net_refund === 'bigint' && request.net_refund >= 0n,
      'LEDGER_REFUND_NET',
    );
    if (['PENDING', 'APPROVED', 'PAID'].includes(request.status))
      requireLedger(allocated <= request.net_refund, 'LEDGER_REFUND_NET');
    if (request.status === 'PAID')
      requireLedger(allocated === request.net_refund, 'LEDGER_UNPROVEN_PAYOUT');
  }
}
