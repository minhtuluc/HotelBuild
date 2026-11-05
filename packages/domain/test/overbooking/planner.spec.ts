/* eslint-disable max-lines -- HB-122 AC1…AC10 are independently named cases in the only spec file the ticket allows; splitting them would need files outside `allow`. */
import { expect, test, vi } from 'vitest';
import {
  checkActiveOversell as guard,
  checkStandardStep3,
  keepScore,
  planRelocation,
  proposeCrossCityException,
  rankRelocations,
} from '@pinehill/domain/overbooking';
import type {
  KeepScoreBreakdown,
  KeepScoreFactors,
  RelocationCandidate,
  RelocationGeography,
  RelocationPlanRequest,
  RelocationRank,
  RelocationRoomStock,
} from '@pinehill/domain/overbooking';

const NOW = Date.UTC(2026, 9, 10, 6, 0);
const HOUR = 3_600_000;
const TOTAL = 2_000_000;
const DEPOSIT = 600_000;
const paidFull = { paidAmountVnd: TOTAL, totalAmountVnd: TOTAL, depositAmountVnd: DEPOSIT };
const paidDeposit = { paidAmountVnd: DEPOSIT, totalAmountVnd: TOTAL, depositAmountVnd: DEPOSIT };
const unpaid = { totalAmountVnd: TOTAL, depositAmountVnd: DEPOSIT };

const scoreFactors = (overrides: Partial<KeepScoreFactors> = {}): KeepScoreFactors => ({
  loyaltyTier: 'GUEST',
  paidAmountVnd: 0,
  totalAmountVnd: 0,
  depositAmountVnd: 0,
  nights: 0,
  staysLast12Months: 0,
  status: 'CONFIRMED',
  arrivalAtEpochMs: NOW + 24 * HOUR,
  nowEpochMs: NOW,
  ...overrides,
});

const score = (overrides: Partial<KeepScoreFactors> = {}): KeepScoreBreakdown => {
  const result = keepScore(scoreFactors(overrides));
  if (!result.ok) throw new Error(result.error.message);
  return result.value;
};

const payment = (paid: number, total = TOTAL, deposit = DEPOSIT) =>
  score({ paidAmountVnd: paid, totalAmountVnd: total, depositAmountVnd: deposit }).paymentPoints;

const relocation = (overrides: Partial<RelocationCandidate> = {}): RelocationCandidate => ({
  bookingId: 'uuid-0',
  channelCode: 'WEB',
  seq: 1n,
  createdAtEpochMs: NOW,
  ...scoreFactors(),
  ...overrides,
});

const at = (
  bookingId: string,
  seq: bigint | string,
  overrides: Partial<RelocationCandidate> = {},
): RelocationCandidate => relocation({ bookingId, seq, ...overrides });

const rankOf = (candidates: readonly RelocationCandidate[]): readonly RelocationRank[] => {
  const result = rankRelocations(candidates);
  if (!result.ok) throw new Error(result.error.message);
  return result.value;
};

const explain = (rows: readonly RelocationRank[]) =>
  rows.map(({ priorityGroup, keepScore, components, createdAtEpochMs, seq }) => ({
    priorityGroup,
    keepScore,
    components,
    createdAtEpochMs,
    seq,
  }));

function sale(
  activePhysicalRooms = 24,
  overbookLimitPct = '5',
  projectedOversoldRooms = 2,
  overbookAllowed = true,
) {
  return {
    kind: 'ACTIVE_SALE' as const,
    propertyId: 'CS-01',
    activePhysicalRooms,
    overbookLimitPct,
    channel: { overbookAllowed },
    nightly: [{ date: '2026-10-03', projectedOversoldRooms }],
  };
}

const allowed = (dailyLimit: number) => ({
  ok: true,
  value: { kind: 'ACTIVE_SALE', dailyLimit },
});
const exceeded = (dailyLimit: number, projectedOversoldRooms: number, date = '2026-10-03') => ({
  ok: false,
  error: {
    code: 'E_OVER_LIMIT_EXCEEDED',
    propertyId: 'CS-01',
    date,
    dailyLimit,
    projectedOversoldRooms,
  },
});

test('TC_OVER_03_active_oversell_limits: default pct0 forbids any active oversell', () => {
  const defaultPct = {
    kind: 'ACTIVE_SALE' as const,
    propertyId: 'CS-01',
    activePhysicalRooms: 24,
    channel: { overbookAllowed: true },
    nightly: [{ date: '2026-10-03', projectedOversoldRooms: 2 }],
  };
  expect(guard(defaultPct)).toEqual(exceeded(0, 2));
  expect(guard(sale(24, '0', 1))).toEqual(exceeded(0, 1));
  expect(guard(sale(24, '0', 0, false))).toEqual(allowed(0));
});

