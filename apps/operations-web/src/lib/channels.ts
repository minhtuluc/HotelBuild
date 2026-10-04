/**
 * SCR-28 — kênh: hệ số & hoa hồng (UC-RATE-03, BR-RATE-07,09,18): phần thuần kiểm được bằng vitest.
 * Ngưỡng sàn `1/(1 − hoa hồng)` và các cảnh báo ở đây **chỉ để nhắc**; máy chủ (HB-055) là nơi chặn.
 */
import type { ChannelSummary, ChannelUpdateRequest } from '@pinehill/contracts';

/** Kênh ngoài phạm vi quy tắc sàn (BR-RATE-07): giá theo cam kết sản lượng. */
export const AGENCY_CHANNEL = 'AGENCY';

/** Kênh trực tiếp (BR-RATE-09): hệ số < 1,00 phải sinh cảnh báo. */
export const DIRECT_CHANNELS: readonly ChannelSummary['code'][] = ['WEB', 'PHONE', 'WALKIN'];

export type ChannelWarning = 'belowFloor' | 'directBelowOne';

/**
 * Ngưỡng sàn `1 / (1 − hoa hồng)`. Trả `null` khi hoa hồng ≥ 100% (chia 0) — màn hình chặn tại chỗ.
 * Giá trị dùng để **so sánh** là số gốc, không dùng số đã làm tròn để hiển thị.
 */
export function floorMultiplier(commissionPct: number): number | null {
  if (commissionPct >= 100) return null;
  return 1 / (1 - commissionPct / 100);
}

/** Cảnh báo của một kênh theo dữ liệu máy chủ trả; `AGENCY` được miễn quy tắc sàn. */
export function channelWarnings(channel: {
  code: ChannelSummary['code'];
  multiplier: number;
  commissionPct: number;
}): readonly ChannelWarning[] {
  const warnings: ChannelWarning[] = [];
  if (channel.code !== AGENCY_CHANNEL) {
    const floor = floorMultiplier(channel.commissionPct);
    if (floor !== null && channel.multiplier < floor) warnings.push('belowFloor');
  }
  if (DIRECT_CHANNELS.includes(channel.code) && channel.multiplier < 1) {
    warnings.push('directBelowOne');
  }
  return warnings;
}

export interface ChannelDraft {
  multiplier: string;
  commissionPct: string;
  holdMinutes: string;
  overbookAllowed: boolean;
  reason: string;
}

export function draftOf(channel: ChannelSummary): ChannelDraft {
  return {
    multiplier: String(channel.multiplier),
    commissionPct: String(channel.commissionPct),
    holdMinutes: String(channel.holdMinutes),
    overbookAllowed: channel.overbookAllowed,
    reason: '',
  };
}

export interface FieldIssue {
  field: string;
  issue: string;
}

function parseNumber(value: string): number | null {
  const parsed = Number(value.trim().replace(',', '.'));
  return Number.isFinite(parsed) ? parsed : null;
}

/** Kiểm một trường số trong khoảng; `integer` bắt buộc số nguyên. */
function rangeIssue(
  field: string,
  value: string,
  min: number,
  max: number,
  integer = false,
): FieldIssue | null {
  const parsed = parseNumber(value);
  const invalid =
    parsed === null || parsed < min || parsed > max || (integer && !Number.isInteger(parsed));
  return invalid ? { field, issue: 'OUT_OF_RANGE' } : null;
}

/** Hoa hồng 100% làm công thức sàn chia 0 nên chặn ngay tại giao diện. */
function commissionIssue(field: string, value: string): FieldIssue | null {
  const parsed = parseNumber(value);
  return parsed === null || parsed < 0 || parsed >= 100 ? { field, issue: 'OUT_OF_RANGE' } : null;
}

function collect(issues: readonly (FieldIssue | null)[]): readonly FieldIssue[] {
  return issues.filter((issue): issue is FieldIssue => issue !== null);
}

/** Chặn tại chỗ: hệ số 0,1–5, hoa hồng 0–99,9 (100% làm công thức sàn chia 0), hold 0–1440, lý do. */
export function validateDraft(draft: ChannelDraft): readonly FieldIssue[] {
  return collect([
    rangeIssue('multiplier', draft.multiplier, 0.1, 5),
    commissionIssue('commissionPct', draft.commissionPct),
    rangeIssue('holdMinutes', draft.holdMinutes, 0, 1440, true),
    draft.reason.trim() === '' ? { field: 'reason', issue: 'REQUIRED' } : null,
  ]);
}

/** Chỉ gửi trường **thực sự đổi** (cộng `reason`) — PATCH giữ nguyên phần còn lại. */
export function changedFields(draft: ChannelDraft, channel: ChannelSummary): ChannelUpdateRequest {
  const input: ChannelUpdateRequest = { reason: draft.reason.trim() };
  const multiplier = parseNumber(draft.multiplier);
  const commission = parseNumber(draft.commissionPct);
  const hold = parseNumber(draft.holdMinutes);
  if (multiplier !== null && multiplier !== channel.multiplier) input.multiplier = multiplier;
  if (commission !== null && commission !== channel.commissionPct) {
    input.commissionPct = commission;
  }
  if (hold !== null && hold !== channel.holdMinutes) input.holdMinutes = hold;
  if (draft.overbookAllowed !== channel.overbookAllowed) {
    input.overbookAllowed = draft.overbookAllowed;
  }
  return input;
}

export interface OverrideDraft {
  propertyId: string;
  multiplier: string;
  commissionPct: string;
  effectiveFrom: string;
}

export const EMPTY_OVERRIDE_DRAFT: OverrideDraft = {
  propertyId: '',
  multiplier: '',
  commissionPct: '',
  effectiveFrom: '',
};

/** Ghi đè theo cơ sở là **dòng mới** có `effectiveFrom`; để trống thì bỏ hẳn trường đó. */
export function validateOverride(draft: OverrideDraft): readonly FieldIssue[] {
  const multiplierGiven = draft.multiplier.trim() !== '';
  const commissionGiven = draft.commissionPct.trim() !== '';
  return collect([
    draft.propertyId === '' ? { field: 'propertyId', issue: 'REQUIRED' } : null,
    draft.effectiveFrom === '' ? { field: 'effectiveFrom', issue: 'REQUIRED' } : null,
    multiplierGiven ? rangeIssue('multiplier', draft.multiplier, 0.1, 5) : null,
    commissionGiven ? commissionIssue('commissionPct', draft.commissionPct) : null,
    multiplierGiven || commissionGiven
      ? null
      : { field: 'multiplier', issue: 'NOTHING_TO_OVERRIDE' },
  ]);
}

/** Thân lệnh thêm dòng ghi đè: gửi kèm `reason`, chỉ trường đã khai. */
export function overrideUpdateRequest(draft: OverrideDraft, reason: string): ChannelUpdateRequest {
  const multiplier = draft.multiplier.trim() === '' ? null : parseNumber(draft.multiplier);
  const commission = draft.commissionPct.trim() === '' ? null : parseNumber(draft.commissionPct);
  return {
    reason,
    propertyOverrides: [
      {
        propertyId: draft.propertyId,
        effectiveFrom: draft.effectiveFrom,
        ...(multiplier === null ? {} : { multiplier }),
        ...(commission === null ? {} : { commissionPct: commission }),
      },
    ],
  };
}

/** Mã ETag từ `version` của kênh (api.md §1.3: `"7"`), dùng cho `If-Match` khi lưu. */
export function ifMatchOf(version: number): string {
  return `"${version}"`;
}
