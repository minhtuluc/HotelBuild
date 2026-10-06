/**
 * SCR-70 — gói giá & chính sách huỷ (UC-RATE-06, BR-CANCEL-01,02,09, BR-RATE-16,20): phần thuần kiểm
 * được bằng vitest. Bậc là **dữ liệu** (BR-CANCEL-01) — không hard-code mốc giờ; mọi quy tắc ở đây chỉ
 * để chặn lưu **tại chỗ**, máy chủ (HB-057) là nơi chặn cuối và trả `E_RATE_CONFIGURATION_INVALID`.
 */
import type {
  CancellationPolicy,
  CancellationPolicyUpdateRequest,
  CancellationTier,
  RatePlanAdmin,
  RatePlanUpdateRequest,
} from '@pinehill/contracts';

export interface FieldIssue {
  field: string;
  issue: string;
}

/** Giới hạn số bậc mỗi chính sách (thiết kế lớp §… `1..4`; FLEX7 là chính sách nhiều bậc nhất = 4). */
export const MAX_TIERS = 4;

/** Bậc bắt tất theo hợp đồng API: `hoursBeforeCheckIn = 0` (đúng một bậc, phải là bậc cuối). */
export const CATCH_ALL_HOURS = 0;

/** ETag theo phiên bản (`"7"`) — thiếu thì máy chủ trả 428, lệch → 412 (api.md §1.3). */
export function ifMatchOf(version: number): string {
  return `"${version}"`;
}

// ---------------------------------------------------------------------------------------------
// Gói giá (AC1, AC7) — sửa bằng `PUT /rate-plans/{id}` + `If-Match`; chỉ gửi trường thực sự đổi.
// ---------------------------------------------------------------------------------------------

export interface RatePlanDraft {
  id: string;
  code: string;
  depositPercent: string;
  minNights: string;
  maxNights: string;
  cancellationPolicyId: string;
  status: 'ACTIVE' | 'INACTIVE';
  version: number;
  reason: string;
}

export function ratePlanDraftOf(plan: RatePlanAdmin): RatePlanDraft {
  return {
    id: plan.id,
    code: plan.code,
    depositPercent: String(plan.depositPercent),
    minNights: String(plan.minNights),
    maxNights: String(plan.maxNights),
    cancellationPolicyId: plan.cancellationPolicyId,
    status: plan.status,
    version: plan.version,
    reason: '',
  };
}

function parseInteger(value: string): number | null {
  const trimmed = value.trim();
  if (trimmed === '' || !/^-?\d+$/.test(trimmed)) return null;
  return Number(trimmed);
}

function intInRange(raw: string, min: number, max: number): number | null {
  const value = parseInteger(raw);
  if (value === null || value < min || value > max) return null;
  return value;
}

function depositIssue(raw: string): FieldIssue | null {
  return intInRange(raw, 0, 100) === null
    ? { field: 'depositPercent', issue: 'OUT_OF_RANGE' }
    : null;
}

function minNightsIssue(raw: string): FieldIssue | null {
  return intInRange(raw, 1, Number.MAX_SAFE_INTEGER) === null
    ? { field: 'minNights', issue: 'OUT_OF_RANGE' }
    : null;
}

function maxNightsIssue(raw: string, minRaw: string): FieldIssue | null {
  const max = intInRange(raw, 1, Number.MAX_SAFE_INTEGER);
  const min = parseInteger(minRaw);
  if (max === null) return { field: 'maxNights', issue: 'OUT_OF_RANGE' };
  if (min !== null && min > max) return { field: 'maxNights', issue: 'BELOW_MIN' };
  return null;
}

function collect(issues: readonly (FieldIssue | null)[]): FieldIssue[] {
  return issues.filter((issue): issue is FieldIssue => issue !== null);
}

/** Các trường cấu hình có đổi gì so với bản máy chủ không. */
function ratePlanChanged(draft: RatePlanDraft, plan: RatePlanAdmin): boolean {
  return (
    parseInteger(draft.depositPercent) !== plan.depositPercent ||
    parseInteger(draft.minNights) !== plan.minNights ||
    parseInteger(draft.maxNights) !== plan.maxNights ||
    draft.cancellationPolicyId.trim() !== plan.cancellationPolicyId ||
    draft.status !== plan.status
  );
}

