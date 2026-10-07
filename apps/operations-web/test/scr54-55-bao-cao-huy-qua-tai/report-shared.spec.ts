/** HB-165: phần thuần SCR-54/SCR-55 — tổng hợp số ca huỷ, hoàn tiền và chi phí xử lý quá tải. */
import { describe, expect, it } from 'vitest';
import {
  OVERBOOKING_STATUS_KEY,
  cancellationsTotals,
  overbookingTotals,
} from '../../src/app/(ops)/reports/report-shared';

describe('cancellationsTotals (AC1)', () => {
  it('cộng số ca huỷ và tiền hoàn theo đúng các dòng máy chủ trả', () => {
    const totals = cancellationsTotals([
      { cancellations: 2, refundAmount: 1_304_000 },
      { cancellations: 1, refundAmount: 0 },
    ]);
    expect(totals).toEqual({ cancellations: 3, refundAmount: 1_304_000 });
  });

  it('không có ca nào thì tổng bằng 0 (không bịa số)', () => {
    expect(cancellationsTotals([])).toEqual({ cancellations: 0, refundAmount: 0 });
  });
});

describe('overbookingTotals (AC1, BR-OVER-15)', () => {
  it('đếm số ca và cộng ba khoản chi phí xử lý cùng tổng', () => {
    const totals = overbookingTotals([
      {
        mergeDiscountAmount: 200_000,
        walkOutCompensationAmount: 1_100_000,
        transportSupportAmount: 150_000,
        totalCost: 1_450_000,
      },
      {
        mergeDiscountAmount: 0,
        walkOutCompensationAmount: 0,
        transportSupportAmount: 100_000,
        totalCost: 100_000,
      },
    ]);
    expect(totals).toEqual({
      cases: 2,
      mergeDiscountAmount: 200_000,
      walkOutCompensationAmount: 1_100_000,
      transportSupportAmount: 250_000,
      totalCost: 1_550_000,
    });
  });
});

describe('OVERBOOKING_STATUS_KEY (AC1)', () => {
  it('đủ bốn trạng thái hợp đồng để hiển thị nhãn', () => {
    expect(Object.keys(OVERBOOKING_STATUS_KEY).sort()).toEqual([
      'ESCALATED',
      'OPEN',
      'PROPOSED',
      'RESOLVED',
    ]);
  });
});
