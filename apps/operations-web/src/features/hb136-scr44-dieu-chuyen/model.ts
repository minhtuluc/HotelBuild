/**
 * Phần thuần của SCR-44 (HB-136). Không tính keepScore, giá, chi phí hay quyền: chỉ kiểm hình dạng ô
 * nhập, phân loại lỗi theo `code`/HTTP và dựng ý định ghi có khoá và `If-Match` ổn định.
 */
import { isApiError, type ApiError } from '@pinehill/api-client';
import {
  relocationPlanRequestSchema,
  roomMoveApproveRequestSchema,
  roomMoveCreateRequestSchema,
  type BookingRelocationOptions,
  type RelocationPlanRequest,
  type RoomMoveApproveRequest,
  type RoomMoveCreateRequest,
  type RoomMoveView,
  type UserMe,
} from '@pinehill/contracts';

export interface FieldIssue {
  field: string;
  issue: string;
}

/**
 * Quyền hiển thị theo api.md §6.3, **liệt kê tường minh** và tách riêng: lập/duyệt/thực hiện không
 * kế thừa nhau theo vai. Chỉ quyết định nút nào có thể hiện; `allowedActions` và 403 của máy chủ thắng.
 */
const PLAN_ROLES: readonly UserMe['role'][] = ['MANAGER', 'OWNER'];
const CREATE_ROLES: readonly UserMe['role'][] = ['FRONT_DESK'];
const APPROVE_ROLES: readonly UserMe['role'][] = ['MANAGER', 'OWNER'];
const EXECUTE_ROLES: readonly UserMe['role'][] = ['FRONT_DESK'];
export const canPlan = (role: UserMe['role']): boolean => PLAN_ROLES.includes(role);
export const canCreate = (role: UserMe['role']): boolean => CREATE_ROLES.includes(role);
export const canApprove = (role: UserMe['role']): boolean => APPROVE_ROLES.includes(role);
export const canExecute = (role: UserMe['role']): boolean => EXECUTE_ROLES.includes(role);

export type MoveAction = RoomMoveView['allowedActions'][number];

/** Nút hành động chỉ hiện khi **cả** bảng quyền lẫn `allowedActions` của máy chủ cho phép. */
export function actionAllowed(
  role: UserMe['role'],
  action: MoveAction,
  move: RoomMoveView,
): boolean {
  if (!move.allowedActions.includes(action)) return false;
  if (action === 'APPROVE') return canApprove(role);
  return action === 'EXECUTE' ? canExecute(role) : false;
}

export interface Params {
  caseId: string;
  bookingId: string;
  bookingRoomId: string;
  moveId: string;
}

export interface MoveDraft {
  optionIndex: number;
  reason: string;
  granted: boolean;
  channel: 'PHONE' | 'EMAIL' | 'IN_PERSON' | 'SYSTEM';
  walkOutDocNo: string;
  guestSignatureRef: string;
  staffSignatureRef: string;
}

export const emptyMoveDraft: MoveDraft = {
  optionIndex: 0,
  reason: '',
  granted: false,
  channel: 'PHONE',
  walkOutDocNo: '',
  guestSignatureRef: '',
  staffSignatureRef: '',
};

type Option = BookingRelocationOptions['options'][number];

const isWalkOut = (option: Option | undefined): boolean => option?.moveType === 'WALK_OUT';

/** Chỉ hình dạng: lý do bắt buộc, chứng từ walk-out đủ ba trường; luật đồng ý/duyệt do máy chủ. */
export function moveIssues(draft: MoveDraft, option: Option | undefined): FieldIssue[] {
  const issues: FieldIssue[] = [];
  const reason = draft.reason.trim();
  if (reason === '') issues.push({ field: 'reason', issue: 'REQUIRED' });
  else if (reason.length > 500) issues.push({ field: 'reason', issue: 'TOO_LONG' });
  if (isWalkOut(option)) {
    if (draft.walkOutDocNo.trim() === '') issues.push({ field: 'walkOutDocNo', issue: 'REQUIRED' });
    if (draft.guestSignatureRef.trim() === '')
      issues.push({ field: 'guestSignatureRef', issue: 'REQUIRED' });
    if (draft.staffSignatureRef.trim() === '')
      issues.push({ field: 'staffSignatureRef', issue: 'REQUIRED' });
  }
  return issues;
}

/** Số tiền lấy **nguyên** từ phương án máy chủ trả; UI không khai lại hay tính chi phí. */
export function moveRequest(
  params: Params,
  option: Option,
  draft: MoveDraft,
): RoomMoveCreateRequest {
  const walkOut = isWalkOut(option)
    ? {
        walkOut: {
          walkOutDocNo: draft.walkOutDocNo.trim(),
          guestSignatureRef: draft.guestSignatureRef.trim(),
          staffSignatureRef: draft.staffSignatureRef.trim(),
          refundRequestId: null,
          compensationPaymentId: null,
        },
      }
    : {};
  return roomMoveCreateRequestSchema.parse({
    overbookingCaseId: params.caseId,
    bookingId: params.bookingId,
    bookingRoomId: params.bookingRoomId,
    moveType: option.moveType,
    ...(option.targetRoomId === null ? {} : { toRoomId: option.targetRoomId }),
    ...(option.targetPropertyId === null ? {} : { toPropertyId: option.targetPropertyId }),
    reason: draft.reason.trim(),
    compensationAmount: option.compensationAmount,
    transportCost: option.transportCost,
    consent: { granted: draft.granted, channel: draft.channel },
    ...walkOut,
  });
}

