import { calculateAvailability } from '../../src/inventory/index.js';
import type {
  Availability,
  AvailabilityInput,
  Demand,
  SellingUnit,
} from '../../src/inventory/index.js';
export const unit = (roomId: string, bedNo = 0): SellingUnit => ({
  propertyId: 'p',
  roomTypeId: 't',
  roomId,
  bedNo,
  status: 'ACTIVE',
});
export const fixture: AvailabilityInput = {
  propertyId: 'p',
  roomTypeId: 't',
  channelCode: 'WEB',
  checkIn: '2026-11-20',
  checkOut: '2026-11-21',
  now: new Date('2026-11-01T00:00:00Z'),
  units: [unit('r')],
  demand: [],
  blocks: [],
  assignments: [],
  allotments: [],
};
export const obligation = (bookingRoomId: string, changes: Partial<Demand> = {}): Demand => ({
  propertyId: 'p',
  roomTypeId: 't',
  checkIn: fixture.checkIn,
  checkOut: fixture.checkOut,
  bookingRoomId,
  channelCode: 'WEB',
  status: 'CONFIRMED',
  ...changes,
});
export function snapshot(changes: Partial<AvailabilityInput> = {}): Availability {
  const result = calculateAvailability({ ...fixture, ...changes });
  if (result.ok) return result.value;
  if (result.error.code === 'E_INV_NO_AVAILABILITY') return result.error.availability;
  throw new Error(result.error.message);
}