test.each([
  [24, '3', 1],
  [34, '3', 2],
  [24, '5', 2],
  [18, '5', 1],
  [13, '5', 1],
  [20, '5', 1],
  [21, '5', 2],
  [1, '0.01', 1],
  [0, '5', 1],
  [100, '1.01', 2],
  [10_000, '0.01', 1],
  [10_001, '0.01', 2],
  [Number.MAX_SAFE_INTEGER, '5.00', 450_359_962_737_050],
  // 9,007,199,254,740,991 * 101 / 10,000 has remainder 91; floating arithmetic loses the ceiling.
  [Number.MAX_SAFE_INTEGER, '1.01', 90_972_712_472_885],
] as const)(
  'TC_OVER_03_active_oversell_limits: %i physical rooms at %s%% => %i',
  (rooms, pct, limit) => {
    expect(guard(sale(rooms, pct, limit))).toEqual(allowed(limit));
    expect(guard(sale(rooms, pct, limit + 1))).toEqual(exceeded(limit, limit + 1));
  },
);

test('TC_OVER_03_active_oversell_limits: tranches remain property-local: 24/18/13 => 2/1/1, total4', () => {
  const results = [
    guard(sale(24, '5', 2)),
    guard({ ...sale(18, '5', 1), propertyId: 'CS-02' }),
    guard({ ...sale(13, '5', 1), propertyId: 'CS-03' }),
  ];
  expect(results).toEqual([allowed(2), allowed(1), allowed(1)]);
  // A spare limit at CS-01 cannot be borrowed by a smaller property.
  expect(guard({ ...sale(13, '5', 2), propertyId: 'CS-03' })).toMatchObject({
    ok: false,
    error: { code: 'E_OVER_LIMIT_EXCEEDED', propertyId: 'CS-03', dailyLimit: 1 },
  });
});

test('TC_OVER_03_active_oversell_limits: permission is required only for active oversell', () => {
  expect(guard(sale(24, '5', 1, false))).toEqual(exceeded(0, 1));
  expect(guard(sale(24, '5', 0, false))).toEqual(allowed(0));
});

test('TC_OVER_03_active_oversell_limits: every night must fit; failure is chronological and order independent', () => {
  const nightly = [
    { date: '2026-10-05', projectedOversoldRooms: 4 },
    { date: '2026-10-03', projectedOversoldRooms: 2 },
    { date: '2026-10-04', projectedOversoldRooms: 3 },
  ];
  expect(guard({ ...sale(), nightly })).toEqual(exceeded(2, 3, '2026-10-04'));
  expect(guard({ ...sale(), nightly: [...nightly].reverse() })).toEqual(
    exceeded(2, 3, '2026-10-04'),
  );
});

test.each([
  '5.01',
  '6',
  '-1',
  'NaN',
  'Infinity',
  '',
  ' 5',
  '1e0',
  '0.001',
  '5.000',
  '1'.repeat(100),
])('TC_OVER_03_active_oversell_limits: rejects invalid percentage %s', (pct) => {
  expect(guard(sale(24, pct, 0))).toMatchObject({
    ok: false,
    error: { code: 'E_OVER_INVALID_INPUT' },
  });
});

test.each([-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, Number.MAX_SAFE_INTEGER + 1])(
  'TC_OVER_03_active_oversell_limits: rejects invalid physical/oversold count %s',
  (count) => {
    for (const input of [sale(count), sale(24, '5', count)]) {
      expect(guard(input)).toMatchObject({ ok: false, error: { code: 'E_OVER_INVALID_INPUT' } });
    }
  },
);

test('TC_OVER_03_active_oversell_limits: rejects missing snapshot coverage, malformed labels and duplicate dates', () => {
  for (const input of [
    { ...sale(), nightly: [] },
    { ...sale(), propertyId: ' ' },
    { ...sale(), nightly: [{ date: '03/10/2026', projectedOversoldRooms: 0 }] },
    { ...sale(), nightly: [...sale().nightly, ...sale().nightly] },
  ]) {
    expect(guard(input)).toMatchObject({ ok: false, error: { code: 'E_OVER_INVALID_INPUT' } });
  }
});

test.each(['OTA_BOOKING', 'OTA_AGODA', 'OTA_AIRBNB'] as const)(
  'BR_CHAN_03_08: explicitly confirmed %s commitments bypass the active-sale guard',
  (channelCode) => {
    expect(guard({ kind: 'CONFIRMED_OTA_COMMITMENT', channelCode })).toEqual({
      ok: true,
      value: { kind: 'CONFIRMED_OTA_EXEMPT' },
    });
    // An actively created sale remains subject to limits, including when offered to an OTA.
    expect(guard(sale(24, '0', 1))).toEqual(exceeded(0, 1));
  },
);

