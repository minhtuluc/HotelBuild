/**
 * Overbooking relocation planner (BR-OVER-05 §6, BR-OVER-06, BR-OVER-07, BR-OVER-09).
 *
 * The planner receives a loaded snapshot (`now`, IDs, room stock, geography) and returns a proposal:
 * it never holds inventory, never mutates assignments and never spends money. Execution is a
 * separate, approved workflow.
 *
 * The standard ladder is previewed in full (four steps) but executed in order 1 → 2 → 4 whenever the
 * current geography makes step 3 infeasible: the three Đà Lạt–Vũng Tàu–Phan Thiết properties are
 * 160–300 km apart, so a distant room is never used as step 3. It only appears as a separate
 * BR-OVER-07 exception that needs written guest consent and `MANAGER`+ approval.
 */
import { err, ok } from '../../shared/result.js';
import type { Result } from '../../shared/result.js';
import type { ContinuousRoomAvailability, RelocationRoomStock } from './continuous-stay.js';
import { continuousStayRooms, isStayDate } from './continuous-stay.js';
import type { GeographyIndex } from './geography.js';
import { indexGeography, standardStep3GapNote, step3Eligibility } from './geography.js';
import type {
  CrossCityExceptionOption,
  CrossCityExceptionPreview,
  RelocationLadderMoveType,
  RelocationLadderStep,
  RelocationLadderStepNumber,
  RelocationPlan,
  RelocationPlanBooking,
  RelocationPlanFailure,
  RelocationPlanRequest,
  RelocationRoomChoice,
  WalkOutPreview,
} from './relocation-plan-types.js';

const BOOKING_STATUSES: Readonly<Record<string, true>> = {
  DRAFT: true,
  HELD: true,
  PENDING_PAYMENT: true,
  CONFIRMED: true,
  CHECKED_IN: true,
  CHECKED_OUT: true,
  CANCELLED: true,
  NO_SHOW: true,
  EXPIRED: true,
};

const NOTE_STEP_1 = 'Không còn phòng cùng loại cùng cơ sở trống liên tục cả kỳ';
const NOTE_STEP_2 = 'Không còn hạng cao hơn đủ sức chứa cùng cơ sở trống liên tục cả kỳ';
const NOTE_STEP_3_STOCK =
  'Không còn cơ sở khác trong bán kính 15 km cùng thành phố có phòng phù hợp trống liên tục cả kỳ';
const NOTE_STEP_4_CHECKED_IN =
  'CHECKED_IN chỉ được điều chuyển khi bất khả kháng và phải MANAGER+ duyệt';

/** Shared predicate: a trimmed, non-empty label. Used by every identity field. */
function isNonEmptyText(value: unknown): boolean {
  return typeof value === 'string' && value.trim().length > 0;
}

/** BR-GEN-01: money and counts are safe integer VND/rooms, never floating point. */
function isVndAmount(value: number, min = 0): boolean {
  return Number.isSafeInteger(value) && value >= min;
}

function failure(message: string): Result<never, RelocationPlanFailure> {
  return err({ code: 'E_OVER_INVALID_INPUT', message });
}

function normalizeStayDates(dates: readonly string[]): readonly string[] | null {
  if (dates.length === 0) return null;
  const unique = new Set<string>();
  for (const date of dates) {
    if (!isStayDate(date) || unique.has(date)) return null;
    unique.add(date);
  }
  return [...unique].sort();
}

function validBooking(booking: RelocationPlanBooking, index: GeographyIndex): boolean {
  return (
    isNonEmptyText(booking.bookingId) &&
    index.cities.has(booking.propertyId) &&
    isNonEmptyText(booking.roomTypeId) &&
    isVndAmount(booking.roomTypeBasePriceVnd) &&
    isVndAmount(booking.guestCount, 1) &&
    BOOKING_STATUSES[booking.status] === true &&
    isVndAmount(booking.paidAmountVnd) &&
    isVndAmount(booking.firstNightRateVnd)
  );
}

