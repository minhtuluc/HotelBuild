import type {
  AllocatedPayment,
  CancellationDecision,
  CancellationInput,
  CancellationRequest,
  CancellationResult,
  PreconfirmationCancellationDecision,
  PreconfirmationCancellationInput,
} from './index.js';
import { allocatePayment } from './allocation.js';
import { resolveTier } from './policy.js';
import { fail, ids, integer, money } from './validation.js';
/** Pure quote plus the next allocation state; caller persists that state atomically with cancellation. */
export function calculateCancellation(input: CancellationInput): CancellationDecision;
export function calculateCancellation(
  input: PreconfirmationCancellationInput,
): PreconfirmationCancellationDecision;
export function calculateCancellation(input: CancellationRequest): CancellationResult;
export function calculateCancellation(input: CancellationRequest): CancellationResult {
  if (input.state !== 'CONFIRMED' && input.state !== 'HELD' && input.state !== 'PENDING_PAYMENT')
    fail('E_CANCEL_INVALID_STATE', 'Cancellation requires CONFIRMED, HELD or PENDING_PAYMENT');
  const tier =
    input.state === 'CONFIRMED'
      ? resolveTier(input.policy, input.checkInDateTime, input.now)
      : null;
  const rooms = ids(
    input.rooms.map((r) => r.bookingRoomId),
    'Rooms',
  );
  const selected = ids(input.cancelledRoomIds, 'Selected rooms');
  const processed = ids(input.processedRoomIds, 'Processed rooms');
  validateSelection(rooms, selected, processed);
  let firstNight = 0n;
  for (const room of input.rooms) {
    integer(room.firstNightPrice, 'First night price');
    if (selected.has(room.bookingRoomId)) firstNight += BigInt(room.firstNightPrice);
  }
  money(firstNight);
  ids(
    input.payments.map((p) => p.paymentId),
    'Payments',
  );
  let base = 0n;
  const payments: AllocatedPayment[] = input.payments.map((payment) => {
    const canonical = allocatePayment(payment);
    const prior = ids(payment.processedRoomIds, 'Processed allocation');
    const allocationIds = ids(
      payment.allocations.map((a) => a.bookingRoomId),
      'Allocations',
    );
    if (allocationIds.size !== canonical.allocations.length)
      fail('E_CANCEL_INVALID_INPUT', 'Incomplete payment allocations');
    const allocationByRoom = new Map(payment.allocations.map((a) => [a.bookingRoomId, a]));
    for (const id of prior)
      if (!allocationIds.has(id)) fail('E_CANCEL_INVALID_INPUT', 'Unknown processed allocation');
    for (const allocation of canonical.allocations) {
      const id = allocation.bookingRoomId;
      const actual = allocationByRoom.get(id);
      if (
        !rooms.has(id) ||
        !actual ||
        actual.amount !== allocation.amount ||
        prior.has(id) !== processed.has(id)
      )
        fail('E_CANCEL_INVALID_INPUT', 'Allocation differs from snapshot or processed state');
      if (selected.has(id)) {
        base += BigInt(allocation.amount);
        prior.add(id);
      }
    }
    return Object.freeze({ ...canonical, processedRoomIds: Object.freeze([...prior].sort()) });
  });
  const allProcessed = new Set([...processed, ...selected]);
  const common = {
    refundBase: money(base),
    payments: Object.freeze(payments),
    processedRoomIds: Object.freeze([...allProcessed].sort()),
    remainingRoomIds: Object.freeze([...rooms].filter((id) => !allProcessed.has(id)).sort()),
  };
  if (tier === null)
    return Object.freeze({
      ...common,
      refundMode: 'PRECONFIRMATION',
      tier,
      refundAmount: common.refundBase,
      penaltyAmount: 0,
    });
  return Object.freeze({
    ...common,
    refundMode: 'POLICY',
    tier,
    refundAmount: money(((base * BigInt(tier.refundPercent)) / 100_000n) * 1000n),
    penaltyAmount: tier.chargeFirstNight ? money(firstNight > base ? firstNight - base : 0n) : 0,
  });
}

function validateSelection(
  rooms: Set<string>,
  selected: Set<string>,
  processed: Set<string>,
): void {
  if (!selected.size) fail('E_CANCEL_INVALID_INPUT', 'Select at least one room');
  for (const id of processed)
    if (!rooms.has(id)) fail('E_CANCEL_INVALID_INPUT', 'Unknown processed room');
  for (const id of selected) {
    if (!rooms.has(id)) fail('E_CANCEL_INVALID_INPUT', 'Unknown selected room');
    if (processed.has(id)) fail('E_CANCEL_ALREADY_PROCESSED', 'Selected room already processed');
  }
}
