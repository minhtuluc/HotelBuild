import { describe, expect, it } from 'vitest';
import { evaluateRoomMerge, evaluateWalkOut } from '@pinehill/domain/overbooking';
import type { WalkOutPolicyInput } from '@pinehill/domain/overbooking';

function baseWalkOutInput(overrides?: Partial<WalkOutPolicyInput>): WalkOutPolicyInput {
  return {
    bookingId: 'BK-WALK-01',
    reason: 'NO_ALTERNATIVE_STEP_4',
    paidAmountVnd: 2_000_000,
    firstNightOriginalSnapshotVnd: 1_100_000,
    documents: {
      walkOutDocNo: 'WO-2026-0001',
      guestSignatureRef: 'sig-guest-01',
      staffSignatureRef: 'sig-staff-01',
    },
    approval: {
      requestedByActorId: 'staff-fd-01',
      approvedByActorId: 'mgr-01',
      approvedByRole: 'MANAGER',
      approvalReason: 'Hết phòng toàn khu vực lễ hội, duyệt chi walk-out bậc 4',
    },
    clock: { now: () => new Date(1_762_000_000_000) },
    idGenerator: { generate: () => 'dec-walkout-0001' },
    ...overrides,
  };
}

describe('WalkOutPolicy (HB-123)', () => {
  it('TC_OVER_07_refund_and_compensation_separate', () => {
    const paidDecision = evaluateWalkOut(baseWalkOutInput());
    expect(paidDecision.ok).toBe(true);
    if (paidDecision.ok) {
      expect(paidDecision.value.cancelReason).toBe('HOTEL_RELOCATION');
      expect(paidDecision.value.refundPercent).toBe(100);
      expect(paidDecision.value.projectedRefund.amount).toBe(2_000_000);
      expect(paidDecision.value.netRefund.amount).toBe(2_000_000);
      expect(paidDecision.value.compensationAmount.amount).toBe(1_100_000);
      expect(paidDecision.value.accounting.refundPaymentKind).toBe('REFUND');
      expect(paidDecision.value.accounting.compensationPaymentKind).toBe('COMPENSATION');
    }

    const unpaidDecision = evaluateWalkOut(
      baseWalkOutInput({
        paidAmountVnd: 0,
        reason: 'GUEST_DECLINED_RELOCATION',
      }),
    );
    expect(unpaidDecision.ok).toBe(true);
    if (unpaidDecision.ok) {
      expect(unpaidDecision.value.refundBase.amount).toBe(0);
      expect(unpaidDecision.value.projectedRefund.amount).toBe(0);
      expect(unpaidDecision.value.netRefund.amount).toBe(0);
      expect(unpaidDecision.value.compensationAmount.amount).toBe(1_100_000);
    }

    const nonMultipleOrFee = evaluateWalkOut(
      baseWalkOutInput({
        paidAmountVnd: 1_320_500,
        refundFeeVnd: 10_000,
      }),
    );
    expect(nonMultipleOrFee.ok).toBe(true);
    if (nonMultipleOrFee.ok) {
      expect(nonMultipleOrFee.value.projectedRefund.amount).toBe(1_320_000);
      expect(nonMultipleOrFee.value.netRefund.amount).toBe(1_310_000);
      expect(nonMultipleOrFee.value.payoutGatedByUnsettledRule).toBe(true);
      expect(nonMultipleOrFee.value.readyForPayout).toBe(false);
    }

    const reserveConflict = evaluateWalkOut(
      baseWalkOutInput({
        paidAmountVnd: 2_000_000,
        alreadyRefundedVnd: 500_000,
        activeReservedRefundVnd: 600_000,
        eligibleAllocatedPaidVnd: 1_200_000,
      }),
    );
    expect(reserveConflict.ok).toBe(false);
    if (!reserveConflict.ok) {
      expect(reserveConflict.error.code).toBe('E_OVER_REFUND_RESERVE_CONFLICT');
    }
  });

  it('HB123_accounting_classifications', () => {
    const decision = evaluateWalkOut(
      baseWalkOutInput({
        paidAmountVnd: 1_320_000,
        firstNightOriginalSnapshotVnd: 2_200_000,
        transportSupportVnd: 500_000,
        mergeDiscountVnd: 360_000,
      }),
    );
    expect(decision.ok).toBe(true);
    if (decision.ok) {
      const { accounting } = decision.value;
      expect(accounting.recordedPaidAmount.amount).toBe(1_320_000);
      expect(accounting.projectedRefundAmount.amount).toBe(1_320_000);
      expect(accounting.compensationAmount.amount).toBe(2_200_000);
      expect(accounting.mergeDiscountCost.amount).toBe(360_000);
      expect(accounting.transportSupportCost.amount).toBe(500_000);
      expect(accounting.totalOverbookingCost.amount).toBe(360_000 + 2_200_000 + 500_000);
      expect(accounting.refundIncludedInOverbookingCost).toBe(false);
      expect(accounting.compensationConsumesRefundCap).toBe(false);
      expect(accounting.paidAmountReducedByRefund).toBe(false);
      expect(accounting.cumulativeRefundedAfterPayout.amount).toBe(1_320_000);
      expect(accounting.remainingRefundableCap.amount).toBe(0);
    }
  });

  it('HB123_walkout_documents_and_approval_requirements', () => {
    const missingDocs = evaluateWalkOut(
      baseWalkOutInput({
        documents: { walkOutDocNo: 'WO-1', guestSignatureRef: '' },
      }),
    );
    expect(missingDocs.ok).toBe(true);
    if (missingDocs.ok) {
      expect(missingDocs.value.missingDocuments).toEqual([
        'guestSignatureRef',
        'staffSignatureRef',
      ]);
      expect(missingDocs.value.readyForPayout).toBe(false);
    }

    const selfApprovalBlocked = evaluateWalkOut(
      baseWalkOutInput({
        paidAmountVnd: 6_000_000,
        approval: {
          requestedByActorId: 'mgr-01',
          approvedByActorId: 'mgr-01',
          approvedByRole: 'MANAGER',
          approvalReason: 'Tự duyệt không hợp lệ',
        },
      }),
    );
    expect(selfApprovalBlocked.ok).toBe(true);
    if (selfApprovalBlocked.ok) {
      expect(selfApprovalBlocked.value.managerApprovalSatisfied).toBe(false);
      expect(selfApprovalBlocked.value.requiresHighValueThresholdControl).toBe(true);
      expect(selfApprovalBlocked.value.readyForPayout).toBe(false);
    }

    const step3CapExceeded = evaluateWalkOut(
      baseWalkOutInput({
        transportTier: 'SAME_CITY_STEP_3',
        transportSupportVnd: 600_000,
      }),
    );
    expect(step3CapExceeded.ok).toBe(false);
    if (!step3CapExceeded.ok) {
      expect(step3CapExceeded.error.code).toBe('E_OVER_TRANSPORT_CAP_EXCEEDED');
    }

    const crossCityAboveStep3CapAllowed = evaluateWalkOut(
      baseWalkOutInput({
        transportTier: 'CROSS_CITY_EXCEPTION',
        transportSupportVnd: 1_200_000,
      }),
    );
    expect(crossCityAboveStep3CapAllowed.ok).toBe(true);
    if (crossCityAboveStep3CapAllowed.ok) {
      expect(crossCityAboveStep3CapAllowed.value.transportSupport.amount).toBe(1_200_000);
      expect(crossCityAboveStep3CapAllowed.value.readyForPayout).toBe(true);
    }
  });

  it('HB123_pure_deterministic_policies', () => {
    const input = Object.freeze(baseWalkOutInput());
    const first = evaluateWalkOut(input);
    const second = evaluateWalkOut(input);
    expect(first).toEqual(second);

    const mergeInput = Object.freeze({
      kind: 'SPLIT_ROOMS' as const,
      bookingId: 'BK-IMMUTABLE',
      originalRoomRevenueVnd: 1_500_000,
      originalNightlyPricesVnd: Object.freeze([750_000, 750_000]),
      targetRoomAvailableAllNights: true,
      targetRoomCapacity: 2,
      guests: 2,
    });
    const m1 = evaluateRoomMerge(mergeInput);
    const m2 = evaluateRoomMerge(mergeInput);
    expect(m1).toEqual(m2);
  });
});
