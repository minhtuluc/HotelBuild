import { expect, it } from 'vitest';
import fc from 'fast-check';
import { fixture, obligation, snapshot, unit } from './fixtures.js';
import { calculateAvailability } from '../../src/inventory/index.js';
import type {
  AvailabilityInput,
  ChannelCode,
  ChannelAllotment,
} from '../../src/inventory/index.js';

it('calculates the pool through the public inventory entrypoint', () => {
  const result = calculateAvailability(fixture);
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error(result.error.code);
  expect(result.value.nightly[0]?.pool).toBe(1);
});
it('TC-INV-05 counts obligations once across all channels without adding assignments', () => {
  const demand = Array.from({ length: 5 }, (_, i) =>
    obligation(`b${i}`, {
      channelCode: 'OTA_BOOKING',
      ...(i >= 3 ? { status: 'HELD', holdExpiresAt: new Date('2026-11-02Z') } : {}),
    }),
  );
  expect(
    snapshot({
      channelCode: 'OTA_BOOKING',
      units: Array.from({ length: 20 }, (_, i) => unit(`r${i}`)),
      demand: [...demand, ...demand],
      blocks: [{ roomId: 'r19', checkIn: fixture.checkIn, checkOut: fixture.checkOut }],
      assignments: demand
        .slice(0, 3)
        .map((d, i) => ({ ...d, roomId: `r${i}`, bedNo: 0, releasedAt: null })),
      allotments: [
        {
          propertyId: 'p',
          roomTypeId: 't',
          channelCode: 'OTA_BOOKING',
          date: fixture.checkIn,
          allotment: 15,
        },
      ],
    }).nightly[0],
  ).toMatchObject({
    supply: 19,
    demand: 5,
    pool: 14,
    used: 5,
    channelAvailability: 10,
    physicalAvailability: 16,
  });
});
it('TC-INV-04 ignores expired holds before a cleanup job, with strict deadline equality', () => {
  const demand = ['HELD', 'PENDING_PAYMENT'].flatMap((status) =>
    status === 'HELD' || status === 'PENDING_PAYMENT'
      ? [-1, 0, 1].map((delta) =>
          obligation(`${status}${delta}`, {
            status,
            holdExpiresAt: new Date(fixture.now.getTime() + delta),
          }),
        )
      : [],
  );
  expect(snapshot({ units: [unit('a'), unit('b'), unit('c')], demand }).nightly[0]).toMatchObject({
    demand: 2,
    used: 2,
    pool: 1,
  });
  expect(
    snapshot({
      demand: [
        obligation('no-deadline', { status: 'HELD' }),
        obligation('null', { status: 'PENDING_PAYMENT', holdExpiresAt: null }),
        obligation('cancel', { status: 'CANCELLED' }),
        obligation('expired', { status: 'EXPIRED' }),
        obligation('out', { status: 'CHECKED_OUT' }),
      ],
    }).nightly[0]?.demand,
  ).toBe(0);
});
it('counts CHECKED_IN, obligations on other channels, and unassigned oversold demand with a negative pool', () => {
  expect(
    snapshot({
      demand: [
        obligation('a', { channelCode: 'OTA_BOOKING', status: 'CHECKED_IN' }),
        obligation('b'),
      ],
    }).nightly[0],
  ).toMatchObject({
    demand: 2,
    used: 1,
    pool: -1,
    commercialAvailability: 0,
    channelAvailability: 0,
    physicalAvailability: 1,
  });
});
it('uses actual allocated location after move and committed location while unassigned', () => {
  expect(
    snapshot({
      demand: [
        obligation('moved-out', { allocatedLocation: { propertyId: 'other', roomTypeId: 't' } }),
        obligation('moved-in', {
          propertyId: 'other',
          roomTypeId: 'other',
          allocatedLocation: { propertyId: 'p', roomTypeId: 't' },
        }),
        obligation('other-type', { roomTypeId: 'other' }),
        obligation('unassigned'),
      ],
    }).nightly[0]?.demand,
  ).toBe(2);
});
it('deduplicates ACTIVE units and the union of repeated blocks and active assignments', () => {
  const range = { checkIn: fixture.checkIn, checkOut: fixture.checkOut };
  expect(
    snapshot({
      units: [
        unit('a'),
        unit('a'),
        unit('b'),
        { ...unit('c'), status: 'MAINTENANCE' },
        { ...unit('d'), status: 'INACTIVE' },
        { ...unit('e'), propertyId: 'other' },
        { ...unit('f'), roomTypeId: 'other' },
      ],
      blocks: [
        { ...range, roomId: 'a' },
        { ...range, roomId: 'a', bedNo: 0 },
      ],
      assignments: [
        { ...range, roomId: 'a', bedNo: 0, bookingRoomId: 'a', releasedAt: null },
        { ...range, roomId: 'b', bedNo: 0, bookingRoomId: 'b', releasedAt: fixture.now },
      ],
    }).nightly[0],
  ).toMatchObject({ supply: 1, pool: 1, physicalAvailability: 1 });
});
it('expired demand releases its associated assignment logically; confirmed and unknown assignments still occupy units', () => {
  const assignment = {
    checkIn: fixture.checkIn,
    checkOut: fixture.checkOut,
    roomId: 'r',
    bedNo: 0,
    bookingRoomId: 'b',
    releasedAt: null,
  };
  expect(
    snapshot({
      assignments: [assignment],
      demand: [obligation('b', { status: 'HELD', holdExpiresAt: fixture.now })],
    }).nightly[0]?.physicalAvailability,
  ).toBe(1);
  expect(
    snapshot({ assignments: [assignment], demand: [obligation('b')] }).nightly[0]
      ?.physicalAvailability,
  ).toBe(0);
  expect(snapshot({ assignments: [assignment] }).nightly[0]?.physicalAvailability).toBe(0);
});
it('TC-INV-06 rejects a five-night stay when the third night has no supply, with shortage dates', () => {
  const result = calculateAvailability({
    ...fixture,
    checkOut: '2026-11-25',
    blocks: [{ roomId: 'r', checkIn: '2026-11-22', checkOut: '2026-11-23' }],
  });
  expect(result.ok).toBe(false);
  if (result.ok || result.error.code !== 'E_INV_NO_AVAILABILITY')
    throw new Error('Expected shortage');
  expect(result.error.availability.shortageDates).toEqual(['2026-11-22']);
  expect(result.error.availability.continuousUnits).toEqual([]);
});
it('cannot infer continuous rooms from positive minimum nightly physical counts', () => {
  const result = calculateAvailability({
    ...fixture,
    units: [unit('a'), unit('b')],
    checkOut: '2026-11-22',
    blocks: [
      { roomId: 'a', checkIn: '2026-11-20', checkOut: '2026-11-21' },
      { roomId: 'b', checkIn: '2026-11-21', checkOut: '2026-11-22' },
    ],
  });
  expect(result).toMatchObject({ ok: false, error: { code: 'E_INV_NO_AVAILABILITY' } });
  if (result.ok || result.error.code !== 'E_INV_NO_AVAILABILITY')
    throw new Error('Expected continuity failure');
  const value = result.error.availability;
  expect(value.nightly.map((n) => n.physicalAvailability)).toEqual([1, 1]);
  expect(value.continuousUnits).toEqual([]);
  expect(value.continuousRoomIds).toEqual([]);
});
it('TC-INV-11 calculates DOR beds by composite identity and half-open adjacent stays', () => {
  const range = { checkIn: fixture.checkIn, checkOut: fixture.checkOut };
  const value = snapshot({
    units: [unit('a', 1), unit('a', 2), unit('b', 1), unit('b', 2), unit('c', 1)],
    blocks: [
      { ...range, roomId: 'b' },
      { ...range, roomId: 'c', bedNo: 2 },
    ],
    assignments: [
      { ...range, roomId: 'a', bedNo: 1, bookingRoomId: 'a', releasedAt: null },
      {
        ...range,
        checkOut: fixture.checkIn,
        checkIn: '2026-11-19',
        roomId: 'a',
        bedNo: 2,
        bookingRoomId: 'past',
        releasedAt: null,
      },
      {
        ...range,
        checkIn: fixture.checkOut,
        checkOut: '2026-11-22',
        roomId: 'c',
        bedNo: 1,
        bookingRoomId: 'future',
        releasedAt: null,
      },
    ],
    demand: [
      obligation('past', { checkIn: '2026-11-19', checkOut: fixture.checkIn }),
      obligation('future', { checkIn: fixture.checkOut, checkOut: '2026-11-22' }),
    ],
  });
  expect(value.nightly[0]).toMatchObject({ supply: 3, physicalAvailability: 2, demand: 0 });
  expect(value.continuousUnits).toEqual([
    { roomId: 'a', bedNo: 2 },
    { roomId: 'c', bedNo: 1 },
  ]);
  expect(value.continuousRoomIds).toEqual(['a', 'c']);
});
it('applies per-night allotments, every same-channel hold, and leaves direct channels uncapped', () => {
  const allotments: ChannelAllotment[] = ['2026-11-20', '2026-11-21'].map((date, i) => ({
    propertyId: 'p',
    roomTypeId: 't',
    channelCode: 'OTA_BOOKING',
    date,
    allotment: i + 1,
  }));
  expect(
    snapshot({
      units: [unit('a'), unit('b'), unit('c')],
      channelCode: 'OTA_BOOKING',
      checkOut: '2026-11-22',
      allotments,
      demand: [
        obligation('held', {
          channelCode: 'OTA_BOOKING',
          status: 'HELD',
          holdExpiresAt: new Date('2026-11-02Z'),
          checkOut: '2026-11-22',
        }),
      ],
    }).nightly.map((n) => n.channelAvailability),
  ).toEqual([0, 1]);
  for (const channelCode of ['WEB', 'PHONE', 'WALKIN'] satisfies ChannelCode[])
    expect(
      snapshot({ channelCode, allotments: [{ ...allotments[0]!, channelCode, allotment: 0 }] })
        .nightly[0]?.channelAvailability,
    ).toBe(1);
  expect(snapshot({ channelCode: 'OTA_BOOKING' }).nightly[0]?.channelAvailability).toBe(1);
  expect(
    snapshot({
      channelCode: 'OTA_BOOKING',
      allotments: allotments.map((row) => ({ ...row, propertyId: 'other' })),
    }).nightly[0]?.channelAvailability,
  ).toBe(1);
});
it('keeps date arithmetic deterministic across month and year boundaries', () => {
  expect(
    snapshot({ checkIn: '2026-12-31', checkOut: '2027-01-02' }).nightly.map((n) => n.date),
  ).toEqual(['2026-12-31', '2027-01-01']);
});
it.each([
  ['2026-11-21', '2026-11-20'],
  ['2026-11-20', '2026-11-20'],
  ['2026-02-30', '2026-03-02'],
  ['bad', '2026-11-21'],
])('rejects invalid stay %s to %s', (checkIn, checkOut) => {
  expect(calculateAvailability({ ...fixture, checkIn, checkOut })).toMatchObject({
    ok: false,
    error: { code: 'E_INV_INVALID_INPUT' },
  });
});
it('adding blocks or obligations never increases commercial availability and never mutates inputs', () => {
  fc.assert(
    fc.property(fc.integer({ min: 1, max: 20 }), fc.integer({ min: 0, max: 25 }), (count, sold) => {
      const input: AvailabilityInput = {
        ...fixture,
        units: Array.from({ length: count }, (_, i) => unit(`r${i}`)),
        demand: Array.from({ length: sold }, (_, i) => obligation(`b${i}`)),
      };
      const before = structuredClone(input);
      const base = snapshot(input).nightly[0]?.commercialAvailability;
      expect(
        snapshot({
          ...input,
          blocks: [{ roomId: 'r0', checkIn: fixture.checkIn, checkOut: fixture.checkOut }],
        }).nightly[0]?.commercialAvailability,
      ).toBeLessThanOrEqual(base ?? 0);
      expect(
        snapshot({ ...input, demand: [...input.demand, obligation('extra')] }).nightly[0]
          ?.commercialAvailability,
      ).toBeLessThanOrEqual(base ?? 0);
      expect(calculateAvailability(input)).toEqual(calculateAvailability(input));
      expect(input).toEqual(before);
    }),
  );
});
for (const code of [
  'TC-INV-01',
  'TC-INV-02',
  'TC-INV-03',
  'TC-INV-07',
  'TC-INV-08',
  'TC-INV-09',
  'TC-INV-10',
])
  it.todo(`${code}: CSDL/transaction/integration/load thuộc HB-076/HB-008`);
it.todo('TC-INV-04: scheduler release SLA and transaction thuộc HB-076/HB-008');
it.todo('TC-INV-11: SQL exclusion and bedNo mode validation thuộc HB-076/HB-008');

it('defaults each missing OTA quota to 80 percent of ACTIVE units before blocks, with a minimum of one', () => {
  for (const channelCode of ['OTA_BOOKING', 'OTA_AGODA', 'OTA_AIRBNB'] satisfies ChannelCode[]) {
    for (const count of [0, 1, 12]) {
      const units = Array.from({ length: count }, (_, i) => unit(`r${i}`, 1));
      expect(snapshot({ channelCode, units }).nightly[0]?.channelAvailability).toBe(
        count === 0 ? 0 : Math.max(1, Math.floor(count * 0.8)),
      );
    }
    expect(
      snapshot({
        channelCode,
        units: Array.from({ length: 5 }, (_, i) => unit(`r${i}`)),
        blocks: [{ roomId: 'r0', checkIn: fixture.checkIn, checkOut: fixture.checkOut }],
      }).nightly[0]?.channelAvailability,
    ).toBe(4);
  }
  expect(snapshot({ channelCode: 'AGENCY' }).nightly[0]?.channelAvailability).toBe(0);
});
