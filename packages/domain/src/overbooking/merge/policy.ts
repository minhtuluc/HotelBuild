import { err, ok } from '../../shared/result.js';
import type { Result } from '../../shared/result.js';
import { Money } from '../../value-objects/money.js';

export type GuestGender = 'MALE' | 'FEMALE' | 'OTHER' | 'UNSPECIFIED';

export type StaffApproverRole =
  | 'FRONT_DESK'
  | 'RESERVATION_AGENT'
  | 'HOUSEKEEPING'
  | 'MANAGER'
  | 'OWNER'
  | 'ACCOUNTANT'
  | 'SYSADMIN';

export interface MergeApprovalInput {
  readonly actorId: string;
  readonly role: StaffApproverRole;
  readonly reason: string;
}

export interface MergeBookingSnapshot {
  readonly bookingId: string;
  readonly checkInDate: string;
  readonly checkOutDate: string;
  readonly guests: number;
  readonly primaryGuestGender: GuestGender;
  readonly roomRevenueVnd: number;
  readonly consentGranted: boolean;
  readonly assignedBedNo?: number;
}

export interface MergeShareInput {
  readonly kind: 'MERGE_SHARE';
  readonly roomType: {
    readonly allowShared: boolean;
    readonly bedCount: number;
    readonly capacity: number;
  };
  readonly primary: MergeBookingSnapshot;
  readonly secondary: MergeBookingSnapshot;
  readonly sameTravelGroup?: boolean;
  readonly managerApproval?: MergeApprovalInput;
}

export interface MergeConnectingInput {
  readonly kind: 'MERGE_CONNECTING';
  readonly roomA: {
    readonly roomId: string;
    readonly connectingRoomId: string | null;
    readonly capacity: number;
    readonly priceVnd: number;
  };
  readonly roomB: {
    readonly roomId: string;
    readonly connectingRoomId: string | null;
    readonly capacity: number;
    readonly priceVnd: number;
  };
  readonly totalGuests: number;
}

export interface SplitRoomsInput {
  readonly kind: 'SPLIT_ROOMS';
  readonly bookingId: string;
  readonly originalRoomRevenueVnd: number;
  readonly originalNightlyPricesVnd: readonly number[];
  readonly targetRoomAvailableAllNights: boolean;
  readonly targetRoomCapacity: number;
  readonly guests: number;
}

export type RoomMergePolicyInput = MergeShareInput | MergeConnectingInput | SplitRoomsInput;

export type RoomMergeFailureCode =
  | 'E_OVER_INVALID_INPUT'
  | 'E_OVER_SHARE_NOT_ALLOWED'
  | 'E_BOOK_OVER_CAPACITY'
  | 'E_OVER_NO_CONSENT'
  | 'E_OVER_MERGE_GENDER'
  | 'E_OVER_NOT_CONNECTING'
  | 'E_OVER_TARGET_NOT_AVAILABLE';

export interface RoomMergeFailure {
  readonly code: RoomMergeFailureCode;
  readonly message: string;
}

export interface MergeShareDecision {
  readonly kind: 'MERGE_SHARE';
  readonly discountPct: 20;
  readonly primaryDiscount: Money;
  readonly secondaryDiscount: Money;
  readonly discountAmount: Money;
  readonly recognizedRoomRevenue: Money;
  readonly primaryPriceSnapshot: Money;
  readonly secondaryPriceSnapshot: Money;
  readonly primaryNetAfterDiscount: Money;
  readonly secondaryNetAfterDiscount: Money;
  readonly overbookingCost: Money;
  readonly assignedBeds: { readonly primaryBedNo: number; readonly secondaryBedNo: number };
  readonly genderExceptionApproved: boolean;
  readonly priceLocked: true;
  readonly postMergeObligationSettled: false;
}

export interface MergeConnectingDecision {
  readonly kind: 'MERGE_CONNECTING';
  readonly discountPct: 10;
  readonly recognizedRoomRevenue: Money;
  readonly discountAmount: Money;
  readonly netCombinedReference: Money;
  readonly overbookingCost: Money;
  readonly priceLocked: true;
}

export interface SplitRoomsDecision {
  readonly kind: 'SPLIT_ROOMS';
  readonly discountPct: 0;
  readonly discountAmount: Money;
  readonly recognizedRoomRevenue: Money;
  readonly preservedNightlyPrices: readonly Money[];
  readonly overbookingCost: Money;
  readonly priceLocked: true;
}

export type RoomMergeDecision = MergeShareDecision | MergeConnectingDecision | SplitRoomsDecision;

function isPositiveInt(value: number): boolean {
  return Number.isSafeInteger(value) && value > 0;
}

function isIsoDate(value: string): boolean {
  return /^\d{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\d|3[01])$/.test(value);
}

function validStayRange(booking: MergeBookingSnapshot): boolean {
  return (
    isIsoDate(booking.checkInDate) &&
    isIsoDate(booking.checkOutDate) &&
    booking.checkInDate < booking.checkOutDate
  );
}

