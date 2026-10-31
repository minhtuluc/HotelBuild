import { describe, expect, it } from 'vitest';
import { evaluateRoomMerge } from '@pinehill/domain/overbooking';
import type { MergeShareInput } from '@pinehill/domain/overbooking';

function baseShareInput(overrides?: Partial<MergeShareInput>): MergeShareInput {
  return {
    kind: 'MERGE_SHARE',
    roomType: { allowShared: true, bedCount: 6, capacity: 6 },
    primary: {
      bookingId: 'BK-0011',
      checkInDate: '2026-11-10',
      checkOutDate: '2026-11-13',
      guests: 2,
      primaryGuestGender: 'FEMALE',
      roomRevenueVnd: 900_000,
      consentGranted: true,
      assignedBedNo: 1,
    },
    secondary: {
      bookingId: 'BK-0012',
      checkInDate: '2026-11-10',
      checkOutDate: '2026-11-13',
      guests: 2,
      primaryGuestGender: 'FEMALE',
      roomRevenueVnd: 900_000,
      consentGranted: true,
      assignedBedNo: 2,
    },
    ...overrides,
  };
}

describe('RoomMergePolicy (HB-123)', () => {
  it('HB123_share_inventory_and_capacity', () => {
    const valid = evaluateRoomMerge(baseShareInput());
    expect(valid.ok).toBe(true);
    if (valid.ok && valid.value.kind === 'MERGE_SHARE') {
      expect(valid.value.assignedBeds).toEqual({ primaryBedNo: 1, secondaryBedNo: 2 });
    }

    const notShared = evaluateRoomMerge(
      baseShareInput({ roomType: { allowShared: false, bedCount: 4, capacity: 4 } }),
    );
    expect(notShared.ok).toBe(false);
    if (!notShared.ok) expect(notShared.error.code).toBe('E_OVER_SHARE_NOT_ALLOWED');

    const singleBed = evaluateRoomMerge(
      baseShareInput({ roomType: { allowShared: true, bedCount: 1, capacity: 2 } }),
    );
    expect(singleBed.ok).toBe(false);
    if (!singleBed.ok) expect(singleBed.error.code).toBe('E_OVER_SHARE_NOT_ALLOWED');

    const sameBed = evaluateRoomMerge(
      baseShareInput({
        primary: { ...baseShareInput().primary, assignedBedNo: 2 },
        secondary: { ...baseShareInput().secondary, assignedBedNo: 2 },
      }),
    );
    expect(sameBed.ok).toBe(false);
    if (!sameBed.ok) expect(sameBed.error.code).toBe('E_OVER_SHARE_NOT_ALLOWED');

    const zeroBed = evaluateRoomMerge(
      baseShareInput({
        primary: { ...baseShareInput().primary, assignedBedNo: 0 },
      }),
    );
    expect(zeroBed.ok).toBe(false);
    if (!zeroBed.ok) expect(zeroBed.error.code).toBe('E_OVER_SHARE_NOT_ALLOWED');

    const nonOverlapping = evaluateRoomMerge(
      baseShareInput({
        secondary: {
          ...baseShareInput().secondary,
          checkInDate: '2026-11-15',
          checkOutDate: '2026-11-17',
        },
      }),
    );
    expect(nonOverlapping.ok).toBe(false);
    if (!nonOverlapping.ok) expect(nonOverlapping.error.code).toBe('E_OVER_SHARE_NOT_ALLOWED');

    const overCapacity = evaluateRoomMerge(
      baseShareInput({
        roomType: { allowShared: true, bedCount: 6, capacity: 3 },
      }),
    );
    expect(overCapacity.ok).toBe(false);
    if (!overCapacity.ok) expect(overCapacity.error.code).toBe('E_BOOK_OVER_CAPACITY');

    const invalidSnapshot = evaluateRoomMerge(
      baseShareInput({
        primary: { ...baseShareInput().primary, bookingId: 'BK-0012' },
      }),
    );
    expect(invalidSnapshot.ok).toBe(false);
    if (!invalidSnapshot.ok) expect(invalidSnapshot.error.code).toBe('E_OVER_INVALID_INPUT');
  });

  it('TC_OVER_11_13_consent_gender_error_boundary', () => {
    const missingSecondaryConsent = evaluateRoomMerge(
      baseShareInput({
        primary: {
          ...baseShareInput().primary,
          primaryGuestGender: 'FEMALE',
          consentGranted: true,
        },
        secondary: {
          ...baseShareInput().secondary,
          primaryGuestGender: 'MALE',
          consentGranted: false,
        },
      }),
    );
    expect(missingSecondaryConsent.ok).toBe(false);
    if (!missingSecondaryConsent.ok) {
      expect(missingSecondaryConsent.error.code).toBe('E_OVER_NO_CONSENT');
    }

    const crossGenderFrontDeskOnly = evaluateRoomMerge(
      baseShareInput({
        primary: { ...baseShareInput().primary, primaryGuestGender: 'FEMALE' },
        secondary: { ...baseShareInput().secondary, primaryGuestGender: 'MALE' },
        managerApproval: {
          actorId: 'staff-fd-01',
          role: 'FRONT_DESK',
          reason: 'Khách đồng ý ghép tại quầy',
        },
      }),
    );
    expect(crossGenderFrontDeskOnly.ok).toBe(false);
    if (!crossGenderFrontDeskOnly.ok) {
      expect(crossGenderFrontDeskOnly.error.code).toBe('E_OVER_MERGE_GENDER');
    }

    const unspecifiedGenderNoApproval = evaluateRoomMerge(
      baseShareInput({
        primary: { ...baseShareInput().primary, primaryGuestGender: 'FEMALE' },
        secondary: { ...baseShareInput().secondary, primaryGuestGender: 'UNSPECIFIED' },
      }),
    );
    expect(unspecifiedGenderNoApproval.ok).toBe(false);
    if (!unspecifiedGenderNoApproval.ok) {
      expect(unspecifiedGenderNoApproval.error.code).toBe('E_OVER_MERGE_GENDER');
    }

    const crossGenderApprovedByManager = evaluateRoomMerge(
      baseShareInput({
        primary: { ...baseShareInput().primary, primaryGuestGender: 'FEMALE' },
        secondary: { ...baseShareInput().secondary, primaryGuestGender: 'MALE' },
        managerApproval: {
          actorId: 'mgr-01',
          role: 'MANAGER',
          reason: 'Hai khách đi cùng đoàn xác nhận văn bản đồng ý ghép phòng',
        },
      }),
    );
    expect(crossGenderApprovedByManager.ok).toBe(true);
    if (
      crossGenderApprovedByManager.ok &&
      crossGenderApprovedByManager.value.kind === 'MERGE_SHARE'
    ) {
      expect(crossGenderApprovedByManager.value.genderExceptionApproved).toBe(true);
      expect(crossGenderApprovedByManager.value.discountPct).toBe(20);
    }

    const sameGroupBypass = evaluateRoomMerge(
      baseShareInput({
        primary: { ...baseShareInput().primary, primaryGuestGender: 'FEMALE' },
        secondary: { ...baseShareInput().secondary, primaryGuestGender: 'MALE' },
        sameTravelGroup: true,
      }),
    );
    expect(sameGroupBypass.ok).toBe(true);
  });

  it('TC_OVER_12_connecting_and_split_rules', () => {
    const connectingOk = evaluateRoomMerge({
      kind: 'MERGE_CONNECTING',
      roomA: { roomId: 'RM-201', connectingRoomId: 'RM-202', capacity: 2, priceVnd: 3_366_000 },
      roomB: { roomId: 'RM-202', connectingRoomId: 'RM-201', capacity: 2, priceVnd: 3_366_000 },
      totalGuests: 4,
    });
    expect(connectingOk.ok).toBe(true);
    if (connectingOk.ok && connectingOk.value.kind === 'MERGE_CONNECTING') {
      expect(connectingOk.value.discountPct).toBe(10);
      expect(connectingOk.value.recognizedRoomRevenue.amount).toBe(6_732_000);
      expect(connectingOk.value.discountAmount.amount).toBe(673_200);
      expect(connectingOk.value.netCombinedReference.amount).toBe(6_058_800);
      expect(connectingOk.value.priceLocked).toBe(true);
    }

    const oneWayLink = evaluateRoomMerge({
      kind: 'MERGE_CONNECTING',
      roomA: { roomId: 'RM-201', connectingRoomId: 'RM-202', capacity: 2, priceVnd: 2_000_000 },
      roomB: { roomId: 'RM-202', connectingRoomId: null, capacity: 2, priceVnd: 2_000_000 },
      totalGuests: 3,
    });
    expect(oneWayLink.ok).toBe(false);
    if (!oneWayLink.ok) expect(oneWayLink.error.code).toBe('E_OVER_NOT_CONNECTING');

    const connectingOverCap = evaluateRoomMerge({
      kind: 'MERGE_CONNECTING',
      roomA: { roomId: 'RM-201', connectingRoomId: 'RM-202', capacity: 2, priceVnd: 2_000_000 },
      roomB: { roomId: 'RM-202', connectingRoomId: 'RM-201', capacity: 2, priceVnd: 2_000_000 },
      totalGuests: 5,
    });
    expect(connectingOverCap.ok).toBe(false);
    if (!connectingOverCap.ok) expect(connectingOverCap.error.code).toBe('E_BOOK_OVER_CAPACITY');

    const splitOk = evaluateRoomMerge({
      kind: 'SPLIT_ROOMS',
      bookingId: 'BK-0099',
      originalRoomRevenueVnd: 2_400_000,
      originalNightlyPricesVnd: [1_200_000, 1_200_000],
      targetRoomAvailableAllNights: true,
      targetRoomCapacity: 2,
      guests: 2,
    });
    expect(splitOk.ok).toBe(true);
    if (splitOk.ok && splitOk.value.kind === 'SPLIT_ROOMS') {
      expect(splitOk.value.discountPct).toBe(0);
      expect(splitOk.value.discountAmount.amount).toBe(0);
      expect(splitOk.value.recognizedRoomRevenue.amount).toBe(2_400_000);
      expect(splitOk.value.overbookingCost.amount).toBe(0);
      expect(splitOk.value.priceLocked).toBe(true);
      expect(splitOk.value.preservedNightlyPrices.map((m) => m.amount)).toEqual([
        1_200_000, 1_200_000,
      ]);
    }

    const splitUnavailable = evaluateRoomMerge({
      kind: 'SPLIT_ROOMS',
      bookingId: 'BK-0099',
      originalRoomRevenueVnd: 2_400_000,
      originalNightlyPricesVnd: [1_200_000, 1_200_000],
      targetRoomAvailableAllNights: false,
      targetRoomCapacity: 2,
      guests: 2,
    });
    expect(splitUnavailable.ok).toBe(false);
    if (!splitUnavailable.ok) {
      expect(splitUnavailable.error.code).toBe('E_OVER_TARGET_NOT_AVAILABLE');
    }
  });

  it('TC_OVER_14_revenue_unchanged_discount_cost', () => {
    const decision = evaluateRoomMerge(baseShareInput());
    expect(decision.ok).toBe(true);
    if (decision.ok && decision.value.kind === 'MERGE_SHARE') {
      expect(decision.value.primaryPriceSnapshot.amount).toBe(900_000);
      expect(decision.value.secondaryPriceSnapshot.amount).toBe(900_000);
      expect(decision.value.recognizedRoomRevenue.amount).toBe(1_800_000);
      expect(decision.value.primaryDiscount.amount).toBe(180_000);
      expect(decision.value.secondaryDiscount.amount).toBe(180_000);
      expect(decision.value.discountAmount.amount).toBe(360_000);
      expect(decision.value.overbookingCost.amount).toBe(360_000);
    }
  });

  it('HB123_discount_and_rounding_example', () => {
    const decision = evaluateRoomMerge(
      baseShareInput({
        primary: {
          bookingId: 'BK-0011',
          checkInDate: '2026-11-10',
          checkOutDate: '2026-11-13',
          guests: 1,
          primaryGuestGender: 'FEMALE',
          roomRevenueVnd: 1_454_000,
          consentGranted: true,
        },
        secondary: {
          bookingId: 'BK-0012',
          checkInDate: '2026-11-10',
          checkOutDate: '2026-11-13',
          guests: 1,
          primaryGuestGender: 'FEMALE',
          roomRevenueVnd: 1_454_000,
          consentGranted: true,
        },
      }),
    );
    expect(decision.ok).toBe(true);
    if (decision.ok && decision.value.kind === 'MERGE_SHARE') {
      expect(decision.value.primaryDiscount.amount).toBe(290_800);
      expect(decision.value.secondaryDiscount.amount).toBe(290_800);
      expect(decision.value.discountAmount.amount).toBe(581_600);
      expect(decision.value.primaryPriceSnapshot.amount).toBe(1_454_000);
      expect(decision.value.secondaryPriceSnapshot.amount).toBe(1_454_000);
      expect(decision.value.recognizedRoomRevenue.amount).toBe(2_908_000);
      expect(decision.value.primaryNetAfterDiscount.amount).toBe(1_163_200);
      expect(decision.value.primaryNetAfterDiscount.amount).not.toBe(1_163_000);
      expect(decision.value.postMergeObligationSettled).toBe(false);
    }
  });
});