function validRoom(room: RelocationRoomStock, index: GeographyIndex): boolean {
  return (
    isNonEmptyText(room.roomId) &&
    index.cities.has(room.propertyId) &&
    isNonEmptyText(room.roomTypeId) &&
    isVndAmount(room.basePriceVnd) &&
    isVndAmount(room.capacityAdults) &&
    Array.isArray(room.occupiedDates) &&
    room.occupiedDates.every(isStayDate)
  );
}

function validRoomStock(stock: readonly RelocationRoomStock[], index: GeographyIndex): boolean {
  const ids = new Set<string>();
  for (const room of stock) {
    if (!validRoom(room, index) || ids.has(room.roomId)) return false;
    ids.add(room.roomId);
  }
  return true;
}

interface ValidatedRequest {
  readonly index: GeographyIndex;
  readonly stayDates: readonly string[];
}

function validateRequest(
  request: RelocationPlanRequest,
): Result<ValidatedRequest, RelocationPlanFailure> {
  if (!isNonEmptyText(request.planId)) return failure('Expected a caller-supplied plan ID');
  if (!Number.isSafeInteger(request.nowEpochMs))
    return failure('Expected a safe-integer evaluation instant');
  const geography = indexGeography(request.geography);
  if (!geography.ok) return geography;
  const stayDates = normalizeStayDates(request.stayDates);
  if (stayDates === null) return failure('Expected distinct normalized stay dates');
  if (!validBooking(request.booking, geography.value)) return failure('Invalid booking snapshot');
  if (!validRoomStock(request.roomStock, geography.value))
    return failure('Invalid room stock: expected unique rooms of configured properties');
  return ok({ index: geography.value, stayDates });
}

function isUpgrade(room: ContinuousRoomAvailability, booking: RelocationPlanBooking): boolean {
  return (
    room.roomTypeId !== booking.roomTypeId &&
    room.basePriceVnd > booking.roomTypeBasePriceVnd &&
    room.capacityAdults >= booking.guestCount
  );
}

function roomChoice(
  room: ContinuousRoomAvailability,
  moveType: RelocationLadderMoveType,
  requiresManagerApproval: boolean,
  requiresForceMajeure: boolean,
): RelocationRoomChoice {
  return {
    roomId: room.roomId,
    propertyId: room.propertyId,
    roomTypeId: room.roomTypeId,
    basePriceVnd: room.basePriceVnd,
    moveType,
    requiresManagerApproval,
    requiresForceMajeure,
  };
}

function sameTypeChoice(
  rooms: readonly ContinuousRoomAvailability[],
  booking: RelocationPlanBooking,
  checkedIn: boolean,
): {
  readonly candidates: readonly ContinuousRoomAvailability[];
  readonly choice: RelocationRoomChoice | null;
} {
  const candidates = rooms.filter((room) => room.roomTypeId === booking.roomTypeId);
  const first = candidates.at(0);
  return {
    candidates,
    choice:
      first === undefined
        ? null
        : roomChoice(first, 'SAME_TYPE_SAME_PROPERTY', checkedIn, checkedIn),
  };
}

function upgradeChoice(
  rooms: readonly ContinuousRoomAvailability[],
  booking: RelocationPlanBooking,
  checkedIn: boolean,
): {
  readonly candidates: readonly ContinuousRoomAvailability[];
  readonly choice: RelocationRoomChoice | null;
} {
  const candidates = rooms
    .filter((room) => isUpgrade(room, booking))
    .sort((left, right) =>
      left.basePriceVnd !== right.basePriceVnd
        ? left.basePriceVnd - right.basePriceVnd
        : left.roomId < right.roomId
          ? -1
          : left.roomId > right.roomId
            ? 1
            : 0,
    );
  const first = candidates.at(0);
  return {
    candidates,
    choice:
      first === undefined ? null : roomChoice(first, 'UPGRADE_SAME_PROPERTY', checkedIn, checkedIn),
  };
}