export function pinIssues(pin: string): FieldIssue[] {
  return /^\d{6}$/.test(pin) ? [] : [{ field: 'pin', issue: 'PIN_SHAPE' }];
}

export interface ApproveDraft {
  compensationAmount: string;
  transportCost: string;
  note: string;
}

const isAmount = (value: string): boolean => /^\d{1,15}$/.test(value.trim());

export function approveIssues(draft: ApproveDraft): FieldIssue[] {
  const issues: FieldIssue[] = [];
  if (!isAmount(draft.compensationAmount))
    issues.push({ field: 'compensationAmount', issue: 'AMOUNT' });
  if (!isAmount(draft.transportCost)) issues.push({ field: 'transportCost', issue: 'AMOUNT' });
  if (draft.note.trim().length > 500) issues.push({ field: 'note', issue: 'TOO_LONG' });
  return issues;
}

export function approveRequest(draft: ApproveDraft): RoomMoveApproveRequest {
  const note = draft.note.trim();
  return roomMoveApproveRequestSchema.parse({
    compensationAmount: Number(draft.compensationAmount.trim()),
    transportCost: Number(draft.transportCost.trim()),
    ...(note === '' ? {} : { note }),
  });
}

export const planRequest = (strategy: 'AUTO' | 'MANUAL'): RelocationPlanRequest =>
  relocationPlanRequestSchema.parse({ strategy });

/** `If-Match` từ phiên bản đã đọc (api.md §1.3: `"<version>"`); không tự đoán phiên bản mới. */
export const tagOf = (version: number): string => `"${version}"`;

/** Ý định ghi: giữ nguyên `key`, thân và `If-Match` cho mọi lần gửi lại (api.md §1.6). */
export type Intent =
  | {
      kind: 'plan';
      caseId: string;
      body: RelocationPlanRequest;
      ifMatch: string;
      key: string;
      createdAt: number;
    }
  | {
      kind: 'create';
      body: RoomMoveCreateRequest;
      bookingId: string;
      key: string;
      createdAt: number;
    }
  | {
      kind: 'approve';
      moveId: string;
      body: RoomMoveApproveRequest;
      ifMatch: string;
      key: string;
      createdAt: number;
    }
  | { kind: 'execute'; moveId: string; ifMatch: string; key: string; createdAt: number };

export function sameIntent(a: Intent, b: Intent): boolean {
  const view = (value: Intent) =>
    JSON.stringify([
      value.kind,
      'caseId' in value ? value.caseId : null,
      'moveId' in value ? value.moveId : null,
      'body' in value ? value.body : null,
      'ifMatch' in value ? value.ifMatch : null,
    ]);
  return view(a) === view(b);
}

/** Khoá idempotency chỉ sống 24 giờ: quá hạn thì tra kết quả, không gửi lại mù. */
export const KEY_TTL_MS = 24 * 60 * 60 * 1000;
export const keyExpired = (intent: Intent, now: number): boolean =>
  now - intent.createdAt >= KEY_TTL_MS;

export type Failure =
  | { kind: 'validation'; issues: FieldIssue[] }
  | { kind: 'conflict' }
  | { kind: 'roomTaken' }
  | { kind: 'noConsent' }
  | { kind: 'approvalRequired' }
  | { kind: 'moveNotAllowed' }
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
 * Mã nghiệp vụ được xét **trước** mã HTTP: `E_OVER_APPROVAL_REQUIRED` (403) và `E_AUTH_PIN_REQUIRED` (401)
 * là từ chối của lệnh, không phải mất phiên/quyền nên không được xoá dữ liệu.
 */
const BY_CODE = new Map<string, Failure>([
  ['E_INV_ROOM_TAKEN', { kind: 'roomTaken' }],
  ['E_OVER_NO_CONSENT', { kind: 'noConsent' }],
  ['E_OVER_APPROVAL_REQUIRED', { kind: 'approvalRequired' }],
  ['E_OVER_MOVE_NOT_ALLOWED', { kind: 'moveNotAllowed' }],
  ['E_AUTH_PIN_REQUIRED', { kind: 'pinRequired' }],
  ['E_AUTH_PIN_LOCKED', { kind: 'pinLocked' }],
  ['E_SYS_IDEMPOTENCY_KEY_REUSED', { kind: 'keyReused' }],
]);
const AUTH = new Map<number, Failure>([
  [401, { kind: 'expired' }],
  [403, { kind: 'forbidden' }],
]);
const PRECONDITION = new Map<number, Failure>([
  [412, { kind: 'conflict' }],
  [428, { kind: 'conflict' }],
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
    BY_CODE.get(error.code ?? '') ??
    AUTH.get(status) ??
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

/** Lỗi chắc chắn không có tác dụng phụ: nhả ý định, cho tạo ý định mới (khoá mới). */
export const SETTLED: readonly Failure['kind'][] = [
  'validation',
  'conflict',
  'roomTaken',
  'noConsent',
  'approvalRequired',
  'moveNotAllowed',
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
