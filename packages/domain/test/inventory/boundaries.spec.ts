import { expect, it } from 'vitest';
import { calculateAvailability } from '../../src/inventory/index.js';
import { fixture, obligation, snapshot, unit } from './fixtures.js';

it.each(['clock', 'deadline'])(
  'rejects a malformed %s instead of freeing an assigned live hold',
  (field) => {
    const demand = obligation('held', {
      status: 'HELD',
      holdExpiresAt: field === 'deadline' ? new Date(NaN) : new Date('2026-11-02Z'),
    });
    const result = calculateAvailability({
      ...fixture,
      now: field === 'clock' ? new Date(NaN) : fixture.now,
      demand: [demand],
      assignments: [{ ...demand, roomId: 'r', bedNo: 0, releasedAt: null }],
    });
    expect(result).toMatchObject({ ok: false, error: { code: 'E_INV_INVALID_INPUT' } });
  },
);
it.each([NaN, Infinity, -Infinity, -1, 0.5, Number.MAX_SAFE_INTEGER + 1])(
  'rejects quota %s before selling',
  (allotment) => {
    expect(
      calculateAvailability({
        ...fixture,
        channelCode: 'AGENCY',
        allotments: [{ ...fixture, channelCode: 'AGENCY', date: fixture.checkIn, allotment }],
      }),
    ).toMatchObject({ ok: false, error: { code: 'E_INV_INVALID_INPUT' } });
  },
);
it('routes one BookingRoom across allocated and unassigned half-open nightly segments without duplication', () => {
  const demand = [
    obligation('b', { allocatedLocation: { propertyId: 'destination', roomTypeId: 'other' } }),
    obligation('b', { checkIn: fixture.checkOut, checkOut: '2026-11-22' }),
  ];
  const query = { checkOut: '2026-11-22', demand: [...demand, ...demand] };
  expect(snapshot(query).nightly.map((n) => n.demand)).toEqual([0, 1]);
  expect(
    snapshot({
      ...query,
      propertyId: 'destination',
      roomTypeId: 'other',
      units: [{ ...unit('d'), propertyId: 'destination', roomTypeId: 'other' }],
    }).nightly.map((n) => n.demand),
  ).toEqual([1, 0]);
});
