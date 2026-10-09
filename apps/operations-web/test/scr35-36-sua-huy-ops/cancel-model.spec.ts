import { describe, expect, it } from 'vitest';
import { cancelPreviewSchema } from '@pinehill/contracts';
import type { CancellationPolicy } from '@pinehill/contracts';
import {
  CANCEL_REASONS,
  EMPTY_CANCEL_DRAFT,
  PARTIAL_CANCEL_SUPPORTED,
  canConfirmCancel,
  cancelRequestOf,
  ladderRows,
  previewRequestOf,
  refundRows,
  rescheduleRequestOf,
  sameBreakdown,
  samePreview,
  stayDifference,
} from '../../src/app/(ops)/bookings/[bookingId]/cancel/cancel-model';

const PREVIEW = cancelPreviewSchema.parse({
  bookingId: 'b1',
  currency: 'VND',
  cancellation: {
    policyId: 'pol-1',
    appliedTierId: '72h',
    hoursBeforeCheckIn: 96,
    refundPercent: 100,
    paidAmount: 600_000,
    requestedAmount: 600_000,
    penaltyAmount: 0,
    refundFee: 0,
  },
  warnings: [],
});

const POLICY: CancellationPolicy = {
  id: 'pol-1',
  name: 'Chuẩn',
  status: 'ACTIVE',
  tiers: [
    { hoursBeforeCheckIn: 168, refundPercent: 100, label: 'Trước 7 ngày' },
    { hoursBeforeCheckIn: 96, refundPercent: 100 },
    { hoursBeforeCheckIn: 24, refundPercent: 50 },
  ],
  earlyCheckoutFreeHours: 2,
  earlyCheckoutRefundPct: 100,
  version: 1,
};

describe('SCR-35/SCR-36 sửa/đổi ngày/huỷ booking (HB-108)', () => {
  it('chỉ mở nút xác nhận sau bước xem trước (AC1: hai bước)', () => {
    expect(canConfirmCancel('previewed')).toBe(true);
    for (const step of ['choose', 'computing', 'submitting', 'done'] as const) {
      expect(canConfirmCancel(step)).toBe(false);
    }
    expect(PARTIAL_CANCEL_SUPPORTED).toBe(false);
  });

  it('thân lệnh xem trước/xác nhận huỷ bỏ khoá rỗng và tách chứng cứ theo dòng', () => {
    expect(previewRequestOf(EMPTY_CANCEL_DRAFT)).toEqual({
      reason: 'GUEST_REQUEST',
      isForceMajeure: false,
    });
    expect(cancelRequestOf(EMPTY_CANCEL_DRAFT)).toEqual({
      reason: 'GUEST_REQUEST',
      isForceMajeure: false,
    });
    expect(
      cancelRequestOf({
        reason: 'FORCE_MAJEURE',
        isForceMajeure: true,
        note: '  Bão  ',
        evidence: 'anh-1.png\n\n anh-2.png ',
      }),
    ).toEqual({
      reason: 'FORCE_MAJEURE',
      isForceMajeure: true,
      note: 'Bão',
      evidenceRefs: ['anh-1.png', 'anh-2.png'],
    });
    // Chỉ 5 lý do lễ tân được chọn; 4 giá trị enum còn lại thuộc luồng khác.
    expect(CANCEL_REASONS).toEqual([
      'GUEST_REQUEST',
      'FORCE_MAJEURE',
      'HOTEL_RELOCATION',
      'PAYMENT_TIMEOUT',
      'DUPLICATE',
    ]);
  });

  it('phát hiện số liệu huỷ đã đổi để buộc xem trước lại', () => {
    expect(samePreview(PREVIEW, PREVIEW)).toBe(true);
    expect(
      sameBreakdown(PREVIEW.cancellation, { ...PREVIEW.cancellation, requestedAmount: 0 }),
    ).toBe(false);
    expect(
      sameBreakdown(PREVIEW.cancellation, { ...PREVIEW.cancellation, hoursBeforeCheckIn: 24 }),
    ).toBe(false);
    expect(samePreview(PREVIEW, { ...PREVIEW, bookingId: 'b2' })).toBe(false);
  });

  it('bốn dòng tiền hoàn luôn đủ và thang bậc khoanh đúng bậc đang áp dụng', () => {
    expect(refundRows(PREVIEW.cancellation).map((row) => row.key)).toEqual([
      'paid',
      'requested',
      'penalty',
      'fee',
    ]);
    expect(refundRows(PREVIEW.cancellation).map((row) => row.amount)).toEqual([
      600_000, 600_000, 0, 0,
    ]);
    expect(ladderRows(POLICY, 96).map((row) => row.applied)).toEqual([false, true, false]);
    // Máy chủ trả số giờ không khớp bậc nào thì không khoanh bậc (không tự suy luật chính sách).
    expect(ladderRows(POLICY, 50).every((row) => !row.applied)).toBe(true);
  });

  it('đổi ngày: chênh lệch hai số máy chủ trả và thân lệnh gửi kèm lý do khi có', () => {
    expect(stayDifference(3_000_000, 2_000_000)).toEqual({ kind: 'more', amount: 1_000_000 });
    expect(stayDifference(1_000_000, 2_000_000)).toEqual({ kind: 'less', amount: 1_000_000 });
    expect(stayDifference(2_000_000, 2_000_000)).toEqual({ kind: 'same', amount: 0 });
    expect(rescheduleRequestOf('2026-12-27', '2026-12-29', 'q1', '  ')).toEqual({
      checkIn: '2026-12-27',
      checkOut: '2026-12-29',
      quoteId: 'q1',
    });
    expect(rescheduleRequestOf('2026-12-27', '2026-12-29', 'q1', 'Khách xin đổi')).toEqual({
      checkIn: '2026-12-27',
      checkOut: '2026-12-29',
      quoteId: 'q1',
      reason: 'Khách xin đổi',
    });
  });
});
