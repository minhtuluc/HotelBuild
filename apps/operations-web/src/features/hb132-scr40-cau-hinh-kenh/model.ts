/**
 * Phần thuần của SCR-40 (HB-132). Không tính lại tiền/hạn mức/trần; chỉ kiểm hình dạng ô nhập, phân
 * loại lỗi theo `code`/HTTP (không theo `message`) và dựng chuỗi hiển thị từ số do máy chủ trả.
 */
import { isApiError, type ApiError } from '@pinehill/api-client';
import {
  channelMappingPutRequestSchema,
  salesClosureRequestSchema,
  type ChannelMappingPutRequest,
  type SalesClosureRequest,
  type SalesClosureRow,
  type UserMe,
} from '@pinehill/contracts';
import { validCalendarDate } from '../../lib/inventory-grid';

export interface FieldIssue {
  field: string;
  issue: string;
}

/**
 * Bảng quyền hiển thị theo api.md §6.3, **liệt kê tường minh** (OWNER không mặc nhiên có quyền của
 * MANAGER và ngược lại). Chỉ quyết định nút nào hiện; 403 của máy chủ luôn thắng (fail closed).
 */
const MAPPING_ROLES: readonly UserMe['role'][] = ['OWNER'];
const CLOSURE_ROLES: readonly UserMe['role'][] = ['MANAGER', 'OWNER'];
export const canMap = (role: UserMe['role']): boolean => MAPPING_ROLES.includes(role);
export const canClose = (role: UserMe['role']): boolean => CLOSURE_ROLES.includes(role);

export interface MappingDraft {
  roomTypeId: string;
  providerRoomTypeCode: string;
  allotmentPct: string;
  externalRatePlanCode: string;
  status: 'ACTIVE' | 'INACTIVE';
}

export interface ClosureDraft {
  roomTypeId: string;
  from: string;
  to: string;
  reason: string;
  closed: boolean;
}

export const emptyMapping = (roomTypeId: string): MappingDraft => ({
  roomTypeId,
  providerRoomTypeCode: '',
  allotmentPct: '',
  externalRatePlanCode: '',
  status: 'ACTIVE',
});

export const emptyClosure = (roomTypeId: string, date: string): ClosureDraft => ({
  roomTypeId,
  from: date,
  to: date,
  reason: '',
  closed: true,
});

function pctOf(value: string): number | null {
  const trimmed = value.trim();
  if (!/^\d{1,3}$/.test(trimmed)) return null;
  const parsed = Number(trimmed);
  return parsed >= 0 && parsed <= 100 ? parsed : null;
}

/** Chỉ hình dạng ô nhập: luật hạn mức/trần vẫn do API kiểm. */
export function mappingIssues(draft: MappingDraft): FieldIssue[] {
  const issues: FieldIssue[] = [];
  const code = draft.providerRoomTypeCode.trim();
  if (draft.roomTypeId === '') issues.push({ field: 'roomTypeId', issue: 'REQUIRED' });
  if (code === '') issues.push({ field: 'providerRoomTypeCode', issue: 'REQUIRED' });
  else if (code.length > 64) issues.push({ field: 'providerRoomTypeCode', issue: 'TOO_LONG' });
  if (pctOf(draft.allotmentPct) === null)
    issues.push({ field: 'allotmentPct', issue: 'PCT_RANGE' });
  if (draft.externalRatePlanCode.trim().length > 64)
    issues.push({ field: 'externalRatePlanCode', issue: 'TOO_LONG' });
  return issues;
}

/** Thân lệnh PUT; gọi sau khi `mappingIssues` rỗng. Trường tuỳ chọn trống thì bỏ hẳn. */
export function mappingRequest(draft: MappingDraft): ChannelMappingPutRequest {
  const rate = draft.externalRatePlanCode.trim();
  return channelMappingPutRequestSchema.parse({
    roomTypeId: draft.roomTypeId,
    providerRoomTypeCode: draft.providerRoomTypeCode.trim(),
    allotmentPct: pctOf(draft.allotmentPct),
    status: draft.status,
    ...(rate === '' ? {} : { externalRatePlanCode: rate }),
  });
}

export function closureIssues(draft: ClosureDraft): FieldIssue[] {
  const issues: FieldIssue[] = [];
  if (draft.roomTypeId === '') issues.push({ field: 'roomTypeId', issue: 'REQUIRED' });
  if (!validCalendarDate(draft.from)) issues.push({ field: 'from', issue: 'INVALID_DATE' });
  if (!validCalendarDate(draft.to)) issues.push({ field: 'to', issue: 'INVALID_DATE' });
  else if (validCalendarDate(draft.from) && draft.to < draft.from)
    issues.push({ field: 'to', issue: 'BEFORE_FROM' });
  const reason = draft.reason.trim();
  if (reason === '') issues.push({ field: 'reason', issue: 'REQUIRED' });
  else if (reason.length > 500) issues.push({ field: 'reason', issue: 'TOO_LONG' });
  return issues;
}

export function closureRequest(draft: ClosureDraft): SalesClosureRequest {
  return salesClosureRequestSchema.parse({
    roomTypeId: draft.roomTypeId,
    from: draft.from,
    to: draft.to,
    reason: draft.reason.trim(),
    closed: draft.closed,
  });
}

