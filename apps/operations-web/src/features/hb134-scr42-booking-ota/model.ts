/**
 * Phần thuần của SCR-42 (HB-134). Không tính lại trạng thái, tiền hay chính sách: chỉ kiểm hình dạng ô
 * lọc/lý do, phân loại lỗi theo `code`/HTTP và dựng ý định gắn cờ nghi trùng có khoá và `If-Match` ổn định.
 */
import { isApiError, type ApiError } from '@pinehill/api-client';
import {
  otaBookingFlagRequestSchema,
  type OtaBooking,
  type OtaBookingFlagRequest,
  type UserMe,
} from '@pinehill/contracts';
import { validCalendarDate } from '../../lib/inventory-grid';

export interface FieldIssue {
  field: string;
  issue: string;
}

/** Bảng quyền tường minh theo api.md §6.3 (không kế thừa theo thứ bậc); 403 của máy chủ luôn thắng. */
const FLAG_ROLES: readonly UserMe['role'][] = ['MANAGER', 'OWNER'];
export const canFlag = (role: UserMe['role']): boolean => FLAG_ROLES.includes(role);

export interface Filter {
  status: OtaBooking['status'] | null;
  q: string;
  from: string;
  to: string;
}

export const emptyFilter: Filter = { status: null, q: '', from: '', to: '' };

/** Chỉ hình dạng ô lọc: ngày hợp lệ và `to` không trước `from`; luật lọc do API. */
export function filterIssues(filter: Filter): FieldIssue[] {
  const issues: FieldIssue[] = [];
  if (filter.from !== '' && !validCalendarDate(filter.from))
    issues.push({ field: 'from', issue: 'INVALID_DATE' });
  if (filter.to !== '' && !validCalendarDate(filter.to))
    issues.push({ field: 'to', issue: 'INVALID_DATE' });
  else if (filter.from !== '' && filter.to !== '' && filter.to < filter.from)
    issues.push({ field: 'to', issue: 'BEFORE_FROM' });
  return issues;
}

export interface FlagDraft {
  flagged: boolean;
  reason: string;
}

export function flagIssues(draft: FlagDraft): FieldIssue[] {
  const reason = draft.reason.trim();
  if (reason === '') return [{ field: 'reason', issue: 'REQUIRED' }];
  return reason.length > 500 ? [{ field: 'reason', issue: 'TOO_LONG' }] : [];
}

export function flagRequest(draft: FlagDraft): OtaBookingFlagRequest {
  return otaBookingFlagRequestSchema.parse({ flagged: draft.flagged, reason: draft.reason.trim() });
}

/** `If-Match` từ phiên bản của dòng đã đọc (api.md §1.3: `"<version>"`); không tự đoán phiên bản mới. */
export const tagOf = (booking: OtaBooking): string => `"${booking.version}"`;

/** Ý định ghi: giữ nguyên `key`, thân và `If-Match` cho mọi lần gửi lại (api.md §1.6). */
export interface Intent {
  channelId: string;
  bookingId: string;
  body: OtaBookingFlagRequest;
  ifMatch: string;
  key: string;
  createdAt: number;
}

export const sameIntent = (a: Intent, b: Intent): boolean =>
  JSON.stringify([a.channelId, a.bookingId, a.body, a.ifMatch]) ===
  JSON.stringify([b.channelId, b.bookingId, b.body, b.ifMatch]);

/** Khoá idempotency chỉ sống 24 giờ: quá hạn thì tra kết quả, không gửi lại mù. */
export const KEY_TTL_MS = 24 * 60 * 60 * 1000;
export const keyExpired = (intent: Intent, now: number): boolean =>
  now - intent.createdAt >= KEY_TTL_MS;

export type Failure =
  | { kind: 'validation'; issues: FieldIssue[] }
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
const BY_CODE = new Map<string, Failure>([['E_SYS_IDEMPOTENCY_KEY_REUSED', { kind: 'keyReused' }]]);

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
 * Phân loại lỗi **chỉ theo `code` và lớp HTTP**. Mạng, timeout, 5xx và phản hồi sai hợp đồng là
 * `unknown`: không bao giờ báo "thất bại chắc chắn" rồi cho tạo lệnh mới.
 */
export function classify(error: unknown): Failure {
  if (!isApiError(error)) return UNKNOWN;
  if (error.kind === 'aborted') return { kind: 'aborted' };
  return error.kind === 'http' ? httpFailure(error) : UNKNOWN;
}

/** Bằng chứng an toàn: mã lỗi, HTTP và traceId. Không có thân lệnh, tiêu đề, token hay `message`. */
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
