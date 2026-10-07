import { expect, test } from 'vitest';
import { calculateReportingMetrics } from '../../src/reporting/index.js';
import type { ReportingInput, RoomNightFact } from '../../src/reporting/index.js';

function room(overrides: Partial<RoomNightFact> = {}): RoomNightFact {
  return {
    roomId: 'private',
    businessDate: '2030-11-01',
    kind: 'PRIVATE',
    bedCount: 1,
    active: true,
    blocked: false,
    soldUnits: 1,
    netRevenueVnd: 900_000,
    ...overrides,
  };
}
function input(overrides: Partial<ReportingInput> = {}): ReportingInput {
  return {
    from: '2030-11-01',
    to: '2030-12-01',
    roomNights: [room()],
    bookings: [],
    overbookingCosts: [],
    ...overrides,
  };
}
function value(facts: ReportingInput) {
  const result = calculateReportingMetrics(facts);
  if (!result.ok) throw new Error(result.error.code);
  return result.value;
}

test('BR-REP-01 uses NET revenue for ADR/RevPAR, preserves numerator/denominator', () => {
  const result = value(
    input({ roomNights: [room(), room({ roomId: 'empty', soldUnits: 0, netRevenueVnd: 0 })] }),
  );
  expect(result).toMatchObject({
    soldUnitNights: 1,
    availableUnitNights: 2,
    netRevenueVnd: 900_000,
    occupancy: { numerator: 1n, denominator: 2n },
    adr: { numerator: 900_000n, denominator: 1n },
    revpar: { numerator: 900_000n, denominator: 2n },
    cancellationRate: null,
  });
});

test('DOR counts beds; inactive/blocked rooms contribute no available units', () => {
  const result = value(
    input({
      roomNights: [
        room({ roomId: 'dorm', kind: 'DOR', bedCount: 6, soldUnits: 3, netRevenueVnd: 600_000 }),
        room({ roomId: 'blocked', blocked: true, soldUnits: 0, netRevenueVnd: 0 }),
        room({ roomId: 'inactive', active: false, soldUnits: 0, netRevenueVnd: 0 }),
        room({
          roomId: 'blocked-dorm',
          kind: 'DOR',
          bedCount: 6,
          blocked: true,
          soldUnits: 0,
          netRevenueVnd: 0,
        }),
      ],
    }),
  );
  expect(result.soldUnitNights).toBe(3);
  expect(result.availableUnitNights).toBe(6);
  expect(result.occupancy).toEqual({ numerator: 3n, denominator: 6n });
  expect(result.adr).toEqual({ numerator: 600_000n, denominator: 3n });
});

test('TC-REP-01: 30 days / 24 physical rooms, two six-bed DORs; total is ratio of totals', () => {
  const roomNights: RoomNightFact[] = [];
  for (let day = 1; day <= 30; day++) {
    const businessDate = `2030-11-${String(day).padStart(2, '0')}`;
    for (let index = 0; index < 24; index++) {
      const blocked = day === 1 && index === 0;
      const dorm = index >= 22;
      roomNights.push(
        room({
          roomId: `room-${index}`,
          businessDate,
          kind: dorm ? 'DOR' : 'PRIVATE',
          bedCount: dorm ? 6 : 1,
          blocked,
          soldUnits: blocked ? 0 : dorm ? 3 : 1,
          netRevenueVnd: blocked ? 0 : 900_000,
        }),
      );
    }
  }
  const result = value(input({ roomNights }));
  expect(result).toMatchObject({
    availableUnitNights: 1019,
    soldUnitNights: 839,
    netRevenueVnd: 647_100_000,
    occupancy: { numerator: 839n, denominator: 1019n },
    adr: { numerator: 647_100_000n, denominator: 839n },
    revpar: { numerator: 647_100_000n, denominator: 1019n },
  });
  const firstDay = value(input({ to: '2030-11-02', roomNights }));
  expect(firstDay).toMatchObject({
    availableUnitNights: 33,
    soldUnitNights: 27,
    netRevenueVnd: 20_700_000,
  });
  const rest = value(input({ from: '2030-11-02', roomNights }));
  expect(firstDay.availableUnitNights + rest.availableUnitNights).toBe(result.availableUnitNights);
  expect(firstDay.netRevenueVnd + rest.netRevenueVnd).toBe(result.netRevenueVnd);
});