test('HB122_clock_ids_and_purity: frozen snapshots work without time, IDs, randomness or I/O', () => {
  const input = Object.freeze({
    ...sale(),
    channel: Object.freeze({ overbookAllowed: true }),
    nightly: Object.freeze([Object.freeze({ date: '2026-10-03', projectedOversoldRooms: 2 })]),
  });
  const fail = () => {
    throw new Error('Unexpected ambient dependency');
  };
  const original = JSON.stringify(input);
  vi.spyOn(Date, 'now').mockImplementation(fail);
  vi.spyOn(Math, 'random').mockImplementation(fail);
  vi.spyOn(globalThis.crypto, 'randomUUID').mockImplementation(fail);
  vi.stubGlobal('fetch', fail);
  try {
    expect(guard(input)).toEqual(allowed(2));
    expect(guard(input)).toEqual(allowed(2));
    expect(JSON.stringify(input)).toBe(original);

    const planInput = Object.freeze({
      planId: 'plan-purity-1',
      nowEpochMs: NOW,
      booking: Object.freeze({
        bookingId: 'booking-purity-1',
        propertyId: 'CS-01',
        roomTypeId: 'STD',
        roomTypeBasePriceVnd: 1_000_000,
        guestCount: 2,
        status: 'CONFIRMED' as const,
        paidAmountVnd: 1_400_000,
        firstNightRateVnd: 700_000,
      }),
      stayDates: Object.freeze(['2026-10-10', '2026-10-11']),
      roomStock: Object.freeze([
        Object.freeze({
          roomId: 'room-purity-1',
          propertyId: 'CS-01',
          roomTypeId: 'STD',
          basePriceVnd: 1_000_000,
          capacityAdults: 2,
          occupiedDates: Object.freeze<string[]>([]),
        }),
      ]),
      geography: Object.freeze({
        properties: Object.freeze([
          Object.freeze({ propertyId: 'CS-01', city: 'Đà Lạt' }),
          Object.freeze({ propertyId: 'CS-02', city: 'Vũng Tàu' }),
        ]),
        distances: Object.freeze([
          Object.freeze({
            fromPropertyId: 'CS-01',
            toPropertyId: 'CS-02',
            roadDistanceKm: 300,
          }),
        ]),
      }),
    });
    const planSnapshot = JSON.stringify(planInput);
    const firstPlan = planRelocation(planInput);
    expect(firstPlan).toEqual(planRelocation(planInput));
    expect(firstPlan.ok).toBe(true);
    if (firstPlan.ok) {
      expect(firstPlan.value.planId).toBe('plan-purity-1');
      expect(firstPlan.value.generatedAtEpochMs).toBe(NOW);
      expect(firstPlan.value.firstFeasibleStep).toBe(1);
    }
    expect(JSON.stringify(planInput)).toBe(planSnapshot);
  } finally {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  }
});

test('HB122_score_components_and_boundaries: loyalty, D08 payment branches, nights, repeat stays, arrival window', () => {
  // prettier-ignore
  const tiers = [['PLATINUM', 100], ['GOLD', 80], ['SILVER', 50], ['MEMBER', 20], ['GUEST', 0]] as const;
  for (const [loyaltyTier, points] of tiers) expect(score({ loyaltyTier }).total).toBe(points);

  // F6-D08 branch order with total 2,000,000 / deposit 600,000 unless stated otherwise.
  // prettier-ignore
  const paidTiers = [[0, 0], [300_000, 0], [599_999, 0], [600_000, 10], [1_999_999, 10], [TOTAL, 20], [TOTAL + 1, 20]] as const;
  for (const [amount, points] of paidTiers) expect(payment(amount)).toBe(points);
  // BR §9.3 and D08: total 0 with an overpayment owes nothing, so it scores 20.
  // prettier-ignore
  const zeroTiers = [[500_000, TOTAL, 0, 10], [0, 0, 0, 0], [0, 0, DEPOSIT, 0], [500_000, 0, 0, 20], [500_000, 0, DEPOSIT, 20]] as const;
  for (const [amount, total, deposit, points] of zeroTiers)
    expect(payment(amount, total, deposit)).toBe(points);

  // prettier-ignore
  for (const [nights, points] of [[0, 0], [1, 2], [13, 26], [14, 28], [30, 28]] as const) expect(score({ nights }).nightPoints).toBe(points);
  // prettier-ignore
  for (const [stays, points] of [[2, 0], [3, 15], [40, 15]] as const) expect(score({ staysLast12Months: stays }).repeatGuestPoints).toBe(points);
  // prettier-ignore
  for (const [offset, points] of [[-1, 0], [0, 10], [1, 10], [6 * HOUR, 10], [6 * HOUR + 1, 0]] as const) expect(score({ arrivalAtEpochMs: NOW + offset }).arrivalPoints).toBe(points);
  expect(score({ status: 'CHECKED_IN' }).arrivalPoints).toBe(10);

  const full = score({
    loyaltyTier: 'PLATINUM',
    nights: 5,
    staysLast12Months: 3,
    status: 'CHECKED_IN',
    ...paidFull,
  });
  expect([
    full.loyaltyPoints,
    full.paymentPoints,
    full.nightPoints,
    full.repeatGuestPoints,
    full.arrivalPoints,
    full.total,
  ]).toEqual([100, 20, 10, 15, 10, 155]);

  // prettier-ignore
  const invalid = [{ nights: -1 }, { nights: 1.5 }, { paidAmountVnd: Number.NaN }, { totalAmountVnd: -1 }, { nowEpochMs: 0.5 }];
  for (const factors of invalid)
    expect(keepScore(scoreFactors(factors))).toMatchObject({
      ok: false,
      error: { code: 'E_OVER_INVALID_INPUT' },
    });
  // @ts-expect-error Runtime tier outside the declared enum.
  expect(keepScore(scoreFactors({ loyaltyTier: 'DIAMOND' })).ok).toBe(false);
  // @ts-expect-error Runtime status outside the declared enum.
  expect(keepScore(scoreFactors({ status: 'UNKNOWN' })).ok).toBe(false);
});

