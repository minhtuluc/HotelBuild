/** HB-042: phần thuần SCR-25 — cảnh báo vượt đơn vị bán, chỉ gửi ngày đã đổi, kiểm khoảng lô. */
import { describe, expect, it } from 'vitest';
import type { AllotmentRow } from '@pinehill/contracts';
import {
  changedItems,
  emptyRowsFor,
  overSellingUnitIssue,
  rowIssue,
  validateDrafts,
  type AllotmentDraftRow,
} from '../src/lib/allotments';

const row = (date: string, value: string, used = 0, original = 0): AllotmentDraftRow => ({
  date,
  value,
  used,
  original,
});

describe('overSellingUnitIssue (AC2)', () => {
  it('cảnh báo khi vượt số đơn vị bán ACTIVE, không cảnh báo khi bằng', () => {
    expect(overSellingUnitIssue('9', 0, 8)).toEqual({
      field: 'allotment',
      issue: 'OVER_SELLING_UNITS',
    });
    expect(overSellingUnitIssue('8', 0, 8)).toBeNull();
  });

  it('không suy diễn khi máy chủ chưa trả sellingUnits', () => {
    expect(overSellingUnitIssue('999', 0, undefined)).toBeNull();
  });

  it('cảnh báo cả khi mức đã dùng vượt hạn mức mới đặt', () => {
    // used 6 > units 5 → hạ hạn mức xuống 4 vẫn vượt trần đơn vị bán.
    expect(overSellingUnitIssue('4', 6, 5)).toEqual({
      field: 'allotment',
      issue: 'OVER_SELLING_UNITS',
    });
  });
});

describe('rowIssue (AC2, AC3)', () => {
  it('chặn hạn mức không phải số nguyên không âm', () => {
    expect(rowIssue(row('2026-12-24', ''), 8)).toEqual({
      field: 'allotment',
      issue: 'OUT_OF_RANGE',
    });
    expect(rowIssue(row('2026-12-24', '-1'), 8)).toEqual({
      field: 'allotment',
      issue: 'OUT_OF_RANGE',
    });
    expect(rowIssue(row('2026-12-24', '1,5'), 8)).toEqual({
      field: 'allotment',
      issue: 'OUT_OF_RANGE',
    });
    expect(rowIssue(row('2026-12-24', '12'), 8)).toEqual({
      field: 'allotment',
      issue: 'OVER_SELLING_UNITS',
    });
  });
});

describe('changedItems (AC4)', () => {
  it('chỉ trả về ngày thực sự đổi so với lần đọc', () => {
    const rows = [
      row('2026-12-24', '5', 0, 5),
      row('2026-12-25', '7', 0, 6),
      row('2026-12-26', '6', 0, 6),
    ];
    expect(changedItems(rows)).toEqual([{ date: '2026-12-25', allotment: 7 }]);
  });

  it('bỏ qua ngày nhập sai (đã bị chặn trước khi gửi)', () => {
    expect(changedItems([row('2026-12-24', 'x', 0, 5)])).toEqual([]);
  });
});

describe('validateDrafts (AC1, AC3)', () => {
  it('chặn khoảng quá 31 ngày và khoảng sai', () => {
    const rows = [row('2026-12-01', '1')];
    expect(validateDrafts(rows, 5, { from: '2026-12-01', to: '2027-01-05' })).toContainEqual({
      field: 'range',
      issue: 'TOO_MANY_DAYS',
    });
    expect(validateDrafts(rows, 5, { from: '2026-12-05', to: '2026-12-01' })).toEqual([
      { field: 'range', issue: 'BEFORE_START' },
    ]);
  });

  it('lỗi theo hàng kèm chỉ số để màn hình tô đúng dòng', () => {
    const rows = [row('2026-12-24', '3'), row('2026-12-25', '99')];
    expect(validateDrafts(rows, 8, { from: '2026-12-24', to: '2026-12-25' })).toEqual([
      { field: 'items[1].allotment', issue: 'OVER_SELLING_UNITS' },
    ]);
  });
});

describe('emptyRowsFor (AC1)', () => {
  it('lấp ngày máy chủ trả, ngày thiếu mặc định 0 và giữ mức đã dùng', () => {
    const server: AllotmentRow[] = [{ date: '2026-12-25', allotment: 4, used: 3 }];
    expect(emptyRowsFor({ from: '2026-12-24', to: '2026-12-26' }, server)).toEqual([
      { date: '2026-12-24', value: '0', used: 0, original: 0 },
      { date: '2026-12-25', value: '4', used: 3, original: 4 },
      { date: '2026-12-26', value: '0', used: 0, original: 0 },
    ]);
  });
});