function datesOverlapAndValid(a: MergeBookingSnapshot, b: MergeBookingSnapshot): boolean {
  if (!validStayRange(a) || !validStayRange(b)) return false;
  return a.checkInDate < b.checkOutDate && b.checkInDate < a.checkOutDate;
}

function validShareBeds(
  bedCount: number,
  primaryBed?: number,
  secondaryBed?: number,
): { readonly primaryBedNo: number; readonly secondaryBedNo: number } | null {
  const first = primaryBed ?? 1;
  const second = secondaryBed ?? 2;
  const inBounds =
    isPositiveInt(first) && isPositiveInt(second) && first <= bedCount && second <= bedCount;
  if (!inBounds || first === second) return null;
  return { primaryBedNo: first, secondaryBedNo: second };
}

function requiresGenderException(input: MergeShareInput): boolean {
  if (input.sameTravelGroup === true) return false;
  const g1 = input.primary.primaryGuestGender;
  const g2 = input.secondary.primaryGuestGender;
  if (g1 === 'UNSPECIFIED' || g2 === 'UNSPECIFIED') return true;
  return g1 !== g2;
}

function hasValidManagerApproval(approval?: MergeApprovalInput): boolean {
  if (!approval) return false;
  const isManagerPlus = approval.role === 'MANAGER' || approval.role === 'OWNER';
  return isManagerPlus && approval.actorId.trim().length > 0 && approval.reason.trim().length > 0;
}

function validShareBooking(booking: MergeBookingSnapshot): boolean {
  return (
    booking.bookingId.trim().length > 0 &&
    isPositiveInt(booking.roomRevenueVnd) &&
    isPositiveInt(booking.guests)
  );
}

function sharePreconditions(input: MergeShareInput): RoomMergeFailure | null {
  const { roomType, primary, secondary } = input;
  if (
    !validShareBooking(primary) ||
    !validShareBooking(secondary) ||
    primary.bookingId === secondary.bookingId
  ) {
    return { code: 'E_OVER_INVALID_INPUT', message: 'Invalid booking snapshot for share merge' };
  }
  if (!roomType.allowShared || !isPositiveInt(roomType.bedCount) || roomType.bedCount <= 1) {
    return {
      code: 'E_OVER_SHARE_NOT_ALLOWED',
      message: 'MERGE_SHARE requires allowShared=true and bedCount>1',
    };
  }
  if (!datesOverlapAndValid(primary, secondary)) {
    return {
      code: 'E_OVER_SHARE_NOT_ALLOWED',
      message: 'MERGE_SHARE requires valid overlapping stay dates',
    };
  }
  if (!isPositiveInt(roomType.capacity) || primary.guests + secondary.guests > roomType.capacity) {
    return { code: 'E_BOOK_OVER_CAPACITY', message: 'Combined guests exceed shared room capacity' };
  }
  return null;
}

function evaluateShare(input: MergeShareInput): Result<MergeShareDecision, RoomMergeFailure> {
  const preError = sharePreconditions(input);
  if (preError !== null) return err(preError);

  const { roomType, primary, secondary } = input;
  const beds = validShareBeds(roomType.bedCount, primary.assignedBedNo, secondary.assignedBedNo);
  if (!beds) {
    return err({
      code: 'E_OVER_SHARE_NOT_ALLOWED',
      message: 'Each booking in MERGE_SHARE must occupy a distinct valid bed unit (1..bedCount)',
    });
  }
  if (!primary.consentGranted || !secondary.consentGranted) {
    return err({
      code: 'E_OVER_NO_CONSENT',
      message: 'Both primary and secondary bookings must grant consent before MERGE_SHARE',
    });
  }
  const needsException = requiresGenderException(input);
  if (needsException && !hasValidManagerApproval(input.managerApproval)) {
    return err({
      code: 'E_OVER_MERGE_GENDER',
      message: 'Cross-gender or UNSPECIFIED gender merge requires MANAGER+ approval with reason',
    });
  }
  return ok(buildShareDecision(primary, secondary, beds, needsException));
}

function buildShareDecision(
  primary: MergeBookingSnapshot,
  secondary: MergeBookingSnapshot,
  beds: { readonly primaryBedNo: number; readonly secondaryBedNo: number },
  genderExceptionApproved: boolean,
): MergeShareDecision {
  const primaryDiscountVnd = Math.floor((primary.roomRevenueVnd * 20) / 100);
  const secondaryDiscountVnd = Math.floor((secondary.roomRevenueVnd * 20) / 100);
  const discountAmount = Money.of(primaryDiscountVnd + secondaryDiscountVnd);
  const primarySnap = Money.of(primary.roomRevenueVnd);
  const secondarySnap = Money.of(secondary.roomRevenueVnd);
  const primaryDisc = Money.of(primaryDiscountVnd);
  const secondaryDisc = Money.of(secondaryDiscountVnd);
  return {
    kind: 'MERGE_SHARE',
    discountPct: 20,
    primaryDiscount: primaryDisc,
    secondaryDiscount: secondaryDisc,
    discountAmount,
    recognizedRoomRevenue: primarySnap.add(secondarySnap),
    primaryPriceSnapshot: primarySnap,
    secondaryPriceSnapshot: secondarySnap,
    primaryNetAfterDiscount: primarySnap.subtract(primaryDisc),
    secondaryNetAfterDiscount: secondarySnap.subtract(secondaryDisc),
    overbookingCost: discountAmount,
    assignedBeds: beds,
    genderExceptionApproved,
    priceLocked: true,
    postMergeObligationSettled: false,
  };
}

