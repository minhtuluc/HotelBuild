import { expect, test } from 'vitest';
import * as engine from '../../src/cancellation/index.js';
import type { CancellationPolicy } from '../../src/cancellation/index.js';
import { decisionTable, input } from './fixtures/decision-table.js';

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

test.each([
  [0, 0, 0],
  [50, 5_000, 10_000],
])(
  'TC-CANCEL-54 sequential %s percent cancellation excludes retained allocations',
  (refundPercent, firstRefund, secondRefund) => {
    const policy = { tiers: [{ offsetHours: -1, refundPercent, chargeFirstNight: false }] };
    const payment = allocate({
      paymentId: 'p',
      amount: 30_001,
      weights: [
        { bookingRoomId: 'a', weight: 1 },
        { bookingRoomId: 'b', weight: 2 },
      ],
    });
    const base = {
      ...input(0, 0, policy),
      payments: [payment],
      rooms: [
        { bookingRoomId: 'a', firstNightPrice: 20_000 },
        { bookingRoomId: 'b', firstNightPrice: 40_000 },
      ],
    };
    const first = engine.calculateCancellation(base);
    expect(first).toMatchObject({
      refundBase: 10_001,
      refundAmount: firstRefund,
      penaltyAmount: 0,
    });
    expect(first.payments[0]?.allocations).toEqual([
      { bookingRoomId: 'a', amount: 10_001 },
      { bookingRoomId: 'b', amount: 20_000 },
    ]);
    const second = engine.calculateCancellation({
      ...base,
      payments: first.payments,
      processedRoomIds: first.processedRoomIds,
      cancelledRoomIds: ['b'],
    });
    expect(second).toMatchObject({
      refundBase: 20_000,
      refundAmount: secondRefund,
      remainingRoomIds: [],
      processedRoomIds: ['a', 'b'],
    });
    expect(() =>
      engine.calculateCancellation({
        ...base,
        payments: first.payments,
        processedRoomIds: first.processedRoomIds,
      }),
    ).toThrow(/processed/i);
  },
);

test.each([
  [10_080, 0],
  [0, 1_066_000],
])(
  'TC-CANCEL-47 empty payments at %s minutes cannot refund unpaid money',
  (minutes, penaltyAmount) => {
    const first = engine.calculateCancellation({ ...input(0, minutes), payments: [] });
    expect(first).toMatchObject({
      refundBase: 0,
      refundAmount: 0,
      penaltyAmount,
      payments: [],
      processedRoomIds: ['a'],
      remainingRoomIds: [],
    });
    expect(() =>
      engine.calculateCancellation({
        ...input(0, minutes),
        payments: [],
        processedRoomIds: first.processedRoomIds,
      }),
    ).toThrow(/processed/i);
  },
);
