import { expect, test } from 'vitest';
import fc from 'fast-check';
import * as engine from '../../src/cancellation/index.js';
import type { CancellationInput, CancellationPolicy } from '../../src/cancellation/index.js';
import { decisionTable, policies } from './fixtures/decision-table.js';

const input = (
  paid = 907_000,
  minutes = 10_080,
  policy: CancellationPolicy = policies.FLEX7,
): CancellationInput => ({
  state: 'CONFIRMED',
  policy,
  checkInDateTime: 0,
  now: -minutes * 60_000,
  rooms: [{ bookingRoomId: 'a', firstNightPrice: 1_066_000 }],
  cancelledRoomIds: ['a'],
  processedRoomIds: [],
  payments: [
    {
      paymentId: 'p',
      amount: paid,
      weights: [{ bookingRoomId: 'a', weight: 3_021_000 }],
      allocations: [{ bookingRoomId: 'a', amount: paid }],
      processedRoomIds: [],
    },
  ],
});
test('TC-CANCEL-02/03 exact 168h and one minute later differ', () => {
  expect(engine.calculateCancellation(input()).refundAmount).toBe(907_000);
  expect(engine.calculateCancellation(input(907_000, 10_079)).refundAmount).toBe(453_000);
});
test.each(decisionTable)('$name', (row) => {
  const base = input(row.paid, row.minutes, row.policy);
  const result = engine.calculateCancellation({
    ...base,
    rooms: [{ bookingRoomId: 'a', firstNightPrice: row.firstNightPrice }],
  });
  expect(result).toMatchObject({
    refundBase: row.paid,
    refundAmount: row.refund,
    penaltyAmount: row.penalty,
    tier: { offsetHours: row.offset, refundPercent: row.percent, chargeFirstNight: row.charge },
  });
});
const allocate = engine.allocatePayment;
test.each([
  [
    5,
    [
      ['c', 1],
      ['a', 1],
      ['b', 1],
    ],
    [2, 2, 1],
  ],
  [
    11,
    [
      ['b', 2],
      ['a', 1],
    ],
    [4, 7],
  ],
  [
    0,
    [
      ['a', 0],
      ['b', 0],
    ],
    [0, 0],
  ],
  [
    5,
    [
      ['b', 1],
      ['a', 0],
    ],
    [0, 5],
  ],
  [
    Number.MAX_SAFE_INTEGER,
    [
      ['b', Number.MAX_SAFE_INTEGER],
      ['a', Number.MAX_SAFE_INTEGER],
    ],
    [4503599627370496, 4503599627370495],
  ],
] satisfies [number, [string, number][], number[]][])(
  'allocation %s preserves money and ID ordered remainder',
  (amount, weights, amounts) => {
    const payment = allocate({
      paymentId: 'p',
      amount,
      weights: weights.map(([bookingRoomId, weight]) => ({ bookingRoomId, weight })),
    });
    expect(payment.allocations.map((a: { amount: number }) => a.amount)).toEqual(amounts);
  },
);
test('TC-CANCEL-54 separate snapshots and sequential cancellations never repartition money', () => {
  const payments = [
    allocate({
      paymentId: 'p1',
      amount: 10001,
      weights: [
        { bookingRoomId: 'a', weight: 1 },
        { bookingRoomId: 'b', weight: 1 },
      ],
    }),
    allocate({
      paymentId: 'p2',
      amount: 9000,
      weights: [
        { bookingRoomId: 'a', weight: 1 },
        { bookingRoomId: 'b', weight: 2 },
      ],
    }),
  ];
  const base = {
    ...input(),
    payments,
    rooms: [
      { bookingRoomId: 'a', firstNightPrice: 10000 },
      { bookingRoomId: 'b', firstNightPrice: 10000 },
    ],
  };
  const before = structuredClone(base);
  const first = engine.calculateCancellation(base);
  expect(first).toMatchObject({
    refundBase: 8001,
    refundAmount: 8000,
    remainingRoomIds: ['b'],
    processedRoomIds: ['a'],
  });
  const second = engine.calculateCancellation({
    ...base,
    payments: first.payments,
    processedRoomIds: first.processedRoomIds,
    cancelledRoomIds: ['b'],
  });
  expect(second).toMatchObject({
    refundBase: 11000,
    refundAmount: 11000,
    remainingRoomIds: [],
    processedRoomIds: ['a', 'b'],
  });
  expect(base).toEqual(before);
  expect(engine.calculateCancellation(base)).toEqual(first);
  expect(() =>
    engine.calculateCancellation({
      ...base,
      payments: first.payments,
      processedRoomIds: first.processedRoomIds,
    }),
  ).toThrow(/processed/i);
});
const invalidPolicies: CancellationPolicy[] = [
  { tiers: [] },
  { tiers: [{ offsetHours: 0, refundPercent: 100, chargeFirstNight: false }] },
  {
    tiers: [
      { offsetHours: -1, refundPercent: 0, chargeFirstNight: false },
      { offsetHours: -1, refundPercent: 0, chargeFirstNight: false },
    ],
  },
  ...[-2, 0.5, NaN, Infinity].map((offsetHours) => ({
    tiers: [{ offsetHours, refundPercent: 0, chargeFirstNight: false }],
  })),
  ...[-1, 101, 0.5, NaN].map((refundPercent) => ({
    tiers: [{ offsetHours: -1, refundPercent, chargeFirstNight: false }],
  })),
  {
    tiers: [
      { offsetHours: 24, refundPercent: 0, chargeFirstNight: false },
      { offsetHours: -1, refundPercent: 50, chargeFirstNight: false },
    ],
  },
  { tiers: [{ offsetHours: -1, refundPercent: 50, chargeFirstNight: true }] },
  {
    tiers: [
      { offsetHours: 24, refundPercent: 100, chargeFirstNight: false },
      { offsetHours: 24, refundPercent: 50, chargeFirstNight: false },
      { offsetHours: -1, refundPercent: 0, chargeFirstNight: false },
    ],
  },
];
test.each(invalidPolicies)('invalid snapshot is rejected: %j', (policy) => {
  expect(() => engine.calculateCancellation({ ...input(), policy })).toThrow(/policy/i);
});
test.each([-1, 0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1])(
  'invalid integer money/instant %s rejected',
  (value) => {
    expect(() => engine.calculateCancellation(input(value))).toThrow();
    if (value !== -1)
      expect(() => engine.calculateCancellation({ ...input(), now: value })).toThrow();
  },
);
test('negative valid instants and subminute threshold preserve exact comparison', () => {
  expect(engine.calculateCancellation({ ...input(), now: -168 * 3600000 + 1 }).refundAmount).toBe(
    453000,
  );
});
test.each([
  { paymentId: '', amount: 1, weights: [{ bookingRoomId: 'a', weight: 1 }] },
  { paymentId: 'p', amount: 1, weights: [] },
  { paymentId: 'p', amount: 1, weights: [{ bookingRoomId: 'a', weight: 0 }] },
  { paymentId: 'p', amount: 1, weights: [{ bookingRoomId: '', weight: 1 }] },
  { paymentId: 'p', amount: 1, weights: [{ bookingRoomId: 'a', weight: -1 }] },
  {
    paymentId: 'p',
    amount: 1,
    weights: [
      { bookingRoomId: 'a', weight: 1 },
      { bookingRoomId: 'a', weight: 1 },
    ],
  },
])('invalid allocation rejected %j', (p) => expect(() => allocate(p)).toThrow());
test.each([
  { cancelledRoomIds: [] },
  { cancelledRoomIds: ['a', 'a'] },
  { cancelledRoomIds: ['unknown'] },
  { processedRoomIds: ['unknown'] },
  { processedRoomIds: ['a', 'a'] },
  { rooms: [{ bookingRoomId: 'a', firstNightPrice: -1 }] },
  {
    rooms: [
      { bookingRoomId: 'a', firstNightPrice: 1 },
      { bookingRoomId: 'a', firstNightPrice: 1 },
    ],
  },
  { rooms: [{ bookingRoomId: '', firstNightPrice: 1 }] },
])('invalid cancellation facts rejected %j', (patch) =>
  expect(() => engine.calculateCancellation({ ...input(), ...patch })).toThrow(),
);
test('duplicate receipts, forged allocations and processed state are rejected', () => {
  const base = input();
  const p = base.payments[0];
  if (!p) throw new Error('Fixture');
  for (const payments of [
    [p, p],
    [{ ...p, allocations: [{ bookingRoomId: 'a', amount: 1 }] }],
    [{ ...p, processedRoomIds: ['a'] }],
    [{ ...p, processedRoomIds: ['x'] }],
    [{ ...p, processedRoomIds: ['a', 'a'] }],
    [{ ...p, weights: [{ bookingRoomId: 'x', weight: 1 }] }],
  ]) {
    expect(() => engine.calculateCancellation({ ...base, payments })).toThrow();
  }
});
test('sum overflow is rejected before conversion', () => {
  const p = allocate({
    paymentId: 'p',
    amount: Number.MAX_SAFE_INTEGER,
    weights: [{ bookingRoomId: 'a', weight: 1 }],
  });
  expect(() =>
    engine.calculateCancellation({ ...input(), payments: [p, { ...p, paymentId: 'q' }] }),
  ).toThrow(/safe/i);
});
test('TC-CANCEL-44/45/46/49 generated policies preserve limits, monotonicity and purity', () => {
  fc.assert(
    fc.property(
      fc.integer({ min: 0, max: 200000000 }),
      fc.integer({ min: -120000, max: 120000 }),
      fc.integer({ min: 0, max: 100 }),
      fc.integer({ min: 0, max: 100 }),
      (paid, minutes, p1, p2) => {
        const policy = {
          tiers: [
            { offsetHours: 72, refundPercent: Math.max(p1, p2), chargeFirstNight: false },
            { offsetHours: -1, refundPercent: Math.min(p1, p2), chargeFirstNight: false },
          ],
        };
        const base = { ...input(paid, minutes), policy };
        const earlier = engine.calculateCancellation(base);
        const later = engine.calculateCancellation({ ...base, now: base.now + 60000 });
        expect(later.refundAmount).toBeLessThanOrEqual(earlier.refundAmount);
        expect(earlier.refundAmount).toBeLessThanOrEqual(paid);
        expect(earlier.refundAmount % 1000).toBe(0);
        expect(engine.calculateCancellation(base)).toEqual(earlier);
      },
    ),
    { numRuns: 200, seed: 53044 },
  );
});
test('TC-CANCEL-44 allocation property conserves each payment', () => {
  fc.assert(
    fc.property(
      fc.integer({ min: 0, max: Number.MAX_SAFE_INTEGER }),
      fc.array(fc.integer({ min: 1, max: 1000000 }), { minLength: 1, maxLength: 8 }),
      (amount, weights) => {
        const p = allocate({
          paymentId: 'p',
          amount,
          weights: weights.map((weight, index) => ({ bookingRoomId: String(index), weight })),
        });
        expect(
          p.allocations.reduce((sum: bigint, a: { amount: number }) => sum + BigInt(a.amount), 0n),
        ).toBe(BigInt(amount));
      },
    ),
    { numRuns: 200, seed: 53019 },
  );
});

test.each(['DRAFT', 'CHECKED_IN', 'CANCELLED', 'EXPIRED'])(
  'unsupported lifecycle state %s is rejected at runtime',
  (state) => {
    expect.assertions(1);
    try {
      // @ts-expect-error External callers must also be rejected when bypassing the typed CONFIRMED contract.
      engine.calculateCancellation({ ...input(), state });
    } catch (error) {
      expect(error).toMatchObject({ code: 'E_CANCEL_INVALID_STATE' });
    }
  },
);
