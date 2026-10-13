import type { CancellationTier } from '@pinehill/contracts';
/** Presentation validation follows BR-RATE-20 and published HB057 canonical transport. */
export interface TierRow {
  hoursBeforeCheckIn: string;
  offsetHours?: string;
  refundPercent: string;
  chargeFirstNight?: boolean;
}
export const MAX_TIERS = 32767; // HB057 DB sort_order technical bound, no four-tier policy limit.
export const CATCH_ALL_HOURS = -1;
export function parseInteger(value: string): number | null {
  const trimmed = value.trim();
  if (trimmed === '' || !/^-?\d+$/.test(trimmed)) return null;
  const parsed = Number(trimmed);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

export function intInRange(raw: string, min: number, max: number): number | null {
  const value = parseInteger(raw);
  if (value === null || value < min || value > max) return null;
  return value;
}

export function wireOffset(tier: CancellationTier): number {
  return tier.offsetHours ?? (tier.hoursBeforeCheckIn === 0 ? -1 : tier.hoursBeforeCheckIn);
}
export function tierOffset(row: TierRow): number | null {
  if (row.offsetHours !== undefined) return parseInteger(row.offsetHours);
  const legacy = parseInteger(row.hoursBeforeCheckIn);
  return legacy === 0 ? -1 : legacy;
}
export function tierRowOf(tier: CancellationTier): TierRow {
  return {
    hoursBeforeCheckIn: String(tier.hoursBeforeCheckIn),
    refundPercent: String(tier.refundPercent),
    ...(tier.offsetHours === undefined ? {} : { offsetHours: String(tier.offsetHours) }),
    ...(tier.chargeFirstNight === undefined ? {} : { chargeFirstNight: tier.chargeFirstNight }),
  };
}
export function tierRequest(row: TierRow): CancellationTier {
  const offset = tierOffset(row),
    refund = intInRange(row.refundPercent, 0, 100);
  if (offset === null || offset < -1 || offset > 2147483647 || refund === null)
    throw Error('Invalid tier input');
  return {
    hoursBeforeCheckIn: Math.max(0, offset),
    refundPercent: refund,
    ...(row.offsetHours === undefined ? {} : { offsetHours: offset }),
    ...(row.chargeFirstNight === undefined ? {} : { chargeFirstNight: row.chargeFirstNight }),
  };
}
export interface TierIssue {
  index: number;
  field: 'hoursBeforeCheckIn' | 'refundPercent' | 'chargeFirstNight';
  issue: string;
}

/**
 * Trích chỉ số bậc từ `details[].field` của `E_RATE_CONFIGURATION_INVALID` (AC5).
 * Server khai dạng `tiers[2].hoursBeforeCheckIn` (hoặc `tiers.2.…`); không khớp → `null`.
 */
export function tierIndexFromField(field: string): number | null {
  const match = /tiers\[(\d+)\]|tiers\.(\d+)/.exec(field);
  if (match === null) return null;
  return Number(match[1] ?? match[2]);
}

function parseTierValue(
  raw: string,
  index: number,
  field: TierIssue['field'],
  min: number,
  max: number,
): { value: number; issues: TierIssue[] } {
  const value = intInRange(raw, min, max);
  if (value === null) {
    return { value: NaN, issues: [{ index, field, issue: 'OUT_OF_RANGE' }] };
  }
  return { value, issues: [] };
}

function orderIssues(
  values: readonly number[],
  field: TierIssue['field'],
  issue: string,
): TierIssue[] {
  const issues: TierIssue[] = [];
  for (let i = 1; i < values.length; i += 1) {
    const previous = values[i - 1] ?? NaN;
    const current = values[i] ?? NaN;
    if (!Number.isNaN(previous) && !Number.isNaN(current) && current >= previous) {
      issues.push({ index: i, field, issue });
    }
  }
  return issues;
}

function refundOrderIssues(values: readonly number[]): TierIssue[] {
  const issues: TierIssue[] = [];
  for (let i = 1; i < values.length; i += 1) {
    const previous = values[i - 1] ?? NaN;
    const current = values[i] ?? NaN;
    if (!Number.isNaN(previous) && !Number.isNaN(current) && current > previous) {
      issues.push({ index: i, field: 'refundPercent', issue: 'INCREASING' });
    }
  }
  return issues;
}

function catchAllIssue(hours: readonly number[], lastIndex: number): TierIssue | null {
  const count = hours.filter((hour) => hour === CATCH_ALL_HOURS).length;
  if (count === 0)
    return { index: lastIndex, field: 'hoursBeforeCheckIn', issue: 'MISSING_CATCH_ALL' };
  if (count > 1 || hours[hours.length - 1] !== CATCH_ALL_HOURS) {
    return { index: lastIndex, field: 'hoursBeforeCheckIn', issue: 'CATCH_ALL_NOT_LAST' };
  }
  return null;
}

/**
 * Validate theo **từng hàng** (AC3): mốc giờ nguyên ≥ 0 và giảm dần nghiêm ngặt (không tăng/trùng),
 * phần trăm nguyên 0–100 và **không tăng khi huỷ muộn hơn**, đúng một bậc bắt tất `0` ở cuối,
 * số bậc theo dữ liệu máy chủ, chặn vượt giới hạn kỹ thuật HB057. Mỗi lỗi kèm `index` để tô đúng hàng.
 */
export function validateTiers(rows: readonly TierRow[]): readonly TierIssue[] {
  if (rows.length === 0) return [{ index: -1, field: 'hoursBeforeCheckIn', issue: 'EMPTY' }];
  const issues: TierIssue[] = [];
  if (rows.length > MAX_TIERS) {
    issues.push({ index: MAX_TIERS, field: 'hoursBeforeCheckIn', issue: 'TOO_MANY' });
  }
  const hours: number[] = [];
  const refunds: number[] = [];
  rows.forEach((row, index) => {
    const hour = parseTierValue(
      String(tierOffset(row) ?? ''),
      index,
      'hoursBeforeCheckIn',
      -1,
      2147483647,
    );
    const refund = parseTierValue(row.refundPercent, index, 'refundPercent', 0, 100);
    if (row.chargeFirstNight && refund.value !== 0)
      issues.push({ index, field: 'chargeFirstNight', issue: 'REFUND_WITH_FIRST_NIGHT_CHARGE' });
    if (
      row.offsetHours !== undefined &&
      parseInteger(row.hoursBeforeCheckIn) !== Math.max(0, hour.value)
    )
      issues.push({ index, field: 'hoursBeforeCheckIn', issue: 'OFFSET_MISMATCH' });
    hours.push(hour.value);
    refunds.push(refund.value);
    issues.push(...hour.issues, ...refund.issues);
  });
  issues.push(...orderIssues(hours, 'hoursBeforeCheckIn', 'NOT_DESCENDING'));
  issues.push(...refundOrderIssues(refunds));
  const catchAll = catchAllIssue(hours, rows.length - 1);
  if (catchAll !== null) issues.push(catchAll);
  return issues;
}
