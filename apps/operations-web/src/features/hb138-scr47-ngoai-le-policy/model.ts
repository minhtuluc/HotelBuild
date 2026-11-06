/**
 * Phần thuần của SCR-47 (HB-138). Không tính hoàn tiền, phí hay bậc chính sách; không đổi `requestedAmount`
 * hay `approvedAmount`: chỉ kiểm hình dạng ô nhập, phân loại lỗi theo `code`/HTTP và dựng ý định ghi ổn định.
 */
import { isApiError, type ApiError } from '@pinehill/api-client';
import {
  refundApproveRequestSchema,
  refundRejectRequestSchema,
  refundRequestCreateRequestSchema,
  type RefundApproveRequest,
  type RefundRejectRequest,
  type RefundRequest,
  type RefundRequestCreateRequest,
  type UserMe,
} from '@pinehill/contracts';

export interface FieldIssue {
  field: string;
  issue: string;
}

type Role = UserMe['role'];

/**
 * Chỉ MANAGER/OWNER lập, duyệt, từ chối ngoại lệ; liệt kê tường minh, không kế thừa. FRONT_DESK và ACCOUNTANT
 * không được tải hồ sơ ở màn này (kế toán chi qua luồng hoàn tiền F5). 403 của máy chủ luôn thắng.
 */
const DECIDE_ROLES: readonly Role[] = ['MANAGER', 'OWNER'];
export const canDecide = (role: Role): boolean => DECIDE_ROLES.includes(role);

/** Duyệt/từ chối chỉ khi hồ sơ còn PENDING và **khác** người lập (BR-CANCEL-15); máy chủ vẫn kiểm lại. */
export const canAct = (role: Role, userId: string, row: RefundRequest): boolean =>
  canDecide(role) && row.status === 'PENDING' && row.requestedBy !== userId;

export interface Filter {
  propertyId: string;
  status: RefundRequest['status'] | null;
  bookingId: string;
  forceOnly: boolean;
}

export const emptyFilter: Filter = { propertyId: '', status: null, bookingId: '', forceOnly: true };

/** Ô lọc "chỉ bất khả kháng" là lọc hiển thị trên các dòng đã tải, không phải điều kiện của API. */
export const visibleRows = (
  rows: readonly RefundRequest[],
  filter: Filter,
): readonly RefundRequest[] => (filter.forceOnly ? rows.filter((row) => row.isForceMajeure) : rows);

/** Chỉ hình dạng ô lọc: mã booking không chứa khoảng trắng giữa chừng; luật lọc do API. */
export function filterIssues(filter: Filter): FieldIssue[] {
  return /\s/.test(filter.bookingId.trim()) ? [{ field: 'bookingId', issue: 'REQUIRED' }] : [];
}

const fileId = /^[A-Za-z0-9_-]{4,128}$/;
export const MIN_NOTE = 20;

/** Đếm theo ký tự Unicode (không theo đơn vị UTF-16) cho giới hạn lý do. */
export const charCount = (value: string): number => Array.from(value.trim()).length;

const splitRefs = (value: string): string[] =>
  value
    .split(',')
    .map((item) => item.trim())
    .filter((item) => item !== '');

export interface CreateDraft {
  bookingId: string;
  paymentId: string;
  reason: 'FORCE_MAJEURE' | 'HOTEL_RELOCATION' | 'OTA_CANCELLATION';
  note: string;
  evidence: string;
}

export const emptyCreate: CreateDraft = {
  bookingId: '',
  paymentId: '',
  reason: 'FORCE_MAJEURE',
  note: '',
  evidence: '',
};

/** Chỉ hình dạng: đủ mã, lý do ≥ 20 ký tự, minh chứng là mã tệp; điều kiện nghiệp vụ do API kiểm. */
export function createIssues(draft: CreateDraft): FieldIssue[] {
  const issues: FieldIssue[] = [];
  if (draft.bookingId.trim() === '') issues.push({ field: 'bookingId', issue: 'REQUIRED' });
  if (draft.paymentId.trim() === '') issues.push({ field: 'paymentId', issue: 'REQUIRED' });
  const count = charCount(draft.note);
  if (count < MIN_NOTE) issues.push({ field: 'note', issue: 'TOO_SHORT' });
  else if (draft.note.length > 500) issues.push({ field: 'note', issue: 'TOO_LONG' });
  const refs = splitRefs(draft.evidence);
  if (refs.length === 0) issues.push({ field: 'evidence', issue: 'NO_EVIDENCE' });
  else if (refs.some((ref) => !fileId.test(ref)))
    issues.push({ field: 'evidence', issue: 'EVIDENCE_SHAPE' });
  return issues;
}

