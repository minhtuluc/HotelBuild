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

  it('nhu cầu đã dùng không đổi trần hạn mức đang nhập (BR-INV-05)', () => {
    expect(overSellingUnitIssue('4', 6, 5)).toBeNull();
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

  it('cảnh báo vượt đơn vị bán không chặn gửi lô tới máy chủ', () => {
    const rows = [row('2026-12-24', '3'), row('2026-12-25', '99')];
    expect(validateDrafts(rows, 8, { from: '2026-12-24', to: '2026-12-25' })).toEqual([]);
    expect(rowIssue(rows[1]!, 8)).toEqual({ field: 'allotment', issue: 'OVER_SELLING_UNITS' });
  });
});

describe('emptyRowsFor (AC1)', () => {
  it('lấp ngày máy chủ trả, ngày thiếu chưa cấu hình và giữ mức đã dùng', () => {
    const server: AllotmentRow[] = [{ date: '2026-12-25', allotment: 4, used: 3 }];
    expect(emptyRowsFor({ from: '2026-12-24', to: '2026-12-26' }, server)).toEqual([
      { date: '2026-12-24', value: '', used: undefined, original: undefined },
      { date: '2026-12-25', value: '4', used: 3, original: 4 },
      { date: '2026-12-26', value: '', used: undefined, original: undefined },
    ]);
  });
});

it('missing configuration is not invented zero; entering explicit zero is a real change', () => {
  const rows = emptyRowsFor({ from: '2026-12-24', to: '2026-12-24' }, []);
  expect(rows).toEqual([{ date: '2026-12-24', value: '', used: undefined, original: undefined }]);
  expect(changedItems(rows)).toEqual([]);
  expect(changedItems(rows.map((row) => ({ ...row, value: '0' })))).toEqual([
    { date: '2026-12-24', allotment: 0 },
  ]);
});
it('used above supply does not invalidate a requested quota below supply', () => {
  expect(overSellingUnitIssue('4', 6, 5)).toBeNull();
  expect(
    validateDrafts([row('2026-12-24', '4', 6, 5)], 5, { from: '2026-12-24', to: '2026-12-24' }),
  ).toEqual([]);
});
it('oversupply is a hint; valid integer batch reaches authoritative server validation', () => {
  expect(rowIssue(row('2026-12-24', '99'), 8)?.issue).toBe('OVER_SELLING_UNITS');
  expect(
    validateDrafts([row('2026-12-24', '99')], 8, { from: '2026-12-24', to: '2026-12-24' }),
  ).toEqual([]);
});
it('unsafe integers are never rounded into a quota command', () => {
  const rows = [row('2026-12-24', '9007199254740993')];
  expect(changedItems(rows)).toEqual([]);
  expect(validateDrafts(rows, undefined, { from: '2026-12-24', to: '2026-12-24' })).toEqual([
    { field: 'items[0].allotment', issue: 'OUT_OF_RANGE' },
  ]);
});
it('invalid calendar dates are rejected rather than normalized into another day', () => {
  expect(validateDrafts([], undefined, { from: '2026-02-30', to: '2026-03-01' })).toEqual([
    { field: 'range', issue: 'RANGE_INVALID' },
  ]);
});
