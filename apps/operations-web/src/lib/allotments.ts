/**
 * SCR-25 — allotment theo kênh (UC-INV-03, BR-INV-05, BR-CHAN-01,06,08): phần thuần kiểm bằng vitest.
 * Hạn mức mỗi kênh ≤ **số đơn vị bán ACTIVE** của loại phòng; **không** giới hạn tổng các kênh
 * (QĐ-05 mục 2). Cảnh báo ở đây chỉ để nhắc — máy chủ (HB-032/035) là nơi chặn.
 */
import type { AllotmentRow } from '@pinehill/contracts';
import { MAX_GRID_DAYS, gridDates, dayCount, validCalendarDate } from './inventory-grid';

export interface FieldIssue {
  field: string;
  issue: string;
}

/** Mỗi lô gửi tối đa 31 ngày (`allotmentPutRequestSchema.items` max 31). */
export const MAX_ALLOTMENT_ITEMS = MAX_GRID_DAYS;

export interface AllotmentDraftRow {
  date: string;
  /** Chuỗi người dùng nhập; giữ nguyên để kiểm và hiển thị lại khi lỗi. */
  value: string;
  used: number | undefined;
  /** Mức máy chủ trả ở lần đọc — dùng để biết ngày nào **thực sự đổi**. */
  original: number | undefined;
}

export function draftRowsOf(rows: readonly AllotmentRow[]): AllotmentDraftRow[] {
  return rows.map((row) => ({
    date: row.date,
    value: String(row.allotment),
    used: row.used,
    original: row.allotment,
  }));
}

function parseInteger(value: string): number | null {
  const trimmed = value.trim();
  if (trimmed === '' || !/^-?\d+$/.test(trimmed)) return null;
  const parsed = Number(trimmed);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

/**
 * Cảnh báo của **một ngày** (AC2): vượt số đơn vị bán `ACTIVE` thì nhắc, `used` là nhu cầu đã bán, không phải hạn mức đang nhập. `sellingUnits` chưa có (máy chủ chưa trả) → không cảnh báo, không bịa số.
 */
export function overSellingUnitIssue(
  value: string,
  _used: number | undefined,
  sellingUnits: number | undefined,
): FieldIssue | null {
  const parsed = parseInteger(value);
  if (parsed === null || sellingUnits === undefined) return null;
  return parsed > sellingUnits ? { field: 'allotment', issue: 'OVER_SELLING_UNITS' } : null;
}

/** Lỗi của một ngày: số nguyên ≥ 0 bắt buộc; vượt đơn vị bán là **cảnh báo** cùng cơ chế (AC2). */
export function rowIssue(
  row: AllotmentDraftRow,
  sellingUnits: number | undefined,
): FieldIssue | null {
  if (row.original === undefined && row.value === '') return null;
  const parsed = parseInteger(row.value);
  if (parsed === null || parsed < 0) return { field: 'allotment', issue: 'OUT_OF_RANGE' };
  return overSellingUnitIssue(row.value, row.used, sellingUnits);
}

/** Kiểm cả lô: khoảng ≤ 31 ngày và từng ngày hợp lệ (chặn gửi khi lỗi). */
export function validateDrafts(
  rows: readonly AllotmentDraftRow[],
  sellingUnits: number | undefined,
  range: { from: string; to: string },
): readonly FieldIssue[] {
  const issues: FieldIssue[] = [];
  if (!validCalendarDate(range.from) || !validCalendarDate(range.to))
    return [{ field: 'range', issue: 'RANGE_INVALID' }];
  const days = dayCount(range.from, range.to);
  if (Number.isNaN(days) || days < 1) {
    issues.push({ field: 'range', issue: 'BEFORE_START' });
    return issues;
  }
  if (days > MAX_ALLOTMENT_ITEMS) issues.push({ field: 'range', issue: 'TOO_MANY_DAYS' });
  rows.forEach((row, index) => {
    const issue = rowIssue(row, sellingUnits);
    if (issue !== null && issue.issue !== 'OVER_SELLING_UNITS')
      issues.push({ field: `items[${index}].${issue.field}`, issue: issue.issue });
  });
  return issues;
}

/** A normalized equal value has no user change; invalid input remains owned by the editor. */
export function unchangedDraft(row: AllotmentDraftRow): boolean {
  if (row.original === undefined) return row.value === '';
  return parseInteger(row.value) === row.original;
}

/** Ngày nào **thực sự đổi** so với lần đọc (AC4) — không gửi cả khoảng. */
export function changedItems(
  rows: readonly AllotmentDraftRow[],
): readonly { date: string; allotment: number }[] {
  return rows.flatMap((row) => {
    const parsed = parseInteger(row.value);
    if (parsed === null || parsed === row.original) return [];
    return [{ date: row.date, allotment: parsed }];
  });
}

/** Chuỗi ngày của lô mới khi người dùng đổi kênh/loại phòng/khoảng; ngày máy chủ đã trả thì lấy số đó. */
export function emptyRowsFor(
  range: { from: string; to: string },
  rows: readonly AllotmentRow[],
): AllotmentDraftRow[] {
  return gridDates(range.from, range.to).map((date) => {
    const found = rows.find((row) => row.date === date);
    return {
      date,
      value: found ? String(found.allotment) : '',
      used: found?.used,
      original: found?.allotment,
    };
  });
}