export const createRequest = (draft: CreateDraft): RefundRequestCreateRequest =>
  refundRequestCreateRequestSchema.parse({
    bookingId: draft.bookingId.trim(),
    paymentId: draft.paymentId.trim(),
    reason: draft.reason,
    isForceMajeure: true,
    evidenceRefs: splitRefs(draft.evidence),
    note: draft.note.trim(),
  });

export const pinIssues = (pin: string): FieldIssue[] =>
  /^\d{6}$/.test(pin) ? [] : [{ field: 'pin', issue: 'PIN_SHAPE' }];

export function rejectIssues(note: string): FieldIssue[] {
  const trimmed = note.trim();
  if (trimmed === '') return [{ field: 'note', issue: 'REQUIRED' }];
  return trimmed.length > 500 ? [{ field: 'note', issue: 'TOO_LONG' }] : [];
}

/** Số tiền duyệt là **đúng** `requestedAmount` do máy chủ trả; UI không có ô sửa số tiền. */
export function approveRequest(row: RefundRequest, note: string): RefundApproveRequest {
  const trimmed = note.trim();
  return refundApproveRequestSchema.parse({
    approvedAmount: row.requestedAmount,
    ...(trimmed === '' ? {} : { note: trimmed }),
  });
}

export const rejectRequest = (note: string): RefundRejectRequest =>
  refundRejectRequestSchema.parse({ note: note.trim() });

/** Ý định ghi: giữ nguyên `key` và thân cho mọi lần gửi lại (api.md §1.6); hợp đồng hoàn tiền không có `If-Match`. */
export interface Intent {
  kind: 'create' | 'approve' | 'reject';
  /** ID hồ sơ đích; rỗng khi lập mới. */
  target: string;
  body: unknown;
  key: string;
  createdAt: number;
}

export const sameIntent = (a: Intent, b: Intent): boolean =>
  JSON.stringify([a.kind, a.target, a.body]) === JSON.stringify([b.kind, b.target, b.body]);

/** Khoá idempotency chỉ sống 24 giờ: quá hạn thì tra kết quả, không gửi lại mù. */
export const KEY_TTL_MS = 24 * 60 * 60 * 1000;
export const keyExpired = (intent: Intent, now: number): boolean =>
  now - intent.createdAt >= KEY_TTL_MS;

export type Failure =
  | { kind: 'validation'; issues: FieldIssue[] }
  | { kind: 'conflict' }
  | { kind: 'selfApproval' }
  | { kind: 'pinRequired' }
  | { kind: 'pinLocked' }
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

/**
 * Mã nghiệp vụ được xét **trước** mã HTTP: `E_PAY_SELF_APPROVAL` (403) và `E_AUTH_PIN_REQUIRED` (401)
 * là từ chối của lệnh, không phải mất phiên nên không được xoá dữ liệu.
 */
const BY_CODE = new Map<string, Failure>([
  ['E_PAY_SELF_APPROVAL', { kind: 'selfApproval' }],
  ['E_AUTH_PIN_REQUIRED', { kind: 'pinRequired' }],
  ['E_AUTH_PIN_LOCKED', { kind: 'pinLocked' }],
  ['E_SYS_IDEMPOTENCY_KEY_REUSED', { kind: 'keyReused' }],
]);
const AUTH = new Map<number, Failure>([
  [401, { kind: 'expired' }],
  [403, { kind: 'forbidden' }],
]);

function inProgress(error: ApiError): Failure | undefined {
  if (error.code !== 'E_SYS_REQUEST_IN_PROGRESS' && error.status !== 429) return undefined;
  return {
    kind: 'inProgress',
    retryAfterSeconds: error.retryAfterSeconds ?? DEFAULT_RETRY_SECONDS,
  };
}

/** 409/412/428 = hồ sơ đã đổi hoặc điều kiện không còn: đọc lại, không tự gửi lại. */
function conflicting(error: ApiError): Failure | undefined {
  return [409, 412, 428].includes(error.status ?? 0) ? { kind: 'conflict' } : undefined;
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
    BY_CODE.get(error.code ?? '') ??
    AUTH.get(status) ??
    inProgress(error) ??
    conflicting(error) ??
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

/** Lỗi chắc chắn không có tác dụng phụ: nhả ý định, cho tạo ý định mới (khoá mới). */
export const SETTLED: readonly Failure['kind'][] = [
  'validation',
  'conflict',
  'selfApproval',
  'pinRequired',
  'pinLocked',
  'keyReused',
  'rejected',
];

/** Bằng chứng an toàn: mã lỗi, HTTP và traceId. Không có thân lệnh, tiêu đề, PIN, token hay `message`. */
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
