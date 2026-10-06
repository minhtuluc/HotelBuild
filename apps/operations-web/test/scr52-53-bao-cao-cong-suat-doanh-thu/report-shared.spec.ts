/** HB-164: phần thuần dùng chung SCR-52/SCR-53 — kiểm kỳ, tham số xuất, tổng hợp, trạng thái tác vụ. */
import { describe, expect, it } from 'vitest';
import {
  OPERATION_STATUS_KEY,
  exportRequest,
  filtersToParams,
  isTerminal,
  rangeIssue,
  revenueTotals,
} from '../../src/app/(ops)/reports/report-shared';

describe('rangeIssue (AC1)', () => {
  it('bắt buộc hai đầu và kỳ phải kết thúc sau ngày bắt đầu', () => {
    expect(rangeIssue('', '2026-12-27')).toEqual({ field: 'from', issue: 'REQUIRED' });
    expect(rangeIssue('2026-12-24', '')).toEqual({ field: 'to', issue: 'REQUIRED' });
    expect(rangeIssue('2026-12-27', '2026-12-27')).toEqual({ field: 'to', issue: 'BEFORE_START' });
    expect(rangeIssue('2026-12-27', '2026-12-24')).toEqual({ field: 'to', issue: 'BEFORE_START' });
    expect(rangeIssue('2026-12-24', '2026-12-27')).toBeNull();
  });
});

describe('filtersToParams / exportRequest (AC2)', () => {
  it('chỉ gửi bộ lọc đã khai, kèm kỳ và định dạng', () => {
    const filters = {
      propertyId: 'p1',
      from: '2026-12-24',
      to: '2026-12-27',
      groupBy: 'DAY' as const,
    };
    expect(filtersToParams(filters)).toEqual({
      from: '2026-12-24',
      to: '2026-12-27',
      propertyId: 'p1',
    });
    expect(
      exportRequest('revenue-by-channel', 'CSV', filtersToParams({ ...filters, propertyId: '' })),
    ).toEqual({
      report: 'revenue-by-channel',
      format: 'CSV',
      params: { from: '2026-12-24', to: '2026-12-27' },
    });
  });
});

describe('isTerminal + nhãn trạng thái (AC2)', () => {
  it('chỉ PENDING/RUNNING là còn phải hỏi lại', () => {
    expect(isTerminal('PENDING')).toBe(false);
    expect(isTerminal('RUNNING')).toBe(false);
    expect(isTerminal('SUCCEEDED')).toBe(true);
    expect(isTerminal('FAILED')).toBe(true);
  });

  it('mọi trạng thái hợp đồng đều có nhãn hiển thị', () => {
    expect(Object.keys(OPERATION_STATUS_KEY).sort()).toEqual([
      'FAILED',
      'PENDING',
      'RUNNING',
      'SUCCEEDED',
    ]);
  });
});

describe('revenueTotals (AC1/AC2 — số khớp tệp xuất)', () => {
  it('cộng đúng các con số máy chủ trả theo từng kênh', () => {
    const totals = revenueTotals([
      { grossAmount: 5_328_750, commissionAmount: 959_175, netAmount: 4_369_575, bookings: 3 },
      { grossAmount: 8_112_000, commissionAmount: 0, netAmount: 8_112_000, bookings: 5 },
    ]);
    expect(totals).toEqual({
      grossAmount: 13_440_750,
      commissionAmount: 959_175,
      netAmount: 12_481_575,
      bookings: 8,
    });
  });

  it('không có kênh nào thì tổng bằng 0 (không bịa số)', () => {
    expect(revenueTotals([])).toEqual({
      grossAmount: 0,
      commissionAmount: 0,
      netAmount: 0,
      bookings: 0,
    });
  });
});
