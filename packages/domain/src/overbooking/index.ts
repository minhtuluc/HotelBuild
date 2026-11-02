export { checkActiveOversell } from './planner/active-oversell.js';
export type {
  ActiveOversellInput,
  ConfirmedOtaCommitment,
  ActiveOversellDecision,
  ActiveOversellFailure,
} from './planner/active-oversell.js';

export { keepScore, rankRelocations } from './planner/keep-score.js';
export type {
  LoyaltyTier,
  KeepScoreBookingStatus,
  RelocationChannelCode,
  KeepPriorityGroup,
  KeepScoreFactors,
  KeepScoreBreakdown,
  KeepScoreFailure,
  RelocationCandidate,
  RelocationRank,
} from './planner/keep-score.js';

export {
  continuousStayRooms,
  isRoomFreeForWholeStay,
  isStayDate,
} from './planner/continuous-stay.js';
export type { RelocationRoomStock, ContinuousRoomAvailability } from './planner/continuous-stay.js';

export {
  DEFAULT_STEP3_MAX_DISTANCE_KM,
  checkStandardStep3,
  indexGeography,
  proposeCrossCityException,
  standardStep3GapNote,
  step3Eligibility,
} from './planner/geography.js';
export type {
  GeoProperty,
  PropertyDistance,
  RelocationGeography,
  GeographyFailure,
  GeographyIndex,
  Step3EligibilityReason,
  StandardStep3Eligibility,
  CrossCityConsentInput,
  CrossCityApprovalInput,
  CrossCityExceptionRequest,
  CrossCityExceptionFailureCode,
  CrossCityExceptionFailure,
  CrossCityExceptionDecision,
} from './planner/geography.js';

export { planRelocation } from './planner/relocation-plan.js';
export type {
  RelocationLadderStepNumber,
  RelocationLadderMoveType,
  RelocationLadderStep,
  RelocationPlanBooking,
  RelocationPlanRequest,
  RelocationRoomChoice,
  CrossCityExceptionOption,
  CrossCityExceptionPreview,
  WalkOutPreview,
  RelocationPlan,
  RelocationPlanFailure,
} from './planner/relocation-plan-types.js';

export { evaluateRoomMerge } from './merge/policy.js';
export type {
  GuestGender,
  StaffApproverRole,
  MergeApprovalInput,
  MergeBookingSnapshot,
  MergeShareInput,
  MergeConnectingInput,
  SplitRoomsInput,
  RoomMergePolicyInput,
  RoomMergeFailureCode,
  RoomMergeFailure,
  MergeShareDecision,
  MergeConnectingDecision,
  SplitRoomsDecision,
  RoomMergeDecision,
} from './merge/policy.js';

export { evaluateWalkOut } from './walkout/policy.js';
export type {
  WalkOutReason,
  RelocationTransportTier,
  WalkOutDocumentsInput,
  WalkOutApprovalInput,
  WalkOutPolicyInput,
  WalkOutFailureCode,
  WalkOutFailure,
  RequiredWalkOutDocumentField,
  OverbookingAccountingClassification,
  WalkOutDecision,
} from './walkout/policy.js';
