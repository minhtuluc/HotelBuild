import { ApiError } from '@pinehill/api-client';
import { bookingSummarySchema } from '@pinehill/contracts';
import { ChangeController } from '../src/booking-changes/controller';
import type { ChangeApi, ChangeDraft, ChangePreview } from '../src/booking-changes/types';
export const cancellation = {
  bookingId: 'b1',
  currency: 'VND' as const,
  cancellation: {
    policyId: 'p1',
    appliedTierId: 't1',
    hoursBeforeCheckIn: 180,
    refundPercent: 100,
    paidAmount: 600001,
    requestedAmount: 600000,
    penaltyAmount: 0,
    refundFee: 1000,
  },
};
export const draft: ChangeDraft = {
  reason: 'GUEST_REQUEST',
  note: '',
  evidenceRefs: [],
  checkIn: '',
  checkOut: '',
};
export function fixture() {
  let connected = true,
    now = 1000,
    previewCalls = 0;
  let current: ChangePreview = { kind: 'cancel', data: cancellation };
  const writes: Parameters<ChangeApi['commit']>[0][] = [];
  let reject: unknown;
  const api: ChangeApi = {
    preview: async () => {
      previewCalls++;
      return structuredClone(current);
    },
    commit: async (intent) => {
      writes.push(structuredClone(intent));
      if (reject) throw reject;
      return {
        kind: 'cancel',
        data: {
          ...cancellation,
          status: 'CANCELLED',
          cancelledAt: '2026-10-12T00:00:00Z',
          cancelReason: 'GUEST_REQUEST',
          releasedAssignmentCount: 1,
          refundRequest: null,
        },
      };
    },
  };
  const controller = new ChangeController({
    kind: 'cancel',
    bookingId: 'b1',
    etag: '"4"',
    api,
    net: { getConnected: async () => connected },
    now: () => now,
    createId: () => '11111111-1111-4111-8111-111111111111',
  });
  controller.edit(draft);
  return {
    controller,
    writes,
    api,
    setOnline: (value: boolean) => {
      connected = value;
    },
    setNow: (value: number) => {
      now = value;
    },
    setPreview: (value: ChangePreview) => {
      current = value;
    },
    setError: (value: unknown) => {
      reject = value;
    },
    calls: () => previewCalls,
  };
}
export const timeout = () => new ApiError({ kind: 'timeout', message: 'synthetic' });

export function rescheduledBooking(checkIn: string, checkOut: string) {
  return bookingSummarySchema.parse({
    id: 'b1',
    code: 'PH-test',
    seq: 1,
    status: 'CONFIRMED',
    guestId: 'g1',
    propertyId: 'p1',
    roomTypeId: 'rt1',
    ratePlanId: 'uuid-plan',
    channelId: 'uuid-channel',
    ratePlanCode: 'FLEX7',
    channelCode: 'WEB',
    checkIn,
    checkOut,
    nights: 2,
    adults: 2,
    children: 0,
    roomCount: 1,
    totalAmount: 1900001,
    depositPercent: 30,
    depositAmount: 570001,
    paidAmount: 600001,
    refundedAmount: 0,
    balanceDue: 1300000,
    penaltyAmount: 0,
    currency: 'VND',
    rescheduleCount: 1,
    holdExpiresAt: null,
    oversold: false,
    priceLocked: true,
    duplicateSuspected: false,
    channelPolicyCode: null,
    note: null,
    createdBy: 'g1',
    createdAt: '2026-12-01T00:00:00Z',
    version: 5,
  });
}