test('HB122_weak_group_before_score_and_seq_tiebreak: weak group leads, then keepScore ↑, createdAt ↓, seq ↑', () => {
  const order = (input: readonly RelocationCandidate[]) =>
    rankOf(input).map((rank) => rank.bookingId);
  // prettier-ignore
  const rows = [
    at('weak-zero', 11n, { status: 'HELD' }),
    at('walkin-133', 90n, { channelCode: 'WALKIN', loyaltyTier: 'GOLD', nights: 14, staysLast12Months: 3, arrivalAtEpochMs: NOW + HOUR, ...unpaid }),
    at('held-173', 50n, { status: 'HELD', loyaltyTier: 'PLATINUM', nights: 14, staysLast12Months: 3, arrivalAtEpochMs: NOW, ...paidFull }),
    at('strong-newer', 30n, { loyaltyTier: 'MEMBER', createdAtEpochMs: NOW + HOUR }),
    at('uuid-zzz', 9n, { loyaltyTier: 'MEMBER' }),
    at('uuid-aaa', '10', { loyaltyTier: 'MEMBER' }),
    at('uuid-big-b', '9007199254740994', { loyaltyTier: 'MEMBER' }),
    at('uuid-big-a', '9007199254740993', { loyaltyTier: 'MEMBER' }),
    at('strong-57', 40n, { loyaltyTier: 'MEMBER', nights: 6, staysLast12Months: 3, ...paidDeposit }),
  ];
  // prettier-ignore
  const expected = ['weak-zero', 'walkin-133', 'held-173', 'strong-newer', 'uuid-zzz', 'uuid-aaa', 'uuid-big-a', 'uuid-big-b', 'strong-57'];
  expect(order(rows)).toEqual(expected);
  expect(order([...rows].reverse())).toEqual(expected);
  // prettier-ignore
  expect(rankOf(rows).slice(0, 3).map((rank) => [rank.priorityGroup, rank.keepScore])).toEqual([['WEAK', 0], ['WEAK', 133], ['WEAK', 173]]);
  // seq order is numeric, not lexicographic and not Number-rounded (MAX_SAFE_INTEGER + 2/3).
  // prettier-ignore
  expect(rankOf(rows).slice(4, 8).map((rank) => rank.seq)).toEqual([9n, 10n, 9_007_199_254_740_993n, 9_007_199_254_740_994n]);

  expect(rankRelocations([at('uuid-y', 7n), at('uuid-x', '7')])).toEqual({
    ok: false,
    error: { code: 'E_OVER_INVALID_INPUT', message: 'Duplicate Booking.seq 7' },
  });

  const frozen = Object.freeze([
    Object.freeze(at('frozen-a', 3n)),
    Object.freeze(at('frozen-b', 4n, { status: 'HELD' })),
  ]);
  const serialize = (input: readonly RelocationCandidate[]) =>
    JSON.stringify(input, (_key, value: unknown) =>
      typeof value === 'bigint' ? value.toString() : value,
    );
  const before = serialize(frozen);
  expect(order(frozen)).toEqual(['frozen-b', 'frozen-a']);
  expect(serialize(frozen)).toBe(before);
});

type ExampleCase = readonly [
  name: string,
  loyaltyTier: KeepScoreFactors['loyaltyTier'],
  paid: 'F' | 'D' | 'U',
  nights: number,
  stays: number,
  status: KeepScoreFactors['status'],
  arrivalHours: number,
  createdAtEpochMs: number,
  seq: bigint,
  group: 'WEAK' | 'STRONG',
  components: readonly [number, number, number, number, number, number],
];

