/**
 * Phần thuần của SCR-41 (HB-133). Không đếm lỗi, không đặt DEGRADED, không tính lại mốc đồng bộ: chỉ
 * kiểm hình dạng ô nhập, phân loại lỗi theo `code`/HTTP và dựng ý định ghi có khoá ổn định.
 */
import { isApiError, type ApiError } from '@pinehill/api-client';
import {
  channelSyncRequestSchema,
  type ChannelSyncRequest,
  type OperationStatusView,
  type UserMe,
} from '@pinehill/contracts';
import { validCalendarDate } from '../../lib/inventory-grid';

export interface FieldIssue {
  field: string;
  issue: string;
}

/** Bảng quyền tường minh theo api.md §6.3 (không kế thừa theo thứ bậc); 403 của máy chủ luôn thắng. */
const SYNC_ROLES: readonly UserMe['role'][] = ['MANAGER', 'OWNER'];
export const canSync = (role: UserMe['role']): boolean => SYNC_ROLES.includes(role);

export interface SyncDraft {
  scope: 'FULL' | 'RANGE';
  from: string;
  to: string;
}

export const emptySync = (date: string): SyncDraft => ({ scope: 'FULL', from: date, to: date });

export function syncIssues(draft: SyncDraft): FieldIssue[] {
  if (draft.scope === 'FULL') return [];
  const issues: FieldIssue[] = [];
  if (!validCalendarDate(draft.from)) issues.push({ field: 'from', issue: 'INVALID_DATE' });
  if (!validCalendarDate(draft.to)) issues.push({ field: 'to', issue: 'INVALID_DATE' });
  else if (validCalendarDate(draft.from) && draft.to < draft.from)
    issues.push({ field: 'to', issue: 'BEFORE_FROM' });
  return issues;
}

export function syncRequest(draft: SyncDraft): ChannelSyncRequest {
  return channelSyncRequestSchema.parse(
    draft.scope === 'FULL' ? { scope: 'FULL' } : { scope: 'RANGE', from: draft.from, to: draft.to },
  );
}

/** Ý định ghi: giữ nguyên `key` và thân cho mọi lần gửi lại (api.md §1.6); cả hai lệnh không có If-Match. */
export type Intent =
  | { kind: 'sync'; channelId: string; body: ChannelSyncRequest; key: string; createdAt: number }
  | { kind: 'retry'; channelId: string; deliveryId: string; key: string; createdAt: number };

export function sameIntent(a: Intent, b: Intent): boolean {
  const view = (value: Intent) =>
    JSON.stringify(
      value.kind === 'sync'
        ? [value.kind, value.channelId, value.body]
        : [value.kind, value.channelId, value.deliveryId],
    );
  return view(a) === view(b);
}

/** Khoá idempotency chỉ sống 24 giờ: quá hạn thì tra kết quả, không gửi lại mù. */
export const KEY_TTL_MS = 24 * 60 * 60 * 1000;
export const keyExpired = (intent: Intent, now: number): boolean =>
  now - intent.createdAt >= KEY_TTL_MS;

export const isTerminal = (status: OperationStatusView['status']): boolean =>
  status === 'SUCCEEDED' || status === 'FAILED';

export type Failure =
  | { kind: 'validation'; issues: FieldIssue[] }
  | { kind: 'syncFailed' }
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
  ['E_CHAN_SYNC_FAILED', { kind: 'syncFailed' }],
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
