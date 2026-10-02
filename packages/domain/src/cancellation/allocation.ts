import type { AllocatedPayment, PaymentInput } from './index.js';
import { fail, ids, integer, money } from './validation.js';
/** Allocate once per receipt using its own snapshot; remainder follows ordinal room ID order. */
export function allocatePayment(input: PaymentInput): AllocatedPayment {
  ids([input.paymentId], 'Payment');
  integer(input.amount, 'Payment amount');
  ids(
    input.weights.map((w) => w.bookingRoomId),
    'Snapshot rooms',
  );
  if (!input.weights.length) fail('E_CANCEL_INVALID_INPUT', 'Payment needs snapshot rooms');
  const weights = input.weights
    .map((w) => {
      integer(w.weight, 'Snapshot weight');
      return Object.freeze({ ...w });
    })
    .sort((a, b) => (a.bookingRoomId < b.bookingRoomId ? -1 : 1));
  const total = weights.reduce((sum, w) => sum + BigInt(w.weight), 0n);
  if (total === 0n && input.amount !== 0)
    fail('E_CANCEL_INVALID_INPUT', 'Positive payment needs positive total weight');
  const amounts = weights.map((w) =>
    total === 0n ? 0n : (BigInt(input.amount) * BigInt(w.weight)) / total,
  );
  let remainder = BigInt(input.amount) - amounts.reduce((sum, amount) => sum + amount, 0n);
  const allocations = weights.map((w, index) => {
    const extra = remainder > 0n ? 1n : 0n;
    remainder -= extra;
    return Object.freeze({
      bookingRoomId: w.bookingRoomId,
      amount: money((amounts[index] ?? 0n) + extra),
    });
  });
  return Object.freeze({
    paymentId: input.paymentId,
    amount: input.amount,
    weights: Object.freeze(weights),
    allocations: Object.freeze(allocations),
    processedRoomIds: Object.freeze([]),
  });
}
