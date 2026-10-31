import type { Clock } from '../../shared/clock.js';
import type { IdGenerator } from '../../shared/ids.js';
import { err, ok } from '../../shared/result.js';
import type { Result } from '../../shared/result.js';
import { Money } from '../../value-objects/money.js';
import type { StaffApproverRole } from '../merge/policy.js';

export type WalkOutReason = 'NO_ALTERNATIVE_STEP_4' | 'GUEST_DECLINED_RELOCATION';

export type RelocationTransportTier =
  'NONE' | 'SAME_CITY_STEP_3' | 'CROSS_CITY_EXCEPTION' | 'WALK_OUT_VOLUNTARY';

export interface WalkOutDocumentsInput {
  readonly walkOutDocNo?: string;
  readonly guestSignatureRef?: string;
  readonly staffSignatureRef?: string;
}

export interface WalkOutApprovalInput {
  readonly requestedByActorId: string;
  readonly approvedByActorId?: string;
  readonly approvedByRole?: StaffApproverRole;
  readonly approvalReason?: string;
}

export interface WalkOutPolicyInput {
  readonly bookingId: string;
  readonly reason: WalkOutReason;
  readonly paidAmountVnd: number;
  readonly alreadyRefundedVnd?: number;
  readonly activeReservedRefundVnd?: number;
  readonly eligibleAllocatedPaidVnd?: number;
  readonly firstNightOriginalSnapshotVnd: number;
  readonly refundFeeVnd?: number;
  readonly transportSupportVnd?: number;
  readonly transportTier?: RelocationTransportTier;
  readonly transportCapStep3Vnd?: number;
  readonly mergeDiscountVnd?: number;
  readonly documents?: WalkOutDocumentsInput;
  readonly approval?: WalkOutApprovalInput;
  readonly clock: Clock;
  readonly idGenerator: IdGenerator;
}

export type WalkOutFailureCode =
  'E_OVER_INVALID_INPUT' | 'E_OVER_REFUND_RESERVE_CONFLICT' | 'E_OVER_TRANSPORT_CAP_EXCEEDED';

export interface WalkOutFailure {
  readonly code: WalkOutFailureCode;
  readonly message: string;
}

export type RequiredWalkOutDocumentField =
  'walkOutDocNo' | 'guestSignatureRef' | 'staffSignatureRef';

export interface OverbookingAccountingClassification {
  readonly recordedPaidAmount: Money;
  readonly projectedRefundAmount: Money;
  readonly netRefundToGuest: Money;
  readonly cumulativeRefundedAfterPayout: Money;
  readonly remainingRefundableCap: Money;
  readonly compensationAmount: Money;
  readonly compensationPaymentKind: 'COMPENSATION';
  readonly refundPaymentKind: 'REFUND';
  readonly mergeDiscountCost: Money;
  readonly transportSupportCost: Money;
  readonly totalOverbookingCost: Money;
  readonly refundIncludedInOverbookingCost: false;
  readonly compensationConsumesRefundCap: false;
  readonly paidAmountReducedByRefund: false;
}

export interface WalkOutDecision {
  readonly decisionId: string;
  readonly evaluatedAtIso: string;
  readonly bookingId: string;
  readonly reason: WalkOutReason;
  readonly cancelReason: 'HOTEL_RELOCATION';
  readonly refundPercent: 100;
  readonly refundBase: Money;
  readonly projectedRefund: Money;
  readonly refundFee: Money;
  readonly netRefund: Money;
  readonly compensationAmount: Money;
  readonly transportSupport: Money;
  readonly accounting: OverbookingAccountingClassification;
  readonly requiredDocuments: readonly RequiredWalkOutDocumentField[];
  readonly missingDocuments: readonly RequiredWalkOutDocumentField[];
  readonly managerApprovalRequired: true;
  readonly managerApprovalSatisfied: boolean;
  readonly highValueThresholdVnd: 5_000_000;
  readonly requiresHighValueThresholdControl: boolean;
  readonly payoutGatedByUnsettledRule: boolean;
  readonly unsettledRuleReason: string | null;
  readonly readyForPayout: boolean;
  readonly priceLocked: true;
}

