import { err, ok } from '../shared/result.js';
import type { Result } from '../shared/result.js';
export interface Location {
  readonly propertyId: string;
  readonly roomTypeId: string;
}
export interface UnitIdentity {
  readonly roomId: string;
  readonly bedNo: number;
}
/** Loaded selling units: whole rooms use bedNo 0; dorm beds use 1..bedCount. */
export interface SellingUnit extends Location, UnitIdentity {
  readonly status: 'ACTIVE' | 'MAINTENANCE' | 'INACTIVE';
}
export interface NightRange {
  readonly checkIn: string;
  readonly checkOut: string;
}
export interface RoomBlock extends NightRange {
  readonly roomId: string;
  /** Omitted means the entire room, including all dorm beds. */
  readonly bedNo?: number;
}
export interface Assignment extends NightRange, UnitIdentity {
  readonly bookingRoomId: string;
  readonly releasedAt: Date | null;
}
export interface Demand extends NightRange, Location {
  readonly bookingRoomId: string;
  readonly channelCode: string;
  readonly status:
    | 'CONFIRMED'
    | 'CHECKED_IN'
    | 'HELD'
    | 'PENDING_PAYMENT'
    | 'CANCELLED'
    | 'EXPIRED'
    | 'CHECKED_OUT';
  readonly holdExpiresAt?: Date | null;
  /** Actual location for this demand segment after allocation/move. */
  readonly allocatedLocation?: Location;
}
export interface ChannelAllotment extends Location {
  readonly channelCode: string;
  readonly date: string;
  /** null explicitly represents a channel without a separate limit. */
  readonly allotment: number | null;
}
export interface AvailabilityInput extends Location, NightRange {
  readonly channelCode: string;
  readonly now: Date;
  readonly units: readonly SellingUnit[];
  readonly blocks: readonly RoomBlock[];
  readonly assignments: readonly Assignment[];
  readonly demand: readonly Demand[];
  readonly allotments: readonly ChannelAllotment[];
}
export interface NightlyAvailability {
  readonly date: string;
  readonly supply: number;
  readonly demand: number;
  readonly pool: number;
  readonly used: number;
  readonly commercialAvailability: number;
  readonly channelAvailability: number;
  readonly physicalAvailability: number;
}
export interface Availability {
  readonly nightly: readonly NightlyAvailability[];
  readonly shortageDates: readonly string[];
  readonly continuousUnits: readonly UnitIdentity[];
  readonly continuousRoomIds: readonly string[];
}
export type AvailabilityFailure =
  | { readonly code: 'E_INV_NO_AVAILABILITY'; readonly availability: Availability }
  | { readonly code: 'E_INV_INVALID_INPUT'; readonly message: string };