/** Kiểm `depositPercent` 0–100, `minNights` ≥ 1, `maxNights` ≥ `minNights` (BR-RATE-20) và lý do. */
export function validateRatePlanDraft(
  draft: RatePlanDraft,
  plan: RatePlanAdmin,
): readonly FieldIssue[] {
  const issues = collect([
    depositIssue(draft.depositPercent),
    minNightsIssue(draft.minNights),
    maxNightsIssue(draft.maxNights, draft.minNights),
    draft.cancellationPolicyId.trim() === ''
      ? { field: 'cancellationPolicyId', issue: 'REQUIRED' }
      : null,
    draft.reason.trim() === '' ? { field: 'reason', issue: 'REQUIRED' } : null,
  ]);
  if (issues.length === 0 && !ratePlanChanged(draft, plan)) {
    issues.push({ field: '(biểu mẫu)', issue: 'UNCHANGED' });
  }
  return issues;
}

/** Chỉ gửi trường **thực sự đổi** cộng `reason` — sửa chỉ áp cho báo giá mới (BR-RATE-16,20). */
export function ratePlanUpdateRequest(
  draft: RatePlanDraft,
  plan: RatePlanAdmin,
): RatePlanUpdateRequest {
  const request: RatePlanUpdateRequest = { reason: draft.reason.trim() };
  const deposit = parseInteger(draft.depositPercent);
  const minNights = parseInteger(draft.minNights);
  const maxNights = parseInteger(draft.maxNights);
  if (deposit !== null && deposit !== plan.depositPercent) request.depositPercent = deposit;
  if (minNights !== null && minNights !== plan.minNights) request.minNights = minNights;
  if (maxNights !== null && maxNights !== plan.maxNights) request.maxNights = maxNights;
  if (draft.cancellationPolicyId.trim() !== plan.cancellationPolicyId) {
    request.cancellationPolicyId = draft.cancellationPolicyId.trim();
  }
  if (draft.status !== plan.status) request.status = draft.status;
  return request;
}

// ---------------------------------------------------------------------------------------------
// Chính sách huỷ (AC2–AC6) — sửa bằng `PUT /cancellation-policies/{id}`: gửi **toàn bộ** bậc.
// ---------------------------------------------------------------------------------------------

export interface TierRow {
  hoursBeforeCheckIn: string;
  refundPercent: string;
}

export interface CancellationPolicyDraft {
  id: string;
  tiers: TierRow[];
  earlyCheckoutFreeHours: string;
  earlyCheckoutRefundPct: string;
  version: number;
  reason: string;
}

export function tierRowOf(tier: CancellationTier): TierRow {
  return {
    hoursBeforeCheckIn: String(tier.hoursBeforeCheckIn),
    refundPercent: String(tier.refundPercent),
  };
}

export function policyDraftOf(policy: CancellationPolicy): CancellationPolicyDraft {
  return {
    id: policy.id,
    tiers: policy.tiers.map(tierRowOf),
    earlyCheckoutFreeHours: String(policy.earlyCheckoutFreeHours),
    earlyCheckoutRefundPct: String(policy.earlyCheckoutRefundPct),
    version: policy.version,
    reason: '',
  };
}

export interface TierIssue {
  index: number;
  field: 'hoursBeforeCheckIn' | 'refundPercent';
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
 * số bậc 1..MAX_TIERS (BR-RATE-20). Mỗi lỗi kèm `index` để tô đúng hàng.
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
      row.hoursBeforeCheckIn,
      index,
      'hoursBeforeCheckIn',
      0,
      Number.MAX_SAFE_INTEGER,
    );
    const refund = parseTierValue(row.refundPercent, index, 'refundPercent', 0, 100);
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