/** §7.2 of qua-tai-ghep-doi-phong.md; every example shares total 2,000,000 / deposit 600,000. */
// prettier-ignore
const K_CASES: readonly ExampleCase[] = [
  ['K-A', 'PLATINUM', 'F', 5, 3, 'CHECKED_IN', 1, Date.UTC(2026, 2, 1, 3), 77n, 'STRONG', [100, 20, 10, 15, 10, 155]],
  ['K-B', 'GOLD', 'D', 14, 3, 'CONFIRMED', 3, Date.UTC(2026, 2, 11, 8, 15), 84n, 'STRONG', [80, 10, 28, 15, 10, 143]],
  ['K-C', 'SILVER', 'F', 7, 3, 'CHECKED_IN', 1, Date.UTC(2026, 2, 20, 11, 40), 95n, 'STRONG', [50, 20, 14, 15, 10, 109]],
  ['K-D', 'SILVER', 'U', 10, 3, 'CONFIRMED', 6, Date.UTC(2026, 2, 25, 6, 5), 91n, 'STRONG', [50, 0, 20, 15, 10, 95]],
  ['K-E', 'GUEST', 'F', 14, 0, 'CHECKED_IN', 1, Date.UTC(2026, 3, 5, 9, 30), 99n, 'STRONG', [0, 20, 28, 0, 10, 58]],
  ['K-F', 'MEMBER', 'D', 6, 3, 'CONFIRMED', 12, Date.UTC(2026, 3, 10, 2, 30), 88n, 'STRONG', [20, 10, 12, 15, 0, 57]],
  ['K-G', 'MEMBER', 'U', 11, 3, 'CONFIRMED', 12, Date.UTC(2026, 3, 18, 7), 105n, 'WEAK', [20, 0, 22, 15, 0, 57]],
  ['K-H', 'MEMBER', 'D', 1, 3, 'CHECKED_IN', 2, Date.UTC(2026, 3, 18, 7), 106n, 'STRONG', [20, 10, 2, 15, 10, 57]],
];

const PAID_AMOUNT = { F: TOTAL, D: DEPOSIT, U: 0 } as const;

test('HB122_explained_order_matches_examples: K-A…K-H expose components, group and tiebreak keys', () => {
  const toCandidate = (
    [
      name,
      loyaltyTier,
      paid,
      nights,
      stays,
      status,
      arrivalHours,
      createdAtEpochMs,
      seq,
    ]: ExampleCase,
    bookingId = `uuid-${name}`,
  ): RelocationCandidate => ({
    bookingId,
    // K-G is §7.4's WALKIN-unpaid example; every other example arrives through WEB.
    channelCode: name === 'K-G' ? 'WALKIN' : 'WEB',
    seq,
    createdAtEpochMs,
    loyaltyTier,
    paidAmountVnd: PAID_AMOUNT[paid],
    totalAmountVnd: TOTAL,
    depositAmountVnd: DEPOSIT,
    nights,
    staysLast12Months: stays,
    status,
    arrivalAtEpochMs: NOW + arrivalHours * HOUR,
    nowEpochMs: NOW,
  });
  const ranks = rankOf(K_CASES.map((row) => toCandidate(row)));
  // prettier-ignore
  expect(ranks.map((rank) => rank.bookingId)).toEqual(['uuid-K-G', 'uuid-K-H', 'uuid-K-F', 'uuid-K-E', 'uuid-K-D', 'uuid-K-C', 'uuid-K-B', 'uuid-K-A']);
  for (const [name, , , , , , , createdAtEpochMs, seq, group, components] of K_CASES) {
    const rank = ranks.find((entry) => entry.bookingId === `uuid-${name}`);
    if (!rank) throw new Error(`Missing example ${name}`);
    expect([rank.priorityGroup, rank.keepScore, rank.createdAtEpochMs, rank.seq]).toEqual([
      group,
      components[5],
      createdAtEpochMs,
      seq,
    ]);
    expect([
      rank.components.loyaltyPoints,
      rank.components.paymentPoints,
      rank.components.nightPoints,
      rank.components.repeatGuestPoints,
      rank.components.arrivalPoints,
      rank.components.total,
    ]).toEqual(components);
  }

  // K-G/K-H tie on score and createdAt, so seq decides; K-F is older and follows the newer pair.
  // prettier-ignore
  expect(ranks.slice(0, 3).map((rank) => [rank.seq, rank.createdAtEpochMs])).toEqual([[105n, Date.UTC(2026, 3, 18, 7)], [106n, Date.UTC(2026, 3, 18, 7)], [88n, Date.UTC(2026, 3, 10, 2, 30)]]);
  expect(explain(rankOf([...K_CASES].reverse().map((row) => toCandidate(row))))).toEqual(
    explain(ranks),
  );
  // New UUIDs, same seq: the explanation is unchanged.
  expect(explain(rankOf(K_CASES.map((row, index) => toCandidate(row, `8f00-${index}`))))).toEqual(
    explain(ranks),
  );
});

