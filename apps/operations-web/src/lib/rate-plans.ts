/**
 * SCR-70 — gói giá & chính sách huỷ (UC-RATE-06, BR-CANCEL-01,02,09, BR-RATE-16,20): phần thuần kiểm
 * được bằng vitest. Bậc là **dữ liệu** (BR-CANCEL-01) — không hard-code mốc giờ; mọi quy tắc ở đây chỉ
 * để chặn lưu **tại chỗ**, máy chủ (HB-057) là nơi chặn cuối và trả `E_RATE_CONFIGURATION_INVALID`.
 */
import type {
  CancellationPolicy,
  CancellationPolicyUpdateRequest,
  RatePlanAdmin,
  RatePlanUpdateRequest,
} from '@pinehill/contracts';

import {
  intInRange,
  parseInteger,
  tierRowOf,
  tierOffset,
  wireOffset,
  tierRequest,
  validateTiers,
  type TierRow,
  type TierIssue,
} from './rate-policy-tiers';
import { FORM_WIDE_FIELD } from './screen-state';
export {
  MAX_TIERS,
  CATCH_ALL_HOURS,
  tierIndexFromField,
  tierRowOf,
  validateTiers,
  type TierRow,
  type TierIssue,
} from './rate-policy-tiers';

export interface FieldIssue {
  field: string;
  issue: string;
}

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
    reasonIssue(draft.reason),
  ]);
  if (issues.length === 0 && !ratePlanChanged(draft, plan)) {
    issues.push({ field: FORM_WIDE_FIELD, issue: 'UNCHANGED' });
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

export interface CancellationPolicyDraft {
  id: string;
  tiers: TierRow[];
  earlyCheckoutFreeHours: string;
  earlyCheckoutRefundPct: string;
  version: number;
  reason: string;
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

/** Ngoại lệ trả phòng sớm (BR-CANCEL-09) và lý do; bậc kiểm bằng `validateTiers`. */
export function validatePolicyDraft(
  draft: CancellationPolicyDraft,
  policy: CancellationPolicy,
): readonly (FieldIssue | TierIssue)[] {
  const issues: (FieldIssue | TierIssue)[] = [...validateTiers(draft.tiers)];
  const freeHours = parseInteger(draft.earlyCheckoutFreeHours),
    refundPct = parseInteger(draft.earlyCheckoutRefundPct);
  issues.push(...earlyIssues(draft));
  const reason = reasonIssue(draft.reason);
  if (reason) issues.push(reason);
  if (issues.length === 0 && !policyChanged(draft, policy, freeHours, refundPct)) {
    issues.push({ field: FORM_WIDE_FIELD, issue: 'UNCHANGED' });
  }
  return issues;
}

function earlyIssues(draft: CancellationPolicyDraft): FieldIssue[] {
  const issues: FieldIssue[] = [];
  const freeHours = parseInteger(draft.earlyCheckoutFreeHours);
  if (freeHours === null || freeHours < 0 || freeHours > 32767) {
    issues.push({ field: 'earlyCheckoutFreeHours', issue: 'OUT_OF_RANGE' });
  }
  const refundPct = parseInteger(draft.earlyCheckoutRefundPct);
  if (refundPct === null || refundPct < 0 || refundPct > 100) {
    issues.push({ field: 'earlyCheckoutRefundPct', issue: 'OUT_OF_RANGE' });
  }
  if (freeHours === 0 && refundPct !== 0)
    issues.push({ field: 'earlyCheckoutRefundPct', issue: 'REFUND_WITHOUT_THRESHOLD' });
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
        tierOffset(row) !== (policy.tiers[index] ? wireOffset(policy.tiers[index]!) : undefined) ||
        (row.chargeFirstNight ?? false) !== (policy.tiers[index]?.chargeFirstNight ?? false) ||
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
  const free = intInRange(draft.earlyCheckoutFreeHours, 0, 32767),
    pct = intInRange(draft.earlyCheckoutRefundPct, 0, 100);
  if (
    validateTiers(draft.tiers).length ||
    free === null ||
    pct === null ||
    (free === 0 && pct !== 0) ||
    !draft.reason.trim() ||
    draft.reason.trim().length > 500
  )
    throw Error('Invalid policy draft');
  return {
    tiers: draft.tiers.map(tierRequest),
    earlyCheckoutFreeHours: free,
    earlyCheckoutRefundPct: pct,
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
    rows.push(...tierDiff(local, remote, i));
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

function tierDiff(
  local: TierRow | undefined,
  remote: import('@pinehill/contracts').CancellationTier | undefined,
  i: number,
): DiffRow[] {
  const rows: DiffRow[] = [];
  rows.push({
    label: `tiers[${i}].offsetHours`,
    local: localOffset(local),
    server: remoteOffset(remote),
  });
  rows.push({
    label: `tiers[${i}].chargeFirstNight`,
    local: localFlag(local),
    server: remoteFlag(remote),
  });
  rows.push({
    label: `tiers[${i}].refundPercent`,
    local: local?.refundPercent ?? '—',
    server: remote === undefined ? '—' : String(remote.refundPercent),
  });
  return rows;
}

function localOffset(row: TierRow | undefined): string {
  return row ? String(tierOffset(row)) : '—';
}
function remoteOffset(row: import('@pinehill/contracts').CancellationTier | undefined): string {
  return row ? String(wireOffset(row)) : '—';
}
function localFlag(row: TierRow | undefined): string {
  return row ? String(row.chargeFirstNight ?? false) : '—';
}
function remoteFlag(row: import('@pinehill/contracts').CancellationTier | undefined): string {
  return row ? String(row.chargeFirstNight ?? false) : '—';
}

function reasonIssue(reason: string): FieldIssue | null {
  if (!reason.trim()) return { field: 'reason', issue: 'REQUIRED' };
  return reason.trim().length > 500 ? { field: 'reason', issue: 'TOO_LONG' } : null;
}