/** Ngoại lệ trả phòng sớm (BR-CANCEL-09) và lý do; bậc kiểm bằng `validateTiers`. */
export function validatePolicyDraft(
  draft: CancellationPolicyDraft,
  policy: CancellationPolicy,
): readonly (FieldIssue | TierIssue)[] {
  const issues: (FieldIssue | TierIssue)[] = [...validateTiers(draft.tiers)];
  const freeHours = parseInteger(draft.earlyCheckoutFreeHours);
  if (freeHours === null || freeHours < 0) {
    issues.push({ field: 'earlyCheckoutFreeHours', issue: 'OUT_OF_RANGE' });
  }
  const refundPct = parseInteger(draft.earlyCheckoutRefundPct);
  if (refundPct === null || refundPct < 0 || refundPct > 100) {
    issues.push({ field: 'earlyCheckoutRefundPct', issue: 'OUT_OF_RANGE' });
  }
  if (draft.reason.trim() === '') issues.push({ field: 'reason', issue: 'REQUIRED' });
  if (issues.length === 0 && !policyChanged(draft, policy, freeHours, refundPct)) {
    issues.push({ field: '(biểu mẫu)', issue: 'UNCHANGED' });
  }
  return issues;
}

/** Bậc và ngoại lệ trả phòng sớm có đổi gì so với bản máy chủ không. */
function policyChanged(
  draft: CancellationPolicyDraft,
  policy: CancellationPolicy,
  freeHours: number | null,
  refundPct: number | null,
): boolean {
  const tiersChanged =
    draft.tiers.length !== policy.tiers.length ||
    draft.tiers.some(
      (row, index) =>
        parseInteger(row.hoursBeforeCheckIn) !== policy.tiers[index]?.hoursBeforeCheckIn ||
        parseInteger(row.refundPercent) !== policy.tiers[index]?.refundPercent,
    );
  return (
    tiersChanged ||
    freeHours !== policy.earlyCheckoutFreeHours ||
    refundPct !== policy.earlyCheckoutRefundPct
  );
}

/** Thân lệnh gửi **toàn bộ** bậc + ngoại lệ trả phòng sớm + lý do (AC4). Không gửi `label`. */
export function policyUpdateRequest(
  draft: CancellationPolicyDraft,
): CancellationPolicyUpdateRequest {
  return {
    tiers: draft.tiers.map((row) => ({
      hoursBeforeCheckIn: parseInteger(row.hoursBeforeCheckIn) ?? 0,
      refundPercent: parseInteger(row.refundPercent) ?? 0,
    })),
    earlyCheckoutFreeHours: parseInteger(draft.earlyCheckoutFreeHours) ?? 0,
    earlyCheckoutRefundPct: parseInteger(draft.earlyCheckoutRefundPct) ?? 0,
    reason: draft.reason.trim(),
  };
}

// ---------------------------------------------------------------------------------------------
// Diff khi 412 (AC6) — chỉ so trường người dùng sửa được; không lộ token/PII.
// ---------------------------------------------------------------------------------------------

export interface DiffRow {
  label: string;
  local: string;
  server: string;
}

export function ratePlanDiff(draft: RatePlanDraft, server: RatePlanAdmin): DiffRow[] {
  return [
    { label: 'depositPercent', local: draft.depositPercent, server: String(server.depositPercent) },
    { label: 'minNights', local: draft.minNights, server: String(server.minNights) },
    { label: 'maxNights', local: draft.maxNights, server: String(server.maxNights) },
    {
      label: 'cancellationPolicyId',
      local: draft.cancellationPolicyId,
      server: server.cancellationPolicyId,
    },
    { label: 'status', local: draft.status, server: server.status },
  ];
}

export function policyDiff(draft: CancellationPolicyDraft, server: CancellationPolicy): DiffRow[] {
  const rows: DiffRow[] = [];
  const count = Math.max(draft.tiers.length, server.tiers.length);
  for (let i = 0; i < count; i += 1) {
    const local = draft.tiers[i];
    const remote = server.tiers[i];
    rows.push({
      label: `tiers[${i}].hoursBeforeCheckIn`,
      local: local?.hoursBeforeCheckIn ?? '—',
      server: remote === undefined ? '—' : String(remote.hoursBeforeCheckIn),
    });
    rows.push({
      label: `tiers[${i}].refundPercent`,
      local: local?.refundPercent ?? '—',
      server: remote === undefined ? '—' : String(remote.refundPercent),
    });
  }
  rows.push({
    label: 'earlyCheckoutFreeHours',
    local: draft.earlyCheckoutFreeHours,
    server: String(server.earlyCheckoutFreeHours),
  });
  rows.push({
    label: 'earlyCheckoutRefundPct',
    local: draft.earlyCheckoutRefundPct,
    server: String(server.earlyCheckoutRefundPct),
  });
  return rows;
}
