import { cancelRequestSchema, rescheduleRequestSchema } from '@pinehill/contracts';
import type { CancelPreview, Quote } from '@pinehill/contracts';
import type { ChangeDraft, ChangePreview, ChangeResult, ChangeIntent } from './types';

export function assertResult(result: ChangeResult, intent: ChangeIntent): void {
  const id = result.kind === 'cancel' ? result.data.bookingId : result.data.id;
  if (result.kind !== intent.kind || id !== intent.bookingId) throw new Error('Mismatched result');
  if (result.kind === 'cancel') {
    if (result.data.status !== 'CANCELLED') throw new Error('Cancellation not confirmed');
    const c = result.data.cancellation;
    assertMoney([c.paidAmount, c.requestedAmount, c.penaltyAmount, c.refundFee]);
  } else {
    const request = rescheduleRequestSchema.parse(intent.body);
    if (result.data.checkIn !== request.checkIn || result.data.checkOut !== request.checkOut)
      throw new Error('Reschedule not confirmed');
    assertMoney([
      result.data.totalAmount,
      result.data.depositAmount,
      result.data.paidAmount,
      result.data.balanceDue,
    ]);
  }
}

function cancelFingerprint(p: CancelPreview) {
  const c = p.cancellation;
  return [
    c.policyId,
    c.appliedTierId,
    c.refundPercent,
    c.paidAmount,
    c.requestedAmount,
    c.penaltyAmount,
    c.refundFee,
    p.warnings ?? [],
  ];
}
function quoteFingerprint(q: Quote) {
  return [
    q.channelCode,
    q.ratePlanCode,
    q.checkIn,
    q.checkOut,
    q.nights,
    q.subtotal,
    q.discountAmount,
    q.total,
    q.currency,
    q.warnings,
    q.depositPercent,
    q.depositAmount,
    q.engineVersion,
  ];
}
export function samePreview(a: ChangePreview, b: ChangePreview): boolean {
  if (a.kind === 'cancel' && b.kind === 'cancel')
    return JSON.stringify(cancelFingerprint(a.data)) === JSON.stringify(cancelFingerprint(b.data));
  if (a.kind === 'reschedule' && b.kind === 'reschedule')
    return JSON.stringify(quoteFingerprint(a.data)) === JSON.stringify(quoteFingerprint(b.data));
  return false;
}
export function assertPreview(
  preview: ChangePreview,
  draft: ChangeDraft,
  bookingId: string,
  now: number,
): void {
  if (preview.kind === 'cancel') {
    if (preview.data.bookingId !== bookingId) throw new Error('Mismatched preview');
    const c = preview.data.cancellation;
    assertMoney([c.paidAmount, c.requestedAmount, c.penaltyAmount, c.refundFee]);
  } else {
    const q = preview.data;
    assertMoney([
      q.subtotal,
      q.discountAmount,
      q.total,
      q.depositAmount,
      ...q.nights.map((n) => n.nightlyPrice),
    ]);
    const expiry = Date.parse(q.expiresAt);
    if (
      q.checkIn !== draft.checkIn ||
      q.checkOut !== draft.checkOut ||
      !Number.isFinite(expiry) ||
      expiry <= now
    )
      throw new Error('Stale quote');
  }
}
function assertMoney(amounts: number[]): void {
  if (!amounts.every((n) => Number.isSafeInteger(n) && n >= 0)) throw new Error('Invalid money');
}
export function requestBody(preview: ChangePreview, draft: ChangeDraft) {
  const note = draft.note.trim();
  const evidenceRefs = draft.evidenceRefs.map((value) => value.trim()).filter(Boolean);
  if (preview.kind === 'cancel')
    return cancelRequestSchema.parse({
      reason: draft.reason,
      isForceMajeure: draft.reason === 'FORCE_MAJEURE',
      ...(note ? { note } : {}),
      ...(evidenceRefs.length ? { evidenceRefs } : {}),
    });
  return rescheduleRequestSchema.parse({
    checkIn: draft.checkIn,
    checkOut: draft.checkOut,
    quoteId: preview.data.quoteId,
    ...(note ? { reason: note } : {}),
  });
}