interface NormalizedWalkOutAmounts {
  readonly alreadyRefundedVnd: number;
  readonly activeReservedVnd: number;
  readonly refundBaseVnd: number;
  readonly refundFeeVnd: number;
  readonly transportVnd: number;
  readonly mergeDiscountVnd: number;
  readonly transportCapVnd: number;
  readonly transportTier: RelocationTransportTier;
}

const DEFAULT_STEP_3_CAP_VND = 500_000;
const HIGH_VALUE_REFUND_THRESHOLD_VND = 5_000_000;
const REQUIRED_DOC_FIELDS: readonly RequiredWalkOutDocumentField[] = [
  'walkOutDocNo',
  'guestSignatureRef',
  'staffSignatureRef',
];

function isNonNegativeInt(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 0;
}

function isPositiveInt(value: number): boolean {
  return Number.isSafeInteger(value) && value > 0;
}

function normalizeAmounts(input: WalkOutPolicyInput): NormalizedWalkOutAmounts {
  const alreadyRefundedVnd = input.alreadyRefundedVnd ?? 0;
  return {
    alreadyRefundedVnd,
    activeReservedVnd: input.activeReservedRefundVnd ?? 0,
    refundBaseVnd: input.eligibleAllocatedPaidVnd ?? input.paidAmountVnd - alreadyRefundedVnd,
    refundFeeVnd: input.refundFeeVnd ?? 0,
    transportVnd: input.transportSupportVnd ?? 0,
    mergeDiscountVnd: input.mergeDiscountVnd ?? 0,
    transportCapVnd: input.transportCapStep3Vnd ?? DEFAULT_STEP_3_CAP_VND,
    transportTier: input.transportTier ?? 'WALK_OUT_VOLUNTARY',
  };
}

function missingDocumentFields(
  docs?: WalkOutDocumentsInput,
): readonly RequiredWalkOutDocumentField[] {
  const missing: RequiredWalkOutDocumentField[] = [];
  if (!docs?.walkOutDocNo?.trim()) missing.push('walkOutDocNo');
  if (!docs?.guestSignatureRef?.trim()) missing.push('guestSignatureRef');
  if (!docs?.staffSignatureRef?.trim()) missing.push('staffSignatureRef');
  return missing;
}

function isApprovalValid(approval?: WalkOutApprovalInput): boolean {
  if (!approval?.requestedByActorId.trim() || !approval.approvedByActorId?.trim()) return false;
  if (approval.approvedByActorId === approval.requestedByActorId) return false;
  const isManagerPlus =
    approval.approvedByRole === 'MANAGER' || approval.approvedByRole === 'OWNER';
  return isManagerPlus && Boolean(approval.approvalReason?.trim());
}

function hasValidNumericFields(input: WalkOutPolicyInput, norm: NormalizedWalkOutAmounts): boolean {
  const nonNegatives = [
    input.paidAmountVnd,
    norm.alreadyRefundedVnd,
    norm.activeReservedVnd,
    norm.refundBaseVnd,
    norm.refundFeeVnd,
    norm.transportVnd,
    norm.mergeDiscountVnd,
  ];
  return (
    input.bookingId.trim().length > 0 &&
    nonNegatives.every((val) => isNonNegativeInt(val)) &&
    isPositiveInt(input.firstNightOriginalSnapshotVnd) &&
    isPositiveInt(norm.transportCapVnd) &&
    norm.alreadyRefundedVnd <= input.paidAmountVnd
  );
}

function validateAmounts(
  input: WalkOutPolicyInput,
  norm: NormalizedWalkOutAmounts,
): WalkOutFailure | null {
  if (!hasValidNumericFields(input, norm)) {
    return {
      code: 'E_OVER_INVALID_INPUT',
      message: 'Invalid walk-out input amounts or identifiers',
    };
  }
  const availableAfterHolds =
    input.paidAmountVnd - norm.alreadyRefundedVnd - norm.activeReservedVnd;
  if (availableAfterHolds < 0 || availableAfterHolds < norm.refundBaseVnd) {
    return {
      code: 'E_OVER_REFUND_RESERVE_CONFLICT',
      message:
        'Active refund reservation holds funds needed for walk-out refund base (BR-CANCEL-17)',
    };
  }
  if (norm.transportTier === 'SAME_CITY_STEP_3' && norm.transportVnd > norm.transportCapVnd) {
    return {
      code: 'E_OVER_TRANSPORT_CAP_EXCEEDED',
      message: `Same-city step-3 transport support exceeds cap of ${norm.transportCapVnd} VND`,
    };
  }
  return null;
}