function stepRow(
  step: RelocationLadderStepNumber,
  moveType: RelocationLadderMoveType,
  candidateCount: number,
  note?: string,
): RelocationLadderStep {
  const row = { step, moveType, feasible: candidateCount > 0, candidateCount };
  return note === undefined ? row : { ...row, note };
}

interface CrossPropertyStock {
  readonly standard: readonly ContinuousRoomAvailability[];
  readonly exception: readonly {
    readonly room: ContinuousRoomAvailability;
    readonly city: string;
    readonly roadDistanceKm: number | null;
  }[];
}

function splitCrossPropertyStock(
  rooms: readonly ContinuousRoomAvailability[],
  booking: RelocationPlanBooking,
  index: GeographyIndex,
): CrossPropertyStock {
  const standard: ContinuousRoomAvailability[] = [];
  const exception: {
    room: ContinuousRoomAvailability;
    city: string;
    roadDistanceKm: number | null;
  }[] = [];
  for (const room of rooms) {
    if (room.propertyId === booking.propertyId) continue;
    if (room.roomTypeId !== booking.roomTypeId && !isUpgrade(room, booking)) continue;
    const eligibility = step3Eligibility(index, booking.propertyId, room.propertyId);
    if (!eligibility.ok) continue;
    if (eligibility.value.eligible) {
      standard.push(room);
      continue;
    }
    exception.push({
      room,
      city: eligibility.value.city,
      roadDistanceKm: eligibility.value.roadDistanceKm,
    });
  }
  return { standard, exception };
}

function crossPropertyChoice(
  stock: CrossPropertyStock,
  booking: RelocationPlanBooking,
  checkedIn: boolean,
): {
  readonly candidates: readonly ContinuousRoomAvailability[];
  readonly moveType: RelocationLadderMoveType;
  readonly choice: RelocationRoomChoice | null;
} {
  const candidates = [...stock.standard].sort((left, right) => {
    const leftSameType = left.roomTypeId === booking.roomTypeId ? 0 : 1;
    const rightSameType = right.roomTypeId === booking.roomTypeId ? 0 : 1;
    return leftSameType - rightSameType;
  });
  const first = candidates.at(0);
  const moveType: RelocationLadderMoveType =
    first !== undefined && first.roomTypeId !== booking.roomTypeId
      ? 'UPGRADE_CROSS_PROPERTY'
      : 'SAME_TYPE_CROSS_PROPERTY';
  return {
    candidates,
    moveType,
    choice: first === undefined ? null : roomChoice(first, moveType, true, checkedIn),
  };
}

function crossCityOptions(stock: CrossPropertyStock): readonly CrossCityExceptionOption[] {
  const grouped = new Map<string, { city: string; distance: number | null; roomIds: string[] }>();
  for (const entry of stock.exception) {
    const existing = grouped.get(entry.room.propertyId);
    if (existing === undefined)
      grouped.set(entry.room.propertyId, {
        city: entry.city,
        distance: entry.roadDistanceKm,
        roomIds: [entry.room.roomId],
      });
    else existing.roomIds.push(entry.room.roomId);
  }
  return [...grouped.entries()]
    .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
    .map(([toPropertyId, entry]) => ({
      toPropertyId,
      city: entry.city,
      roadDistanceKm: entry.distance,
      roomIds: [...entry.roomIds].sort(),
    }));
}

function crossCityPreview(
  options: readonly CrossCityExceptionOption[],
): CrossCityExceptionPreview | null {
  if (options.length === 0) return null;
  return {
    kind: 'BR_OVER_07_EXCEPTION',
    countsAsStandardLadderStep: false,
    standardLadderStep: null,
    writtenConsentRequired: true,
    managerApprovalRequired: true,
    transportSupportCapVnd: null,
    options,
  };
}