/** Ý định ghi: giữ nguyên `key`, thân và `ifMatch` cho mọi lần gửi lại (api.md §1.6). */
export type Intent =
  | {
      kind: 'mapping';
      channelId: string;
      body: ChannelMappingPutRequest;
      ifMatch: string | undefined;
      key: string;
      createdAt: number;
    }
  | {
      kind: 'closure';
      channelId: string;
      body: SalesClosureRequest;
      key: string;
      createdAt: number;
    };

/** Cùng ý định = cùng loại, kênh, thân và `If-Match` (khoá và thời điểm tạo không tham gia). */
export function sameIntent(a: Intent, b: Intent): boolean {
  const view = (value: Intent) =>
    JSON.stringify([
      value.kind,
      value.channelId,
      value.body,
      value.kind === 'mapping' ? value.ifMatch : null,
    ]);
  return view(a) === view(b);
}

/** Khoá idempotency chỉ sống 24 giờ (api.md §1.6): quá hạn thì tra kết quả, không gửi lại mù. */
export const KEY_TTL_MS = 24 * 60 * 60 * 1000;
export const keyExpired = (intent: Intent, now: number): boolean =>
  now - intent.createdAt >= KEY_TTL_MS;

export type Failure =
  | { kind: 'validation'; issues: FieldIssue[] }
  | { kind: 'overLimit' }
  | { kind: 'conflict' }
  | { kind: 'inProgress'; retryAfterSeconds: number }
  | { kind: 'keyReused' }
  | { kind: 'forbidden' }
  | { kind: 'expired' }
  | { kind: 'rejected' }
  | { kind: 'unknown' }
  | { kind: 'ttl' }
  | { kind: 'aborted' };

const DEFAULT_RETRY_SECONDS = 5;
const UNKNOWN: Failure = { kind: 'unknown' };
const AUTH = new Map<number, Failure>([
  [401, { kind: 'expired' }],
  [403, { kind: 'forbidden' }],
]);
const PRECONDITION = new Map<number, Failure>([
  [412, { kind: 'conflict' }],
  [428, { kind: 'conflict' }],
]);
const BY_CODE = new Map<string, Failure>([
  ['E_OVER_LIMIT_EXCEEDED', { kind: 'overLimit' }],
  ['E_SYS_IDEMPOTENCY_KEY_REUSED', { kind: 'keyReused' }],
]);

function inProgress(error: ApiError): Failure | undefined {
  if (error.code !== 'E_SYS_REQUEST_IN_PROGRESS' && error.status !== 429) return undefined;
  return {
    kind: 'inProgress',
    retryAfterSeconds: error.retryAfterSeconds ?? DEFAULT_RETRY_SECONDS,
  };
}

function invalid(error: ApiError): Failure | undefined {
  if (error.status !== 400 && error.status !== 422) return undefined;
  const issues = error.details ?? [];
  return {
    kind: 'validation',
    issues: issues.length > 0 ? issues : [{ field: 'form', issue: error.code ?? 'REJECTED' }],
  };
}

function httpFailure(error: ApiError): Failure {
  const status = error.status ?? 0;
  const known =
    AUTH.get(status) ??
    BY_CODE.get(error.code ?? '') ??
    PRECONDITION.get(status) ??
    inProgress(error) ??
    invalid(error);
  if (known !== undefined) return known;
  return status >= 400 && status < 500 ? { kind: 'rejected' } : UNKNOWN;
}

/**
 * Phân loại lỗi **chỉ theo `code` và lớp HTTP**. Mọi thứ không chắc là đã bị từ chối (mạng, timeout,
 * 5xx, phản hồi sai hợp đồng) là `unknown`: không bao giờ báo "thất bại chắc chắn" rồi cho gửi mới.
 */
export function classify(error: unknown): Failure {
  if (!isApiError(error)) return UNKNOWN;
  if (error.kind === 'aborted') return { kind: 'aborted' };
  return error.kind === 'http' ? httpFailure(error) : UNKNOWN;
}

/** Bằng chứng an toàn: mã lỗi, HTTP và traceId. Không có thân lệnh, tiêu đề hay token. */
export interface Evidence {
  code?: string;
  status?: number;
  traceId?: string;
}

export function evidenceOf(error: unknown): Evidence {
  if (!isApiError(error)) return {};
  return {
    ...(error.code === undefined ? {} : { code: error.code }),
    ...(error.status === undefined ? {} : { status: error.status }),
    ...(error.traceId === undefined ? {} : { traceId: error.traceId }),
  };
}

export type Cell = {
  closed: boolean;
  reason: string | null;
  closedAt: string | null;
  reopenedAt: string | null;
};

/** Ba cột hiển thị riêng thủ công/tự động/hiệu lực — toàn bộ lấy từ response, không suy cục bộ. */
export function closureCells(row: SalesClosureRow): {
  effective: { closed: boolean; source: 'MANUAL' | 'AUTOMATIC' | null };
  manual: Cell;
  automatic: Cell;
} {
  return {
    effective: { closed: row.closed, source: row.closureSource },
    manual: row.manual,
    automatic: row.automatic,
  };
}