function buildAccounting(
  input: WalkOutPolicyInput,
  norm: NormalizedWalkOutAmounts,
  projectedRefundVnd: number,
  netRefundVnd: number,
): OverbookingAccountingClassification {
  const recordedPaidAmount = Money.of(input.paidAmountVnd);
  const projectedRefundAmount = Money.of(projectedRefundVnd);
  const netRefundToGuest = Money.of(netRefundVnd);
  const compensationAmount = Money.of(input.firstNightOriginalSnapshotVnd);
  const mergeDiscountCost = Money.of(norm.mergeDiscountVnd);
  const transportSupportCost = Money.of(norm.transportVnd);
  const cumulative = norm.alreadyRefundedVnd + projectedRefundVnd;
  return {
    recordedPaidAmount,
    projectedRefundAmount,
    netRefundToGuest,
    cumulativeRefundedAfterPayout: Money.of(cumulative),
    remainingRefundableCap: Money.of(input.paidAmountVnd - cumulative),
    compensationAmount,
    compensationPaymentKind: 'COMPENSATION',
    refundPaymentKind: 'REFUND',
    mergeDiscountCost,
    transportSupportCost,
    totalOverbookingCost: mergeDiscountCost.add(compensationAmount).add(transportSupportCost),
    refundIncludedInOverbookingCost: false,
    compensationConsumesRefundCap: false,
    paidAmountReducedByRefund: false,
  };
}

/**
 * Pure policy for walk-out / guest relocation refusal (BR-CANCEL-14, BR-OVER-05/06/15, BR-PAY-02/07).
 * Separates refund (`REFUND`) from compensation (`COMPENSATION`), keeps `paidAmount` intact,
 * and excludes refund from overbooking cost (`discount + compensation + transport`).
 */
export function evaluateWalkOut(
  input: WalkOutPolicyInput,
): Result<WalkOutDecision, WalkOutFailure> {
  const norm = normalizeAmounts(input);
  const failure = validateAmounts(input, norm);
  if (failure !== null) return err(failure);

  const projectedRefundVnd = Math.floor(norm.refundBaseVnd / 1000) * 1000;
  const netRefundVnd = Math.max(0, projectedRefundVnd - norm.refundFeeVnd);
  const unsettled = norm.refundBaseVnd % 1000 !== 0 || norm.refundFeeVnd > 0;
  const unsettledReason = unsettled ? 'NON_THOUSAND_MULTIPLE_OR_FEE_REQUIRES_LEAD_DECISION' : null;

  const accounting = buildAccounting(input, norm, projectedRefundVnd, netRefundVnd);
  const missingDocuments = missingDocumentFields(input.documents);
  const managerApprovalSatisfied = isApprovalValid(input.approval);

  return ok({
    decisionId: input.idGenerator.generate(),
    evaluatedAtIso: new Date(input.clock.now().getTime()).toISOString(),
    bookingId: input.bookingId,
    reason: input.reason,
    cancelReason: 'HOTEL_RELOCATION',
    refundPercent: 100,
    refundBase: Money.of(norm.refundBaseVnd),
    projectedRefund: accounting.projectedRefundAmount,
    refundFee: Money.of(norm.refundFeeVnd),
    netRefund: accounting.netRefundToGuest,
    compensationAmount: accounting.compensationAmount,
    transportSupport: accounting.transportSupportCost,
    accounting,
    requiredDocuments: REQUIRED_DOC_FIELDS,
    missingDocuments,
    managerApprovalRequired: true,
    managerApprovalSatisfied,
    highValueThresholdVnd: HIGH_VALUE_REFUND_THRESHOLD_VND,
    requiresHighValueThresholdControl: netRefundVnd > HIGH_VALUE_REFUND_THRESHOLD_VND,
    payoutGatedByUnsettledRule: unsettled,
    unsettledRuleReason: unsettledReason,
    readyForPayout: missingDocuments.length === 0 && managerApprovalSatisfied && !unsettled,
    priceLocked: true,
  });
}
