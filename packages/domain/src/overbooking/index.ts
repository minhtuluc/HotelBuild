export { checkActiveOversell } from './planner/active-oversell.js';
export type {
  ActiveOversellInput,
  ConfirmedOtaCommitment,
  ActiveOversellDecision,
  ActiveOversellFailure,
} from './planner/active-oversell.js';

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
