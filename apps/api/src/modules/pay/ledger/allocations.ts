import type { LedgerFacts, LedgerSource } from './types.js';
import {
  requireLedger,
  isCollection,
  validateRefundTotals,
  type LedgerGroups,
} from './validation.js';
export function collectedSources(groups: LedgerGroups) {
  const sources = new Map<string, LedgerSource>();
  for (const p of groups.payments.values()) {
    requireLedger(p.type === 'REFUND' ? p.amount < 0n : p.amount > 0n, 'LEDGER_PAYMENT_SIGN');
    if (p.status === 'SUCCEEDED' && isCollection(p.type))
      sources.set(p.id, {
        paymentId: p.id,
        collected: p.amount,
        applied: 0n,
        refunded: 0n,
        reserved: 0n,
        available: 0n,
      });
  }
  return sources;
}
export function appliedCharges(
  facts: LedgerFacts,
  groups: LedgerGroups,
  sources: Map<string, LedgerSource>,
) {
  const applied = new Map<string, bigint>(),
    pairs = new Set<string>();
  for (const a of facts.allocations) {
    const receipt = groups.payments.get(a.payment_id),
      charge = groups.charges.get(a.charge_id);
    requireLedger(!!receipt && !!charge && isCollection(receipt.type), 'LEDGER_ALLOCATION_SOURCE');
    requireLedger(
      a.amount > 0n && a.released_amount >= 0n && a.released_amount <= a.amount,
      'LEDGER_RELEASE',
    );
    const pair = a.payment_id + '/' + a.charge_id;
    requireLedger(!pairs.has(pair), 'LEDGER_DUPLICATE');
    pairs.add(pair);
    const source = sources.get(a.payment_id);
    if (source) {
      const active = a.amount - a.released_amount;
      source.applied += active;
      applied.set(a.charge_id, (applied.get(a.charge_id) ?? 0n) + active);
    }
  }
  return applied;
}
function payoutFor(
  a: LedgerFacts['refundAllocations'][number],
  request: LedgerFacts['refunds'][number],
  groups: LedgerGroups,
  linked: Set<string>,
) {
  if (a.refund_payment_id === null) return undefined;
  const payout = groups.payments.get(a.refund_payment_id);
  requireLedger(
    !!payout && payout.type === 'REFUND' && payout.amount === -a.amount && !linked.has(payout.id),
    'LEDGER_PAYOUT_MISMATCH',
  );
  requireLedger(request.status === 'APPROVED' || request.status === 'PAID', 'LEDGER_PAYOUT_STATE');
  linked.add(payout.id);
  return payout;
}
function settleLeg(
  a: LedgerFacts['refundAllocations'][number],
  request: LedgerFacts['refunds'][number],
  source: LedgerSource,
  payout: LedgerFacts['payments'][number] | undefined,
) {
  if (payout?.status === 'SUCCEEDED') source.refunded += a.amount;
  else if (request.status === 'PENDING' || request.status === 'APPROVED')
    source.reserved += a.amount;
  else requireLedger(request.status !== 'PAID', 'LEDGER_UNPROVEN_PAYOUT');
}
export function settleRefunds(
  facts: LedgerFacts,
  groups: LedgerGroups,
  sources: Map<string, LedgerSource>,
) {
  const linked = new Set<string>(),
    pairs = new Set<string>(),
    totals = new Map<string, bigint>();
  for (const a of facts.refundAllocations) {
    const request = groups.refunds.get(a.refund_request_id),
      source = sources.get(a.original_payment_id);
    requireLedger(!!request && !!source && a.amount > 0n, 'LEDGER_REFUND_SOURCE');
    const pair = a.refund_request_id + '/' + a.original_payment_id;
    requireLedger(!pairs.has(pair), 'LEDGER_DUPLICATE');
    pairs.add(pair);
    totals.set(request.id, (totals.get(request.id) ?? 0n) + a.amount);
    settleLeg(a, request, source, payoutFor(a, request, groups, linked));
  }
  validateRefundTotals(groups, totals);
  for (const p of groups.payments.values())
    if (p.type === 'REFUND' && p.status === 'SUCCEEDED')
      requireLedger(linked.has(p.id), 'LEDGER_UNLINKED_REFUND');
}
