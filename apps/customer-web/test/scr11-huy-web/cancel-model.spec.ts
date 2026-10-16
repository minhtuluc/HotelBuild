import { describe, expect, it } from 'vitest';
import type { CancelPreview } from '@pinehill/contracts';
import {
  CANCEL_REASONS,
  canConfirm,
  claimsForceMajeure,
  formatHoursBeforeCheckIn,
  refundRows,
  sameBreakdown,
  samePreview,
} from '../../src/app/(guest)/bookings/cancel-model';

const breakdown = {
  policyId: 'p1',
  appliedTierId: 'unconfirmed',
  hoursBeforeCheckIn: 96,
  refundPercent: 100,
  paidAmount: 250_499,
  requestedAmount: 250_499,
  penaltyAmount: 0,
  refundFee: 0,
};

function preview(overrides: Partial<typeof breakdown> = {}): CancelPreview {
  return {
    bookingId: 'bk-1',
    currency: 'VND',
    cancellation: { ...breakdown, ...overrides },
  };
}

describe('SCR-11 huỷ & tiền hoàn (HB-103)', () => {
  it('chỉ mở nút xác nhận khi đã có kết quả xem trước (AC1)', () => {
    expect(canConfirm('previewed')).toBe(true);
    for (const step of ['idle', 'computing', 'submitting', 'done'] as const) {
      expect(canConfirm(step)).toBe(false);
    }
  });

  it('khai bất khả kháng chỉ khi chọn đúng lý do đó', () => {
    expect(CANCEL_REASONS).toEqual(['GUEST_REQUEST', 'FORCE_MAJEURE']);
    expect(claimsForceMajeure('FORCE_MAJEURE')).toBe(true);
    expect(claimsForceMajeure('GUEST_REQUEST')).toBe(false);
  });

  it('phát hiện số liệu máy chủ đã đổi (qua mốc/version) để buộc xem trước lại', () => {
    const base = preview();
    expect(sameBreakdown(base.cancellation, preview().cancellation)).toBe(true);
    expect(samePreview(base, { ...base })).toBe(true);
    expect(sameBreakdown(base.cancellation, preview({ requestedAmount: 0 }).cancellation)).toBe(
      false,
    );
    expect(
      sameBreakdown(base.cancellation, preview({ appliedTierId: 'catch-all' }).cancellation),
    ).toBe(false);
    expect(sameBreakdown(base.cancellation, preview({ hoursBeforeCheckIn: 48 }).cancellation)).toBe(
      false,
    );
    expect(sameBreakdown(base.cancellation, preview({ refundPercent: 50 }).cancellation)).toBe(
      false,
    );
    expect(samePreview(base, { ...base, bookingId: 'bk-2' })).toBe(false);
  });

  it('bảng tiền hoàn luôn đủ bốn dòng để khách đối chiếu', () => {
    expect(refundRows(breakdown).map((row) => row.key)).toEqual([
      'paid',
      'requested',
      'penalty',
      'fee',
    ]);
    expect(refundRows(breakdown).map((row) => row.amount)).toEqual([250_499, 250_499, 0, 0]);
  });

  it('hiện số giờ trước giờ nhận phòng một chữ số thập phân theo vi-VN', () => {
    expect(formatHoursBeforeCheckIn(96)).toBe('96,0');
    expect(formatHoursBeforeCheckIn(5.5)).toBe('5,5');
    expect(formatHoursBeforeCheckIn(0)).toBe('0,0');
  });
});