const dayMilliseconds = 86_400_000;
const directChannels = new Set(['WEB', 'PHONE', 'WALKIN']);
function unitKey(unit: UnitIdentity): string {
  return JSON.stringify([unit.roomId, unit.bedNo]);
}
function sameLocation(left: Location, right: Location): boolean {
  return left.propertyId === right.propertyId && left.roomTypeId === right.roomTypeId;
}
function overlaps(range: NightRange, date: string): boolean {
  return range.checkIn <= date && date < range.checkOut;
}
function effective(demand: Demand, now: Date): boolean {
  if (demand.status === 'CONFIRMED' || demand.status === 'CHECKED_IN') return true;
  if (demand.status !== 'HELD' && demand.status !== 'PENDING_PAYMENT') return false;
  return (demand.holdExpiresAt?.getTime() ?? Number.NEGATIVE_INFINITY) > now.getTime();
}
function dateTimestamp(date: string): number {
  const timestamp = Date.parse(`${date}T00:00:00.000Z`);
  if (!Number.isFinite(timestamp)) return Number.NaN;
  return new Date(timestamp).toISOString().slice(0, 10) === date ? timestamp : Number.NaN;
}
function stayDates(input: NightRange): string[] {
  const start = dateTimestamp(input.checkIn);
  const end = dateTimestamp(input.checkOut);
  if (!Number.isFinite(start) || !Number.isFinite(end) || start >= end) return [];
  const dates: string[] = [];
  for (let timestamp = start; timestamp < end; timestamp += dayMilliseconds) {
    dates.push(new Date(timestamp).toISOString().slice(0, 10));
  }
  return dates;
}
function activeUnits(input: AvailabilityInput): SellingUnit[] {
  const unique = new Map<string, SellingUnit>();
  for (const unit of input.units) {
    if (unit.status === 'ACTIVE' && sameLocation(unit, input)) unique.set(unitKey(unit), unit);
  }
  return [...unique.values()];
}
function nightlyDemand(input: AvailabilityInput, date: string): Demand[] {
  const unique = new Map<string, Demand>();
  for (const demand of input.demand) {
    if (
      overlaps(demand, date) &&
      effective(demand, input.now) &&
      sameLocation(demand.allocatedLocation ?? demand, input)
    ) {
      unique.set(demand.bookingRoomId, demand);
    }
  }
  return [...unique.values()];
}
function assignmentActive(assignment: Assignment, input: AvailabilityInput, date: string): boolean {
  if (assignment.releasedAt !== null || !overlaps(assignment, date)) return false;
  const obligations = input.demand.filter(
    (demand) => demand.bookingRoomId === assignment.bookingRoomId && overlaps(demand, date),
  );
  // Missing demand facts must not turn a loaded active assignment into a free unit.
  return obligations.length === 0 || obligations.some((demand) => effective(demand, input.now));
}
function blockedKeys(
  input: AvailabilityInput,
  units: readonly SellingUnit[],
  date: string,
): Set<string> {
  return new Set(
    units
      .filter((unit) =>
        input.blocks.some(
          (block) =>
            overlaps(block, date) &&
            block.roomId === unit.roomId &&
            (block.bedNo === undefined || block.bedNo === unit.bedNo),
        ),
      )
      .map(unitKey),
  );
}
function channelAvailability(
  input: AvailabilityInput,
  date: string,
  pool: number,
  used: number,
): number {
  if (directChannels.has(input.channelCode)) return Math.max(0, pool);
  const allotment = input.allotments.find(
    (item) =>
      sameLocation(item, input) && item.channelCode === input.channelCode && item.date === date,
  );
  // A missing limited-channel configuration grants no quota; null is explicit unlimited.
  if (!allotment) return 0;
  if (allotment.allotment === null) return Math.max(0, pool);
  return Math.max(0, Math.min(pool, allotment.allotment - used));
}
function calculateNight(
  input: AvailabilityInput,
  units: readonly SellingUnit[],
  date: string,
): {
  readonly nightly: NightlyAvailability;
  readonly free: readonly SellingUnit[];
} {
  const blocked = blockedKeys(input, units, date);
  const assigned = new Set(
    input.assignments
      .filter((assignment) => assignmentActive(assignment, input, date))
      .map(unitKey),
  );
  const free = units.filter((unit) => !blocked.has(unitKey(unit)) && !assigned.has(unitKey(unit)));
  const demands = nightlyDemand(input, date);
  const supply = units.length - blocked.size;
  const pool = supply - demands.length;
  const used = demands.filter((demand) => demand.channelCode === input.channelCode).length;
  return {
    free,
    nightly: {
      date,
      supply,
      demand: demands.length,
      pool,
      used,
      commercialAvailability: Math.max(0, pool),
      channelAvailability: channelAvailability(input, date, pool, used),
      physicalAvailability: free.length,
    },
  };
}
/** Pure per-night calculation. Loaded unit identities and ranges must satisfy DB constraints. */
export function calculateAvailability(
  input: AvailabilityInput,
): Result<Availability, AvailabilityFailure> {
  const dates = stayDates(input);
  if (dates.length === 0)
    return err({
      code: 'E_INV_INVALID_INPUT',
      message: 'Expected a valid nonempty [checkIn, checkOut) date range',
    });
  const units = activeUnits(input);
  const nights = dates.map((date) => calculateNight(input, units, date));
  const nightly = nights.map((night) => night.nightly);
  const continuousUnits = units
    .filter((unit) =>
      nights.every((night) => night.free.some((free) => unitKey(free) === unitKey(unit))),
    )
    .map((unit) => ({ roomId: unit.roomId, bedNo: unit.bedNo }));
  const shortageDates = nightly
    .filter((night) => night.channelAvailability === 0 || night.physicalAvailability === 0)
    .map((night) => night.date);
  const availability: Availability = {
    nightly,
    shortageDates,
    continuousUnits,
    continuousRoomIds: [...new Set(continuousUnits.map((unit) => unit.roomId))],
  };
  if (shortageDates.length > 0 || continuousUnits.length === 0)
    return err({ code: 'E_INV_NO_AVAILABILITY', availability });
  return ok(availability);
}