const GEOGRAPHY: RelocationGeography = {
  properties: [
    { propertyId: 'CS-01', city: 'Đà Lạt' },
    { propertyId: 'CS-02', city: 'Vũng Tàu' },
    { propertyId: 'CS-03', city: 'Phan Thiết' },
  ],
  distances: [
    { fromPropertyId: 'CS-01', toPropertyId: 'CS-03', roadDistanceKm: 160 },
    { fromPropertyId: 'CS-02', toPropertyId: 'CS-03', roadDistanceKm: 170 },
    { fromPropertyId: 'CS-01', toPropertyId: 'CS-02', roadDistanceKm: 300 },
  ],
};

const twoProperties = (toCity: string, roadDistanceKm: number): RelocationGeography => ({
  properties: [
    { propertyId: 'CS-01', city: 'Đà Lạt' },
    { propertyId: 'CS-09', city: toCity },
  ],
  distances: [{ fromPropertyId: 'CS-01', toPropertyId: 'CS-09', roadDistanceKm }],
});

const BOOKING = {
  bookingId: 'booking-relocation-1',
  propertyId: 'CS-01',
  roomTypeId: 'STD',
  roomTypeBasePriceVnd: 1_000_000,
  guestCount: 2,
  status: 'CONFIRMED' as const,
  paidAmountVnd: 1_400_000,
  firstNightRateVnd: 700_000,
};

const STAY = ['2026-10-10', '2026-10-11'] as const;

const stockRoom = (
  roomId: string,
  overrides: Partial<RelocationRoomStock> = {},
): RelocationRoomStock => ({
  roomId,
  propertyId: 'CS-01',
  roomTypeId: 'STD',
  basePriceVnd: 1_000_000,
  capacityAdults: 2,
  occupiedDates: [],
  ...overrides,
});

const planRequest = (overrides: Partial<RelocationPlanRequest> = {}): RelocationPlanRequest => ({
  planId: 'plan-relocation-1',
  nowEpochMs: NOW,
  booking: BOOKING,
  stayDates: [...STAY],
  roomStock: [],
  geography: GEOGRAPHY,
  ...overrides,
});

const planOf = (request: RelocationPlanRequest) => {
  const result = planRelocation(request);
  if (!result.ok) throw new Error(result.error.message);
  return result.value;
};

test('TC_OVER_05_first_feasible_and_continuous_stay: step 1 only for a room free the whole stay', () => {
  // r-n1 is free on 11/10 and r-n2 on 10/10: together they look free but neither covers the stay.
  const stitched = planOf(
    planRequest({
      roomStock: [
        stockRoom('r-n1', { occupiedDates: ['2026-10-10'] }),
        stockRoom('r-n2', { occupiedDates: ['2026-10-11'] }),
      ],
    }),
  );
  expect(stitched.firstFeasibleStep).toBe(4);
  expect(stitched.sameTypeSameProperty).toBeNull();
  expect(stitched.executionOrder).toEqual([4]);
  expect(stitched.ladder[0]).toEqual({
    step: 1,
    moveType: 'SAME_TYPE_SAME_PROPERTY',
    feasible: false,
    candidateCount: 0,
    note: 'Không còn phòng cùng loại cùng cơ sở trống liên tục cả kỳ',
  });
  expect(stitched.ladder[1]).toMatchObject({ feasible: false, candidateCount: 0 });

  const wholeStay = planOf(
    planRequest({
      roomStock: [stockRoom('r-n1', { occupiedDates: ['2026-10-10'] }), stockRoom('r-whole')],
    }),
  );
  expect(wholeStay.firstFeasibleStep).toBe(1);
  expect(wholeStay.ladder[0]).toEqual({
    step: 1,
    moveType: 'SAME_TYPE_SAME_PROPERTY',
    feasible: true,
    candidateCount: 1,
  });
  expect(wholeStay.sameTypeSameProperty).toEqual({
    roomId: 'r-whole',
    propertyId: 'CS-01',
    roomTypeId: 'STD',
    basePriceVnd: 1_000_000,
    moveType: 'SAME_TYPE_SAME_PROPERTY',
    requiresManagerApproval: false,
    requiresForceMajeure: false,
  });

  // Only a higher class with enough capacity is a step-2 candidate; the cheap upgrade picks first.
  const upgradeOnly = planOf(
    planRequest({
      roomStock: [
        stockRoom('dlx-small', { roomTypeId: 'DLX', basePriceVnd: 1_600_000, capacityAdults: 1 }),
        stockRoom('sup', { roomTypeId: 'SUP', basePriceVnd: 1_300_000 }),
        stockRoom('dlx', { roomTypeId: 'DLX', basePriceVnd: 1_500_000 }),
      ],
    }),
  );
  expect(upgradeOnly.firstFeasibleStep).toBe(2);
  expect(upgradeOnly.ladder[1]).toEqual({
    step: 2,
    moveType: 'UPGRADE_SAME_PROPERTY',
    feasible: true,
    candidateCount: 2,
  });
  expect(upgradeOnly.upgradeSameProperty).toEqual({
    roomId: 'sup',
    propertyId: 'CS-01',
    roomTypeId: 'SUP',
    basePriceVnd: 1_300_000,
    moveType: 'UPGRADE_SAME_PROPERTY',
    requiresManagerApproval: false,
    requiresForceMajeure: false,
  });
});

