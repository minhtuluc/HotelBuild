/**
 * Public shapes returned by the overbooking planner. Split from `relocation-plan.ts` so the runtime
 * implementation stays inside the per-file line budget.
 */
import type { RelocationRoomStock } from './continuous-stay.js';
import type { RelocationGeography } from './geography.js';
import type { KeepScoreBookingStatus } from './keep-score.js';

export type RelocationLadderStepNumber = 1 | 2 | 3 | 4;

export type RelocationLadderMoveType =
  | 'SAME_TYPE_SAME_PROPERTY'
  | 'UPGRADE_SAME_PROPERTY'
  | 'SAME_TYPE_CROSS_PROPERTY'
  | 'UPGRADE_CROSS_PROPERTY'
  | 'WALK_OUT';

/** One preview row, shaped like `ladderPreview` (api.md §3.9); infeasible rows carry a reason. */
export interface RelocationLadderStep {
  readonly step: RelocationLadderStepNumber;
  readonly moveType: RelocationLadderMoveType;
  readonly feasible: boolean;
  readonly candidateCount: number;
  readonly note?: string;
}

export interface RelocationPlanBooking {
  readonly bookingId: string;
  readonly propertyId: string;
  readonly roomTypeId: string;
  readonly roomTypeBasePriceVnd: number;
  readonly guestCount: number;
  readonly status: KeepScoreBookingStatus;
  readonly paidAmountVnd: number;
  /** Original first-night rate from the price snapshot; the walk-out compensation basis. */
  readonly firstNightRateVnd: number;
}

export interface RelocationPlanRequest {
  /** Caller-supplied plan ID; the engine generates nothing. */
  readonly planId: string;
  /** Caller-supplied nominal instant (VN time already converted); the engine reads no clock. */
  readonly nowEpochMs: number;
  readonly booking: RelocationPlanBooking;
  readonly stayDates: readonly string[];
  readonly roomStock: readonly RelocationRoomStock[];
  readonly geography: RelocationGeography;
}

export interface RelocationRoomChoice {
  readonly roomId: string;
  readonly propertyId: string;
  readonly roomTypeId: string;
  readonly basePriceVnd: number;
  readonly moveType: RelocationLadderMoveType;
  readonly requiresManagerApproval: boolean;
  readonly requiresForceMajeure: boolean;
}

/** A room option reachable only through BR-OVER-07, never through the standard ladder. */
export interface CrossCityExceptionOption {
  readonly toPropertyId: string;
  readonly city: string;
  readonly roadDistanceKm: number | null;
  readonly roomIds: readonly string[];
}

export interface CrossCityExceptionPreview {
  readonly kind: 'BR_OVER_07_EXCEPTION';
  readonly countsAsStandardLadderStep: false;
  readonly standardLadderStep: null;
  readonly writtenConsentRequired: true;
  readonly managerApprovalRequired: true;
  /** No cap: the exception route is manager-decided actual support, not the 500.000 step-3 cap. */
  readonly transportSupportCapVnd: null;
  readonly options: readonly CrossCityExceptionOption[];
}

export interface WalkOutPreview {
  readonly kind: 'WALK_OUT';
  readonly bookingId: string;
  readonly reason: 'NO_ALTERNATIVE_STEP_4';
  readonly refundPercent: 100;
  readonly refundVnd: number;
  readonly compensationVnd: number;
  readonly transportSupportVnd: 0;
  readonly requiresManagerApproval: true;
  readonly requiresForceMajeure: boolean;
  readonly policyBlock: 'CHECKED_IN_REQUIRES_FORCE_MAJEURE' | null;
  readonly executable: false;
  readonly autoRefund: false;
  readonly autoCompensation: false;
  readonly autoCancellation: false;
  readonly cancelBooking: false;
  readonly inventoryHeld: false;
  readonly assignmentChanged: false;
}

export interface RelocationPlan {
  readonly planId: string;
  readonly generatedAtEpochMs: number;
  readonly firstFeasibleStep: RelocationLadderStepNumber;
  /** Preview is always the full four steps (contract `relocationLadderSchema`). */
  readonly ladder: readonly [
    RelocationLadderStep,
    RelocationLadderStep,
    RelocationLadderStep,
    RelocationLadderStep,
  ];
  /** Feasible steps in execution order; step 3 is absent when the geography excludes it. */
  readonly executionOrder: readonly RelocationLadderStepNumber[];
  readonly sameTypeSameProperty: RelocationRoomChoice | null;
  readonly upgradeSameProperty: RelocationRoomChoice | null;
  readonly crossProperty: RelocationRoomChoice | null;
  readonly crossCityException: CrossCityExceptionPreview | null;
  readonly walkOut: WalkOutPreview;
  readonly priceLocked: true;
  readonly executable: false;
  readonly inventoryHeld: false;
  readonly assignmentChanged: false;
}

export interface RelocationPlanFailure {
  readonly code: 'E_OVER_INVALID_INPUT';
  readonly message: string;
}
