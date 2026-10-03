import { expect, test, vi } from 'vitest';
import { checkActiveOversell as guard } from '@pinehill/domain/overbooking';

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