test('TC_OVER_06_current_geography_skips_step3: 160–300 km ladder runs 1→2→4 with all four steps previewed', () => {
  const plan = planOf(
    planRequest({
      roomStock: [
        stockRoom('r-whole'),
        stockRoom('r-dlx', { roomTypeId: 'DLX', basePriceVnd: 1_400_000 }),
        stockRoom('vt-std', { propertyId: 'CS-02' }),
        stockRoom('pt-std', { propertyId: 'CS-03' }),
      ],
    }),
  );
  expect(plan.ladder.map((row) => row.step)).toEqual([1, 2, 3, 4]);
  expect(plan.ladder.map((row) => row.moveType)).toEqual([
    'SAME_TYPE_SAME_PROPERTY',
    'UPGRADE_SAME_PROPERTY',
    'SAME_TYPE_CROSS_PROPERTY',
    'WALK_OUT',
  ]);
  expect(plan.ladder[2]).toMatchObject({ feasible: false, candidateCount: 0 });
  expect(plan.ladder[2].note).toContain('160–300 km');
  expect(plan.ladder[2].note).toContain('15 km');
  expect(plan.ladder[3]).toMatchObject({ feasible: true });
  // Distant rooms exist, but they are never promoted into step 3.
  expect(plan.crossProperty).toBeNull();
  expect(plan.firstFeasibleStep).toBe(1);
  expect(plan.executionOrder).toEqual([1, 2, 4]);
  expect(plan.crossCityException).toEqual({
    kind: 'BR_OVER_07_EXCEPTION',
    countsAsStandardLadderStep: false,
    standardLadderStep: null,
    writtenConsentRequired: true,
    managerApprovalRequired: true,
    transportSupportCapVnd: null,
    options: [
      { toPropertyId: 'CS-02', city: 'Vũng Tàu', roadDistanceKm: 300, roomIds: ['vt-std'] },
      { toPropertyId: 'CS-03', city: 'Phan Thiết', roadDistanceKm: 160, roomIds: ['pt-std'] },
    ],
  });
});

test('HB122_geo_boundary_and_explicit_exception: ≤15 km same city is step 3, beyond or cross-city needs BR-OVER-07 consent + MANAGER', () => {
  expect(checkStandardStep3(twoProperties('Đà Lạt', 15), 'CS-01', 'CS-09')).toEqual({
    ok: true,
    value: {
      fromPropertyId: 'CS-01',
      toPropertyId: 'CS-09',
      city: 'Đà Lạt',
      roadDistanceKm: 15,
      maxStep3DistanceKm: 15,
      eligible: true,
      reason: 'SAME_CITY_WITHIN_RADIUS',
    },
  });
  expect(checkStandardStep3(twoProperties('Đà Lạt', 15.01), 'CS-01', 'CS-09')).toMatchObject({
    ok: true,
    value: { eligible: false, reason: 'OUTSIDE_RADIUS' },
  });
  // Same radius, different city: still excluded from the standard ladder.
  expect(checkStandardStep3(twoProperties('Vũng Tàu', 5), 'CS-01', 'CS-09')).toMatchObject({
    ok: true,
    value: { eligible: false, reason: 'DIFFERENT_CITY' },
  });
  expect(checkStandardStep3(twoProperties('Đà Lạt', 300), 'CS-01', 'CS-09')).toMatchObject({
    ok: true,
    value: { eligible: false, reason: 'OUTSIDE_RADIUS' },
  });

  const nearby = planOf(
    planRequest({
      geography: twoProperties('Đà Lạt', 12),
      roomStock: [stockRoom('near-std', { propertyId: 'CS-09' })],
    }),
  );
  expect(nearby.ladder[2]).toEqual({
    step: 3,
    moveType: 'SAME_TYPE_CROSS_PROPERTY',
    feasible: true,
    candidateCount: 1,
  });
  expect(nearby.firstFeasibleStep).toBe(3);
  expect(nearby.crossProperty).toEqual({
    roomId: 'near-std',
    propertyId: 'CS-09',
    roomTypeId: 'STD',
    basePriceVnd: 1_000_000,
    moveType: 'SAME_TYPE_CROSS_PROPERTY',
    requiresManagerApproval: true,
    requiresForceMajeure: false,
  });
  expect(nearby.crossCityException).toBeNull();

  const consent = { granted: true, channel: 'WRITTEN' as const, evidenceRef: 'br-over-07-doc' };
  const manager = { role: 'MANAGER' as const, approvedByActorId: 'user-manager-1' };
  const exceptionRequest = {
    bookingId: BOOKING.bookingId,
    roomId: 'vt-std',
    fromPropertyId: 'CS-01',
    toPropertyId: 'CS-02',
    geography: GEOGRAPHY,
  };
  expect(proposeCrossCityException(exceptionRequest)).toMatchObject({
    ok: false,
    error: { code: 'E_OVER_CROSS_CITY_NO_CONSENT' },
  });
  // A phone note is not written consent.
  expect(
    proposeCrossCityException({
      ...exceptionRequest,
      // @ts-expect-error BR-OVER-07 requires the WRITTEN channel.
      consent: { granted: true, channel: 'PHONE', evidenceRef: 'call-log' },
      approval: manager,
    }),
  ).toMatchObject({ ok: false, error: { code: 'E_OVER_CROSS_CITY_NO_CONSENT' } });
  expect(proposeCrossCityException({ ...exceptionRequest, consent })).toMatchObject({
    ok: false,
    error: { code: 'E_OVER_APPROVAL_REQUIRED' },
  });
  expect(
    proposeCrossCityException({
      ...exceptionRequest,
      consent,
      approval: { role: 'FRONT_DESK', approvedByActorId: 'user-front-desk' },
    }),
  ).toMatchObject({ ok: false, error: { code: 'E_OVER_APPROVAL_REQUIRED' } });
  expect(
    proposeCrossCityException({
      ...exceptionRequest,
      consent,
      approval: manager,
      transportSupportVnd: 750_000,
    }),
  ).toEqual({
    ok: true,
    value: {
      kind: 'BR_OVER_07_EXCEPTION',
      bookingId: BOOKING.bookingId,
      roomId: 'vt-std',
      fromPropertyId: 'CS-01',
      toPropertyId: 'CS-02',
      countsAsStandardLadderStep: false,
      standardLadderStep: null,
      writtenConsentRequired: true,
      writtenConsentSatisfied: true,
      managerApprovalRequired: true,
      managerApprovalSatisfied: true,
      transportSupportVnd: 750_000,
      transportSupportCapVnd: null,
      transportSupportDecidedByManager: true,
      priceLocked: true,
      inventoryHeld: false,
      assignmentChanged: false,
      executable: false,
    },
  });
  // A target inside the standard radius must use the ladder, not the exception route.
  expect(
    proposeCrossCityException({
      ...exceptionRequest,
      toPropertyId: 'CS-09',
      geography: twoProperties('Đà Lạt', 12),
      consent,
      approval: manager,
    }),
  ).toMatchObject({ ok: false, error: { code: 'E_OVER_INVALID_INPUT' } });
});

