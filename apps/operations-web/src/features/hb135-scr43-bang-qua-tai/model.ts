/**
 * Phần thuần của SCR-43 (HB-135). Không tính lại hạn, quá hạn, thiếu phòng hay trạng thái ca: chỉ kiểm
 * hình dạng ô lọc/ghi chú, phân loại lỗi theo `code`/HTTP và dựng ý định đóng ca có khoá và `If-Match` ổn định.
 */
import { isApiError, type ApiError } from '@pinehill/api-client';
import type {
  OverbookingCaseStatus,
  OverbookingCaseSummary,
  OverbookingResolveRequest,
  UserMe,
} from '@pinehill/contracts';
import { overbookingResolveRequestSchema } from '@pinehill/contracts';
import { validCalendarDate } from '../../lib/inventory-grid';

export interface FieldIssue {
  field: string;
  issue: string;
}

/** Bảng quyền tường minh theo api.md §6.3 (không kế thừa theo thứ bậc; FRONT_DESK không đọc ca); 403 luôn thắng. */
const RESOLVE_ROLES: readonly UserMe['role'][] = ['MANAGER', 'OWNER'];
export const canResolve = (role: UserMe['role']): boolean => RESOLVE_ROLES.includes(role);

export interface Filter {
  propertyId: string;
  roomTypeId: string;
  status: OverbookingCaseStatus | null;
  dateFrom: string;
  dateTo: string;
  overdueOnly: boolean;
}

export const emptyFilter: Filter = {
  propertyId: '',
  roomTypeId: '',
  status: null,
  dateFrom: '',
  dateTo: '',
  overdueOnly: false,
};

/** Chỉ hình dạng ô lọc: ngày hợp lệ và `dateTo` không trước `dateFrom`; luật lọc do API. */
export function filterIssues(filter: Filter): FieldIssue[] {
  const issues: FieldIssue[] = [];
  if (filter.dateFrom !== '' && !validCalendarDate(filter.dateFrom))
    issues.push({ field: 'dateFrom', issue: 'INVALID_DATE' });
  if (filter.dateTo !== '' && !validCalendarDate(filter.dateTo))
    issues.push({ field: 'dateTo', issue: 'INVALID_DATE' });
  else if (filter.dateFrom !== '' && filter.dateTo !== '' && filter.dateTo < filter.dateFrom)
    issues.push({ field: 'dateTo', issue: 'BEFORE_FROM' });
  return issues;
}

export function resolveIssues(note: string): FieldIssue[] {
  const trimmed = note.trim();
  if (trimmed === '') return [{ field: 'resolutionNote', issue: 'REQUIRED' }];
  return trimmed.length > 500 ? [{ field: 'resolutionNote', issue: 'TOO_LONG' }] : [];
}

export const resolveRequest = (note: string): OverbookingResolveRequest =>
  overbookingResolveRequestSchema.parse({ resolutionNote: note.trim() });

/** `If-Match` từ phiên bản của dòng đã đọc (api.md §1.3: `"<version>"`); không tự đoán phiên bản mới. */
export const tagOf = (row: OverbookingCaseSummary): string => `"${row.version}"`;

/** Ý định ghi: giữ nguyên `key`, thân và `If-Match` cho mọi lần gửi lại (api.md §1.6). */
export interface Intent {
  caseId: string;
  body: OverbookingResolveRequest;
  ifMatch: string;
  key: string;
  createdAt: number;
}

export const sameIntent = (a: Intent, b: Intent): boolean =>
  JSON.stringify([a.caseId, a.body, a.ifMatch]) === JSON.stringify([b.caseId, b.body, b.ifMatch]);

/** Khoá idempotency chỉ sống 24 giờ: quá hạn thì tra kết quả, không gửi lại mù. */
export const KEY_TTL_MS = 24 * 60 * 60 * 1000;
export const keyExpired = (intent: Intent, now: number): boolean =>
  now - intent.createdAt >= KEY_TTL_MS;

/** "Không có ca" chỉ đáng tin khi lượt quét gần nhất thành công và có mốc (AC3); còn lại là chưa xác định. */
export function emptyConfirmed(scan: {
  scanStatus: string;
  lastSuccessfulScanAt: string | null;
}): boolean {
  return scan.scanStatus === 'OK' && scan.lastSuccessfulScanAt !== null;
}

export type Failure =
  | { kind: 'validation'; issues: FieldIssue[] }
  | { kind: 'conflict' }
  | { kind: 'deadlinePassed' }
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
  ['E_SYS_IDEMPOTENCY_KEY_REUSED', { kind: 'keyReused' }],
  ['E_OVER_CASE_DEADLINE_PASSED', { kind: 'deadlinePassed' }],
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