test('cancellation cohort is booking creation date in [from,to), including current cancelled status', () => {
  expect(
    value(
      input({
        bookings: [
          { bookingId: 'before', createdOn: '2030-10-31', cancelled: true },
          { bookingId: 'start', createdOn: '2030-11-01', cancelled: true },
          { bookingId: 'middle', createdOn: '2030-11-10', cancelled: false },
          { bookingId: 'end', createdOn: '2030-12-01', cancelled: true },
        ],
      }),
    ),
  ).toMatchObject({
    bookingsCreated: 2,
    cancelledBookings: 1,
    cancellationRate: { numerator: 1n, denominator: 2n },
  });
});

test('overbooking cost has three separate components; refund is not an input cost', () => {
  const result = value(
    input({
      overbookingCosts: [
        {
          businessDate: '2030-11-01',
          mergeDiscountVnd: 360_000,
          walkOutCompensationVnd: 1_100_000,
          transportSupportVnd: 120_000,
        },
        {
          businessDate: '2030-11-30',
          mergeDiscountVnd: 581_600,
          walkOutCompensationVnd: 0,
          transportSupportVnd: 0,
        },
        {
          businessDate: '2030-12-01',
          mergeDiscountVnd: 999,
          walkOutCompensationVnd: 999,
          transportSupportVnd: 999,
        },
      ],
    }),
  );
  expect(result.overbookingCost).toEqual({
    mergeDiscountVnd: 941_600,
    walkOutCompensationVnd: 1_100_000,
    transportSupportVnd: 120_000,
    totalVnd: 2_161_600,
  });
  expect(result.netRevenueVnd).toBe(900_000);
});

test('empty/zero denominators are undefined, zero sales with capacity is exactly zero', () => {
  expect(value(input({ roomNights: [] }))).toMatchObject({
    occupancy: null,
    adr: null,
    revpar: null,
    cancellationRate: null,
  });
  expect(value(input({ roomNights: [room({ soldUnits: 0, netRevenueVnd: 0 })] }))).toMatchObject({
    occupancy: { numerator: 0n, denominator: 1n },
    adr: null,
    revpar: { numerator: 0n, denominator: 1n },
  });
});

test('does not hide overselling by capping occupancy at 100 percent', () => {
  expect(value(input({ roomNights: [room({ soldUnits: 2 })] })).occupancy).toEqual({
    numerator: 2n,
    denominator: 1n,
  });
});

test('outside-period facts do not contribute room nights, revenue or cost', () => {
  const facts = input({
    roomNights: [room({ businessDate: '2030-10-31' }), room({ businessDate: '2030-12-01' })],
    overbookingCosts: [
      {
        businessDate: '2030-10-31',
        mergeDiscountVnd: 1000,
        walkOutCompensationVnd: 0,
        transportSupportVnd: 0,
      },
    ],
  });
  expect(value(facts)).toMatchObject({
    soldUnitNights: 0,
    availableUnitNights: 0,
    netRevenueVnd: 0,
    overbookingCost: { totalVnd: 0 },
  });
});

test.each(['2030-02-29', '2030-11-31', '2030-00-01', 'invalid', '2030-1-01'])(
  'rejects invalid range date %s',
  (from) => {
    expect(calculateReportingMetrics(input({ from }))).toMatchObject({
      ok: false,
      error: { code: 'E_REPORT_INVALID_INPUT' },
    });
  },
);
test.each(['2030-11-01', '2030-10-01'])('rejects nonpositive range to=%s', (to) => {
  expect(calculateReportingMetrics(input({ to }))).toMatchObject({
    ok: false,
    error: { code: 'E_REPORT_INVALID_INPUT' },
  });
});
test('leap-day range is valid and uses business-date strings without time zone conversion', () => {
  expect(
    value(
      input({
        from: '2032-02-29',
        to: '2032-03-01',
        roomNights: [room({ businessDate: '2032-02-29' })],
      }),
    ).soldUnitNights,
  ).toBe(1);
});

