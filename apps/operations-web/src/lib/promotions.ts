/**
 * SCR-29 — khuyến mãi (UC-RATE-04, BR-RATE-10,11,13): phần thuần kiểm được bằng vitest.
 * Màn này **cấu hình** mã: giá chạm sàn thì máy chủ chặn bằng `422 E_RATE_BELOW_FLOOR`
 * (khác báo giá trực tuyến — ở đó cùng mã là cảnh báo trong `warnings[]`, api.md §4.2).
 */
import type {
  ChannelCode,
  PromotionCreateRequest,
  PromotionSummary,
  PromotionUpdateRequest,
} from '@pinehill/contracts';
import { reasonIssues } from './config-edit';

export type PromotionType = PromotionSummary['type'];

/** Mã khuyến mãi: chữ/số/`_`/`-`, 3–40 ký tự (khớp `promotionCreateRequestSchema`). */
export const PROMOTION_CODE_PATTERN = /^[A-Z0-9][A-Z0-9_-]{2,39}$/;

/** 7 kênh bán — bản sao giá trị của enum canonical (00 §7.8); frontend không import zod (ADR-018). */
export const CHANNEL_CODES: readonly ChannelCode[] = [
  'WEB',
  'PHONE',
  'WALKIN',
  'OTA_BOOKING',
  'OTA_AGODA',
  'OTA_AIRBNB',
  'AGENCY',
];

export const PROMOTION_TYPES: readonly PromotionType[] = ['PERCENT', 'AMOUNT'];

export interface PromotionDraft {
  code: string;
  type: PromotionType;
  /** Chuỗi để kiểm định dạng trước khi đổi sang số; đơn vị phụ thuộc `type`. */
  value: string;
  minNights: string;
  maxUses: string;
  validFrom: string;
  validTo: string;
  channelScope: readonly ChannelCode[];
  roomTypeScope: readonly string[];
  stackable: boolean;
}

export const EMPTY_PROMOTION_DRAFT: PromotionDraft = {
  code: '',
  type: 'PERCENT',
  value: '',
  minNights: '1',
  maxUses: '',
  validFrom: '',
  validTo: '',
  channelScope: [],
  roomTypeScope: [],
  stackable: false,
};

export interface FieldIssue {
  field: string;
  issue: string;
}

/** Nhãn đơn vị của ô `value` đổi theo `type` (AC3): phần trăm hay tiền VND. */
export function valueUnitKey(
  type: PromotionType,
): 'promotions.value.percent' | 'promotions.value.amount' {
  return type === 'PERCENT' ? 'promotions.value.percent' : 'promotions.value.amount';
}

/** Phần trăm 1–100 (số nguyên); tiền VND nguyên dương (BR-GEN-01). */
export function valueIssue(type: PromotionType, raw: string): FieldIssue | null {
  const trimmed = raw.trim();
  if (!/^\d+$/.test(trimmed)) return { field: 'value', issue: 'NOT_INTEGER' };
  const value = Number.parseInt(trimmed, 10);
  if (value <= 0) return { field: 'value', issue: 'OUT_OF_RANGE' };
  if (type === 'PERCENT' && value > 100) return { field: 'value', issue: 'OUT_OF_RANGE' };
  return null;
}

function requiredIssue(field: string, value: string): FieldIssue | null {
  return value.trim() === '' ? { field, issue: 'REQUIRED' } : null;
}

function positiveIntIssue(field: string, raw: string): FieldIssue | null {
  return /^\d+$/.test(raw.trim()) && Number.parseInt(raw, 10) >= 1
    ? null
    : { field, issue: 'OUT_OF_RANGE' };
}

export function validateDraft(draft: PromotionDraft): readonly FieldIssue[] {
  const issues = [
    requiredIssue('code', draft.code),
    draft.code.trim() !== '' && !PROMOTION_CODE_PATTERN.test(draft.code.trim().toUpperCase())
      ? { field: 'code', issue: 'PATTERN' }
      : null,
    valueIssue(draft.type, draft.value),
    positiveIntIssue('minNights', draft.minNights),
    draft.maxUses.trim() === '' ? null : positiveIntIssue('maxUses', draft.maxUses),
    requiredIssue('validFrom', draft.validFrom),
    requiredIssue('validTo', draft.validTo),
    draft.validFrom !== '' && draft.validTo !== '' && draft.validTo < draft.validFrom
      ? { field: 'validTo', issue: 'BEFORE_START' }
      : null,
    draft.channelScope.length === 0 ? { field: 'channelScope', issue: 'REQUIRED' } : null,
    draft.roomTypeScope.length === 0 ? { field: 'roomTypeScope', issue: 'REQUIRED' } : null,
  ];
  return issues.filter((issue): issue is FieldIssue => issue !== null);
}

/** Đổi `datetime-local` sang ISO UTC trước khi gửi (hợp đồng dùng `isoUtcTimestampSchema`). */
export function toIsoUtc(local: string): string {
  return new Date(local).toISOString();
}

export function toCreateRequest(draft: PromotionDraft): PromotionCreateRequest {
  return {
    code: draft.code.trim().toUpperCase(),
    type: draft.type,
    value: Number.parseInt(draft.value.trim(), 10),
    minNights: Number.parseInt(draft.minNights.trim(), 10),
    channelScope: [...draft.channelScope],
    roomTypeScope: [...draft.roomTypeScope],
    validFrom: toIsoUtc(draft.validFrom),
    validTo: toIsoUtc(draft.validTo),
    ...(draft.maxUses.trim() === '' ? {} : { maxUses: Number.parseInt(draft.maxUses.trim(), 10) }),
    stackable: draft.stackable,
  };
}

