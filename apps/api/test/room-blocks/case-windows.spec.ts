import { expect, test } from 'vitest';
import type { AvailabilityInput, Demand } from '@pinehill/domain/inventory';
import { caseWindows } from '../../src/modules/prop/room-blocks/case-windows.js';
const facts = (demand: Demand[]): AvailabilityInput => ({
  propertyId: 'A',
  roomTypeId: 'STD',
  checkIn: '0001-01-01',
  checkOut: '9999-12-31',
  channelCode: 'WEB',
  now: new Date('2026-10-09T00:00:00Z'),
  units: [],
  blocks: [],
  assignments: [],
  allotments: [],
  demand,
});
const demand = (checkIn: string, checkOut: string): Demand => ({
  bookingRoomId: 'b1',
  propertyId: 'A',
  roomTypeId: 'STD',
  channelCode: 'WEB',
  status: 'CONFIRMED',
  checkIn,
  checkOut,
});
test('a maximum representable block with no effective demand produces no date enumeration', () => {
  expect([...caseWindows(facts([]))]).toEqual([]);
  expect([
    ...caseWindows(facts([{ ...demand('2026-11-01', '2026-11-04'), status: 'EXPIRED' }])),
  ]).toEqual([]);
});
test('only effective actual-location demand ranges become bounded windows, gaps remain absent', () => {
  const input = facts([
    demand('2026-11-01', '2026-11-04'),
    demand('2026-11-02', '2026-11-06'),
    demand('2026-12-01', '2026-12-03'),
    {
      ...demand('2027-01-01', '2028-01-01'),
      allocatedLocation: { propertyId: 'B', roomTypeId: 'STD' },
    },
    { ...demand('2028-01-01', '2028-02-01'), status: 'HELD', holdExpiresAt: new Date(0) },
  ]);
  expect([...caseWindows(input)]).toEqual([
    { checkIn: '2026-11-01', checkOut: '2026-11-06' },
    { checkIn: '2026-12-01', checkOut: '2026-12-03' },
  ]);
});
test('a long obligation is streamed as windows of at most 31 nights with exact half-open boundaries', () => {
  expect([...caseWindows(facts([demand('2026-11-01', '2027-01-04')]))]).toEqual([
    { checkIn: '2026-11-01', checkOut: '2026-12-02' },
    { checkIn: '2026-12-02', checkOut: '2027-01-02' },
    { checkIn: '2027-01-02', checkOut: '2027-01-04' },
  ]);
});