test.each([
  room({ roomId: '' }),
  room({ businessDate: '2030-02-29' }),
  room({ bedCount: 0 }),
  room({ bedCount: 2 }),
  room({ kind: 'DOR', bedCount: 1.5 }),
  room({ soldUnits: -1 }),
  room({ netRevenueVnd: 1.5 }),
  room({ netRevenueVnd: Number.MAX_SAFE_INTEGER + 1 }),
])('rejects invalid room-night fact %#', (fact) => {
  expect(calculateReportingMetrics(input({ roomNights: [fact] }))).toMatchObject({
    ok: false,
    error: { code: 'E_REPORT_INVALID_INPUT' },
  });
});
test('rejects duplicate room/day and duplicate booking facts rather than double-counting', () => {
  expect(calculateReportingMetrics(input({ roomNights: [room(), room()] })).ok).toBe(false);
  const booking = { bookingId: 'same', createdOn: '2030-11-01', cancelled: false };
  expect(calculateReportingMetrics(input({ bookings: [booking, booking] })).ok).toBe(false);
});
test.each([
  { bookingId: '', createdOn: '2030-11-01', cancelled: true },
  { bookingId: 'bad', createdOn: '2030-11-31', cancelled: true },
])('rejects invalid booking %#', (booking) => {
  expect(calculateReportingMetrics(input({ bookings: [booking] })).ok).toBe(false);
});
test.each([
  { businessDate: 'bad', mergeDiscountVnd: 0, walkOutCompensationVnd: 0, transportSupportVnd: 0 },
  {
    businessDate: '2030-11-01',
    mergeDiscountVnd: -1,
    walkOutCompensationVnd: 0,
    transportSupportVnd: 0,
  },
  {
    businessDate: '2030-11-01',
    mergeDiscountVnd: 0,
    walkOutCompensationVnd: -1,
    transportSupportVnd: 0,
  },
  {
    businessDate: '2030-11-01',
    mergeDiscountVnd: 0,
    walkOutCompensationVnd: 0,
    transportSupportVnd: -1,
  },
])('rejects invalid cost %#', (cost) => {
  expect(calculateReportingMetrics(input({ overbookingCosts: [cost] })).ok).toBe(false);
});

test.each(['revenue', 'sold', 'available', 'cost'] as const)(
  'rejects unsafe aggregate %s without float loss',
  (kind) => {
    const max = Number.MAX_SAFE_INTEGER;
    const roomNights =
      kind === 'sold'
        ? [room({ soldUnits: max }), room({ roomId: 'second' })]
        : kind === 'available'
          ? [room({ kind: 'DOR', bedCount: max }), room({ roomId: 'second' })]
          : kind === 'cost'
            ? [room()]
            : [room({ netRevenueVnd: max }), room({ roomId: 'second', netRevenueVnd: 1 })];
    const facts = input({
      roomNights,
      overbookingCosts:
        kind === 'cost'
          ? [
              {
                businessDate: '2030-11-01',
                mergeDiscountVnd: max,
                walkOutCompensationVnd: 1,
                transportSupportVnd: 0,
              },
            ]
          : [],
    });
    expect(calculateReportingMetrics(facts)).toMatchObject({
      ok: false,
      error: { code: 'E_REPORT_UNSAFE_TOTAL' },
    });
  },
);

test('safe integer upper boundary is preserved exactly, input is immutable and deterministic', () => {
  const facts = input({ roomNights: [room({ netRevenueVnd: Number.MAX_SAFE_INTEGER })] });
  const original = structuredClone(facts);
  Object.freeze(facts.roomNights[0]);
  Object.freeze(facts.roomNights);
  Object.freeze(facts);
  const first = calculateReportingMetrics(facts);
  expect(first).toEqual(calculateReportingMetrics(facts));
  expect(first).toMatchObject({
    ok: true,
    value: { adr: { numerator: 9007199254740991n, denominator: 1n } },
  });
  expect(facts).toEqual(original);
});