/** Bật/tắt một phần tử trong phạm vi (giữ nguyên thứ tự người dùng chọn). */
export function toggle<T>(list: readonly T[], item: T): readonly T[] {
  return list.includes(item) ? list.filter((value) => value !== item) : [...list, item];
}

/** `3/12 · 12/25` cho cột lượt dùng; `maxUses` trống nghĩa là không giới hạn. */
export function usageText(promotion: PromotionSummary): string {
  return `${promotion.usedCount}/${promotion.maxUses ?? '∞'}`;
}

// ---------------------------------------------------------------------------------------------
// HB-311 (TD-08): sửa / tắt sớm / bật lại khuyến mãi qua `PUT /promotions/{id}` (chỉ OWNER).
// `code` và `type` không đổi được (khách và báo giá cũ tham chiếu theo mã).
// ---------------------------------------------------------------------------------------------

export interface PromotionEditDraft {
  value: string;
  minNights: string;
  /** Rỗng = bỏ giới hạn lượt dùng (`maxUses: null`). */
  maxUses: string;
  /** `datetime-local` theo giờ VN. */
  validFrom: string;
  validTo: string;
  channelScope: readonly ChannelCode[];
  roomTypeScope: readonly string[];
  stackable: boolean;
  reason: string;
}

const VN_OFFSET_MS = 7 * 60 * 60 * 1000;

/** ISO UTC → `YYYY-MM-DDTHH:mm` giờ VN (Việt Nam không đổi giờ mùa hè). */
export function toVnLocal(iso: string): string {
  return new Date(Date.parse(iso) + VN_OFFSET_MS).toISOString().slice(0, 16);
}

/** `YYYY-MM-DDTHH:mm` giờ VN → ISO UTC, không phụ thuộc múi giờ của máy đang mở trang. */
export function fromVnLocal(local: string): string {
  return new Date(`${local}:00+07:00`).toISOString();
}

export function promotionEditDraftOf(promotion: PromotionSummary): PromotionEditDraft {
  return {
    value: String(promotion.value),
    minNights: String(promotion.minNights),
    maxUses: promotion.maxUses === null ? '' : String(promotion.maxUses),
    validFrom: toVnLocal(promotion.validFrom),
    validTo: toVnLocal(promotion.validTo),
    channelScope: promotion.channelScope,
    roomTypeScope: promotion.roomTypeScope,
    stackable: promotion.stackable,
    reason: '',
  };
}

export function validatePromotionEdit(
  promotion: PromotionSummary,
  draft: PromotionEditDraft,
): readonly FieldIssue[] {
  const asCreate: PromotionDraft = { ...draft, code: promotion.code, type: promotion.type };
  const maxUses = draft.maxUses.trim();
  const belowUsed =
    /^\d+$/.test(maxUses) && Number.parseInt(maxUses, 10) < promotion.usedCount
      ? [{ field: 'maxUses', issue: 'BELOW_USED' }]
      : [];
  return [...validateDraft(asCreate), ...belowUsed, ...reasonIssues(draft.reason)];
}

function sameSet<T>(a: readonly T[], b: readonly T[]): boolean {
  return a.length === b.length && a.every((item) => b.includes(item));
}

function numbersChanged(promotion: PromotionSummary, draft: PromotionEditDraft) {
  const value = Number.parseInt(draft.value.trim(), 10);
  const minNights = Number.parseInt(draft.minNights.trim(), 10);
  const maxUses = draft.maxUses.trim() === '' ? null : Number.parseInt(draft.maxUses.trim(), 10);
  return {
    ...(value === promotion.value ? {} : { value }),
    ...(minNights === promotion.minNights ? {} : { minNights }),
    ...(maxUses === promotion.maxUses ? {} : { maxUses }),
  };
}

function windowChanged(promotion: PromotionSummary, draft: PromotionEditDraft) {
  const validFrom = fromVnLocal(draft.validFrom);
  const validTo = fromVnLocal(draft.validTo);
  return {
    ...(Date.parse(validFrom) === Date.parse(promotion.validFrom) ? {} : { validFrom }),
    ...(Date.parse(validTo) === Date.parse(promotion.validTo) ? {} : { validTo }),
  };
}

function scopeChanged(promotion: PromotionSummary, draft: PromotionEditDraft) {
  return {
    ...(sameSet(draft.channelScope, promotion.channelScope)
      ? {}
      : { channelScope: [...draft.channelScope] }),
    ...(sameSet(draft.roomTypeScope, promotion.roomTypeScope)
      ? {}
      : { roomTypeScope: [...draft.roomTypeScope] }),
    ...(draft.stackable === promotion.stackable ? {} : { stackable: draft.stackable }),
  };
}

/** Thân `PUT` chỉ gồm trường đổi; `null` khi không đổi gì. */
export function toPromotionUpdate(
  promotion: PromotionSummary,
  draft: PromotionEditDraft,
): PromotionUpdateRequest | null {
  const changes: Omit<PromotionUpdateRequest, 'reason'> = {
    ...numbersChanged(promotion, draft),
    ...windowChanged(promotion, draft),
    ...scopeChanged(promotion, draft),
  };
  if (Object.keys(changes).length === 0) return null;
  return { ...changes, reason: draft.reason.trim() };
}

/** Tắt sớm (mã ngừng nhận lượt mới) hoặc bật lại. */
export function toPromotionToggle(
  promotion: PromotionSummary,
  reason: string,
): PromotionUpdateRequest {
  return { status: promotion.status === 'ACTIVE' ? 'INACTIVE' : 'ACTIVE', reason: reason.trim() };
}