function resolveStep3Note(
  hasStandard: boolean,
  hasException: boolean,
  index: GeographyIndex,
): string | undefined {
  if (hasStandard) return undefined;
  return hasException ? standardStep3GapNote(index) : NOTE_STEP_3_STOCK;
}

function buildWalkOut(booking: RelocationPlanBooking, checkedIn: boolean): WalkOutPreview {
  return {
    kind: 'WALK_OUT',
    bookingId: booking.bookingId,
    reason: 'NO_ALTERNATIVE_STEP_4',
    refundPercent: 100,
    refundVnd: booking.paidAmountVnd,
    compensationVnd: booking.firstNightRateVnd,
    transportSupportVnd: 0,
    requiresManagerApproval: true,
    requiresForceMajeure: checkedIn,
    policyBlock: checkedIn ? 'CHECKED_IN_REQUIRES_FORCE_MAJEURE' : null,
    executable: false,
    autoRefund: false,
    autoCompensation: false,
    autoCancellation: false,
    cancelBooking: false,
    inventoryHeld: false,
    assignmentChanged: false,
  };
}

/**
 * BR-OVER-05/06/07/09 proposal. Pure: `nowEpochMs` and `planId` come from the caller and no clock,
 * randomness, I/O or ID generator is touched. `roomStock`, `stayDates` and `geography` are not
 * mutated, and reordering them does not change the result.
 */
export function planRelocation(
  request: RelocationPlanRequest,
): Result<RelocationPlan, RelocationPlanFailure> {
  const validated = validateRequest(request);
  if (!validated.ok) return validated;
  const { index, stayDates } = validated.value;

  const booking = request.booking;
  const checkedIn = booking.status === 'CHECKED_IN';
  const continuous = continuousStayRooms(request.roomStock, stayDates);
  const atOrigin = continuous.filter((room) => room.propertyId === booking.propertyId);

  const sameType = sameTypeChoice(atOrigin, booking, checkedIn);
  const upgrade = upgradeChoice(atOrigin, booking, checkedIn);
  const crossStock = splitCrossPropertyStock(continuous, booking, index);
  const cross = crossPropertyChoice(crossStock, booking, checkedIn);
  const exceptionOptions = crossCityOptions(crossStock);

  const ladder: readonly [
    RelocationLadderStep,
    RelocationLadderStep,
    RelocationLadderStep,
    RelocationLadderStep,
  ] = [
    stepRow(
      1,
      'SAME_TYPE_SAME_PROPERTY',
      sameType.candidates.length,
      sameType.candidates.length === 0 ? NOTE_STEP_1 : undefined,
    ),
    stepRow(
      2,
      'UPGRADE_SAME_PROPERTY',
      upgrade.candidates.length,
      upgrade.candidates.length === 0 ? NOTE_STEP_2 : undefined,
    ),
    stepRow(
      3,
      cross.moveType,
      cross.candidates.length,
      resolveStep3Note(cross.candidates.length > 0, exceptionOptions.length > 0, index),
    ),
    stepRow(4, 'WALK_OUT', 1, checkedIn ? NOTE_STEP_4_CHECKED_IN : undefined),
  ];

  const feasibleSteps = ladder.filter((row) => row.feasible).map((row) => row.step);

  return ok({
    planId: request.planId,
    generatedAtEpochMs: request.nowEpochMs,
    firstFeasibleStep: feasibleSteps.at(0) ?? 4,
    ladder,
    executionOrder: feasibleSteps,
    sameTypeSameProperty: sameType.choice,
    upgradeSameProperty: upgrade.choice,
    crossProperty: cross.choice,
    crossCityException: crossCityPreview(exceptionOptions),
    walkOut: buildWalkOut(booking, checkedIn),
    priceLocked: true,
    executable: false,
    inventoryHeld: false,
    assignmentChanged: false,
  });
}
