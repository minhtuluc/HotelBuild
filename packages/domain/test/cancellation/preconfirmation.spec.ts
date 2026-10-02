import { expect, test } from 'vitest';
import fc from 'fast-check';
import * as engine from '../../src/cancellation/index.js';
import { input } from './fixtures/decision-table.js';
const allocate = engine.allocatePayment;

// BR-BOOK-18 / QĐ-05: the caller supplies the state before expiry or withdrawal.
test.each(['HELD', 'PENDING_PAYMENT'] as const)(
  'AC3a %s sequential refunds preserve the exact collected allocations',
  (state) => {
    const payment = allocate({
      paymentId: 'p',
      amount: 10_001,
      weights: [
        { bookingRoomId: 'a', weight: 1 },
        { bookingRoomId: 'b', weight: 1 },
      ],
    });
    const base = {
      ...input(),
      state,
      payments: [payment],
      rooms: [
        { bookingRoomId: 'a', firstNightPrice: 20_000 },
        { bookingRoomId: 'b', firstNightPrice: 20_000 },
      ],
    };
    const before = structuredClone(base);
    const first = engine.calculateCancellation(base);
    expect(first).toMatchObject({
      refundBase: 5_001,
      refundAmount: 5_001,
      penaltyAmount: 0,
      refundMode: 'PRECONFIRMATION',
      tier: null,
    });
    const second = engine.calculateCancellation({
      ...base,
      payments: first.payments,
      processedRoomIds: first.processedRoomIds,
      cancelledRoomIds: ['b'],
    });
    expect(second).toMatchObject({
      refundBase: 5_000,
      refundAmount: 5_000,
      penaltyAmount: 0,
      processedRoomIds: ['a', 'b'],
      remainingRoomIds: [],
    });
    expect(first.refundAmount + second.refundAmount).toBe(payment.amount);
    expect(first.payments[0]?.allocations).toEqual(payment.allocations);
    expect(base).toEqual(before);
    expect(Object.isFrozen(first)).toBe(true);
    expect(Object.isFrozen(first.payments[0]?.processedRoomIds)).toBe(true);
    expect(() =>
      engine.calculateCancellation({
        ...base,
        payments: first.payments,
        processedRoomIds: first.processedRoomIds,
      }),
    ).toThrow(/processed/i);
    const confirmed = engine.calculateCancellation({ ...base, state: 'CONFIRMED' });
    const confirmedSecond = engine.calculateCancellation({
      ...base,
      state: 'CONFIRMED',
      payments: confirmed.payments,
      processedRoomIds: confirmed.processedRoomIds,
      cancelledRoomIds: ['b'],
    });
    expect([confirmed.refundAmount, confirmedSecond.refundAmount]).toEqual([5_000, 5_000]);
    expect(confirmed).toMatchObject({ refundMode: 'POLICY', tier: { refundPercent: 100 } });
  },
);
test.each(['HELD', 'PENDING_PAYMENT'] as const)(
  'AC3a %s expiry or withdrawal bypasses NONREF and first-night penalties',
  (state) => {
    for (const policy of [
      { tiers: [{ offsetHours: -1, refundPercent: 0, chargeFirstNight: false }] },
      { tiers: [{ offsetHours: -1, refundPercent: 0, chargeFirstNight: true }] },
      { tiers: [] },
    ]) {
      const result = engine.calculateCancellation({ ...input(10_001, 0, policy), state });
      expect(result).toMatchObject({
        refundAmount: 10_001,
        penaltyAmount: 0,
        refundMode: 'PRECONFIRMATION',
        tier: null,
      });
    }
    expect(engine.calculateCancellation({ ...input(0, 0), state, payments: [] })).toMatchObject({
      refundAmount: 0,
      penaltyAmount: 0,
    });
  },
);

test('AC3a generated sequential refunds conserve every collected VND across receipts and rooms', () => {
  fc.assert(
    fc.property(
      fc.constantFrom('HELD' as const, 'PENDING_PAYMENT' as const),
      fc.array(fc.integer({ min: 0, max: 200_000_001 }), { minLength: 1, maxLength: 5 }),
      fc.array(fc.integer({ min: 1, max: 1_000_000 }), { minLength: 1, maxLength: 8 }),
      (state, amounts, weights) => {
        const payments = amounts.map((amount, index) =>
          allocate({
            paymentId: String(index),
            amount,
            weights: weights.map((weight, room) => ({ bookingRoomId: String(room), weight })),
          }),
        );
        const base = {
          ...input(),
          state,
          payments,
          rooms: weights.map((_, room) => ({
            bookingRoomId: String(room),
            firstNightPrice: 1_000_000,
          })),
        };
        const before = structuredClone(base);
        let nextPayments = base.payments;
        let processedRoomIds: readonly string[] = [];
        let refunded = 0;
        for (const room of base.rooms) {
          const result = engine.calculateCancellation({
            ...base,
            payments: nextPayments,
            processedRoomIds,
            cancelledRoomIds: [room.bookingRoomId],
          });
          const allocated = payments.reduce(
            (sum, payment) =>
              sum +
              (payment.allocations.find((a) => a.bookingRoomId === room.bookingRoomId)?.amount ??
                0),
            0,
          );
          expect(result.refundAmount).toBe(allocated);
          expect(result.penaltyAmount).toBe(0);
          expect(result.payments.map((p) => p.allocations)).toEqual(
            payments.map((p) => p.allocations),
          );
          refunded += result.refundAmount;
          nextPayments = [...result.payments];
          processedRoomIds = result.processedRoomIds;
        }
        expect(refunded).toBe(amounts.reduce((sum, amount) => sum + amount, 0));
        expect(processedRoomIds).toHaveLength(weights.length);
        expect(base).toEqual(before);
      },
    ),
    { numRuns: 200, seed: 53003 },
  );
});