test('HB122_no_room_returns_walkout_without_effects: exhausted ladder previews WALK_OUT and changes nothing', () => {
  const exhausted = planOf(planRequest({ roomStock: [] }));
  expect(exhausted.firstFeasibleStep).toBe(4);
  expect(exhausted.executionOrder).toEqual([4]);
  expect(exhausted.ladder[3]).toEqual({
    step: 4,
    moveType: 'WALK_OUT',
    feasible: true,
    candidateCount: 1,
  });
  expect(exhausted.walkOut).toEqual({
    kind: 'WALK_OUT',
    bookingId: BOOKING.bookingId,
    reason: 'NO_ALTERNATIVE_STEP_4',
    refundPercent: 100,
    refundVnd: BOOKING.paidAmountVnd,
    compensationVnd: BOOKING.firstNightRateVnd,
    transportSupportVnd: 0,
    requiresManagerApproval: true,
    requiresForceMajeure: false,
    policyBlock: null,
    executable: false,
    autoRefund: false,
    autoCompensation: false,
    autoCancellation: false,
    cancelBooking: false,
    inventoryHeld: false,
    assignmentChanged: false,
  });
  expect(exhausted.executable).toBe(false);
  expect(exhausted.inventoryHeld).toBe(false);
  expect(exhausted.assignmentChanged).toBe(false);
  expect(exhausted.priceLocked).toBe(true);

  const checkedIn = planOf(
    planRequest({ booking: { ...BOOKING, status: 'CHECKED_IN' }, roomStock: [] }),
  );
  expect(checkedIn.walkOut).toMatchObject({
    requiresManagerApproval: true,
    requiresForceMajeure: true,
    policyBlock: 'CHECKED_IN_REQUIRES_FORCE_MAJEURE',
    executable: false,
  });

  // Arrived guests are never auto-executed: policy still needs force majeure plus MANAGER approval.
  const checkedInWithRoom = planOf(
    planRequest({
      booking: { ...BOOKING, status: 'CHECKED_IN' },
      roomStock: [stockRoom('r-whole')],
    }),
  );
  expect(checkedInWithRoom.firstFeasibleStep).toBe(1);
  expect(checkedInWithRoom.sameTypeSameProperty).toMatchObject({
    requiresManagerApproval: true,
    requiresForceMajeure: true,
  });
  expect(checkedInWithRoom.executable).toBe(false);
});