function validConnectingRoom(room: MergeConnectingInput['roomA']): boolean {
  return (
    room.roomId.trim().length > 0 && isPositiveInt(room.priceVnd) && isPositiveInt(room.capacity)
  );
}

function areBidirectionallyConnected(
  roomA: MergeConnectingInput['roomA'],
  roomB: MergeConnectingInput['roomB'],
): boolean {
  return (
    roomA.roomId !== roomB.roomId &&
    roomA.connectingRoomId === roomB.roomId &&
    roomB.connectingRoomId === roomA.roomId
  );
}

function evaluateConnecting(
  input: MergeConnectingInput,
): Result<MergeConnectingDecision, RoomMergeFailure> {
  const { roomA, roomB, totalGuests } = input;
  if (!validConnectingRoom(roomA) || !validConnectingRoom(roomB) || !isPositiveInt(totalGuests)) {
    return err({ code: 'E_OVER_INVALID_INPUT', message: 'Invalid room or guest input' });
  }
  if (!areBidirectionallyConnected(roomA, roomB)) {
    return err({
      code: 'E_OVER_NOT_CONNECTING',
      message:
        'MERGE_CONNECTING requires bidirectional connectingRoomId link between two distinct rooms',
    });
  }
  if (totalGuests > roomA.capacity + roomB.capacity) {
    return err({
      code: 'E_BOOK_OVER_CAPACITY',
      message: 'Total guests exceed combined capacity of connecting rooms',
    });
  }
  const combinedVnd = roomA.priceVnd + roomB.priceVnd;
  const recognizedRoomRevenue = Money.of(combinedVnd);
  const discountAmount = Money.of(Math.floor((combinedVnd * 10) / 100));
  return ok({
    kind: 'MERGE_CONNECTING',
    discountPct: 10,
    recognizedRoomRevenue,
    discountAmount,
    netCombinedReference: recognizedRoomRevenue.subtract(discountAmount),
    overbookingCost: discountAmount,
    priceLocked: true,
  });
}

function validSplitInput(input: SplitRoomsInput): boolean {
  return (
    input.bookingId.trim().length > 0 &&
    isPositiveInt(input.originalRoomRevenueVnd) &&
    input.originalNightlyPricesVnd.length > 0 &&
    input.originalNightlyPricesVnd.every((price) => isPositiveInt(price)) &&
    isPositiveInt(input.targetRoomCapacity) &&
    isPositiveInt(input.guests)
  );
}

function evaluateSplit(input: SplitRoomsInput): Result<SplitRoomsDecision, RoomMergeFailure> {
  if (!validSplitInput(input)) {
    return err({ code: 'E_OVER_INVALID_INPUT', message: 'Invalid SPLIT_ROOMS input' });
  }
  if (!input.targetRoomAvailableAllNights) {
    return err({
      code: 'E_OVER_TARGET_NOT_AVAILABLE',
      message: 'Target room must be available across all stay nights for SPLIT_ROOMS',
    });
  }
  if (input.guests > input.targetRoomCapacity) {
    return err({
      code: 'E_BOOK_OVER_CAPACITY',
      message: 'Guests exceed target room capacity for SPLIT_ROOMS',
    });
  }
  const zero = Money.of(0);
  return ok({
    kind: 'SPLIT_ROOMS',
    discountPct: 0,
    discountAmount: zero,
    recognizedRoomRevenue: Money.of(input.originalRoomRevenueVnd),
    preservedNightlyPrices: input.originalNightlyPricesVnd.map((price) => Money.of(price)),
    overbookingCost: zero,
    priceLocked: true,
  });
}

/**
 * Pure policy for BR-OVER-08/13..15 & §9.4 (`MERGE_SHARE`, `MERGE_CONNECTING`, `SPLIT_ROOMS`).
 * Never mutates `PriceSnapshot` or lowers recognized room revenue; records discount separately.
 */
export function evaluateRoomMerge(
  input: RoomMergePolicyInput,
): Result<RoomMergeDecision, RoomMergeFailure> {
  if (input.kind === 'MERGE_SHARE') return evaluateShare(input);
  if (input.kind === 'MERGE_CONNECTING') return evaluateConnecting(input);
  return evaluateSplit(input);
}
