import { expect, test, vi } from 'vitest';
import {
  checkActiveOversell as guard,
  keepScore,
  rankRelocations,
} from '@pinehill/domain/overbooking';
import type {
  KeepScoreBreakdown,
  KeepScoreFactors,
  RelocationCandidate,
  RelocationRank,
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
